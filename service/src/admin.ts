import { ServiceError, ok, type Outcome } from "./errors.js";
import { NOT_ONE_LINE } from "./order.js";
import { mintPrintLink } from "./session.js";
import { signupUrl } from "./pitney.js";
import type { Box, Label, OrderSummary, Settings, StoreShipping } from "./store.js";
import type { Delivery } from "./delivery.js";

/**
 * What the Ship Registry plugin calls (GrillTrack ship-registry-plugin-001). Every
 * call carries a ship:admin store pass from DinkusKit.com; the store is the pass's
 * site_id. The plugin keeps nothing: each click reads from or buys through here.
 */
export const ADMIN_SCOPE = "ship:admin";
/** How long a print link opens its one label without a Ship sign-in. */
export const PRINT_LINK_SECONDS = 5 * 60;
const MAX_TEXT = 200;

type Store = DurableObjectStub<StoreShipping>;
type Fields = Record<string, string>;
type Body = Record<string, unknown>;

/** One order as the plugin's Shipping page shows it. */
export interface AdminOrder {
  orderId: string; number: number | null; version: number; status: "processing" | "completed"; test: boolean;
  shipTo: { name: string; lines: string[]; city: string; region: string; postalCode: string };
  /** Why no label can be made for this address yet (fixed in Commerce), or null. */
  addressProblem: string | null;
  /** options is the shopper's choices, such as "Size: M", or null for a product without options. */
  lines: { name: string; options: string | null; quantity: number; weightOz: number | null }[];
  /** The items' shipping weight; the plugin adds the chosen box's empty weight. */
  itemsWeightOz: number;
  /**
   * The order's label: the bought label for the current order version, or, once
   * Commerce has completed the order (which bumps its version), the bought label it
   * completed with, so Print label and Cancel label stay on the Shipping page as on
   * Ship's own page. Null when there is none.
   */
  label: Label | null;
  /** Every label this order ever had, oldest first. */
  labels: Label[];
  /** An unresolved purchase can be checked; no carrier transaction details are exposed. */
  labelCheckRequired?: true;
}
/**
 * One row of the plugin's Shipping list. The list is bounded on purpose: at most 200
 * rows, each a few short lines (every address field is at most 200 characters and
 * the items are summed up), so the whole answer stays well inside what the
 * plugin's sandbox reads; the items and label history come with the one order.
 */
export interface AdminOrderRow {
  orderId: string; number: number | null; version: number; status: "processing" | "completed"; test: boolean;
  shipTo: AdminOrder["shipTo"];
  addressProblem: string | null;
  /** "2 × Demo Mug, 1 × Hat, +3 more", or "No items". */
  items: string;
  itemCount: number;
  /** The live label's tracking number for this version, a cancelled one's absence, or nothing yet. */
  labelStatus: "bought" | "cancelled" | null;
  /** Where the carrier says the bought label is (ship-tracking-001); null until a scan, and always for sandbox and practice labels. */
  delivery: Delivery | null;
}
/** The store's Ship settings as far as the plugin needs them; the PB account stays on Ship's page. */
export interface AdminSettings { shipFrom: boolean; boxes: Box[]; postageConnected: boolean; testSandbox: boolean }

const outcomeOf = (pending: Promise<unknown>) => pending as Promise<Outcome>;

function orderLabel(order: OrderSummary["order"], labels: Label[]): Label | null {
  const bought = labels.filter(label => label.status === "bought");
  const current = bought.find(label => label.version === order.version);
  if (current || order.status !== "completed") return current ?? null;
  return bought.find(label => label.tracking === order.completed?.tracking) ?? bought.at(-1) ?? null;
}

function adminOrder(summary: OrderSummary): AdminOrder {
  const { order, labels, address } = summary;
  const to = order.shipTo;
  return {
    orderId: order.orderId, number: order.number, version: order.version, status: order.status, test: order.test,
    shipTo: { name: to.name, lines: [to.line1, to.line2].filter((line): line is string => Boolean(line)), city: to.city, region: to.region ?? "", postalCode: to.postalCode },
    addressProblem: address.ok ? null : address.problem,
    lines: order.lines.map(line => ({ name: line.name, options: line.options ?? null, quantity: line.quantity, weightOz: line.weightOz ?? null })),
    itemsWeightOz: order.lines.reduce((total, line) => total + (line.weightOz ?? 0) * line.quantity, 0),
    label: orderLabel(order, labels),
    labels,
    ...(summary.labelCheckRequired ? { labelCheckRequired: true } : {}),
  };
}

const ITEMS_SHOWN = 3, ITEM_NAME_CHARS = 40;

function adminOrderRow(summary: OrderSummary): AdminOrderRow {
  const full = adminOrder(summary);
  const shown = full.lines.slice(0, ITEMS_SHOWN).map(line => `${line.quantity} × ${line.name.length > ITEM_NAME_CHARS ? `${line.name.slice(0, ITEM_NAME_CHARS - 1)}…` : line.name}`);
  const more = full.lines.length - shown.length;
  return {
    orderId: full.orderId, number: full.number, version: full.version, status: full.status, test: full.test, shipTo: full.shipTo, addressProblem: full.addressProblem,
    items: shown.length === 0 ? "No items" : `${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`,
    itemCount: full.lines.length,
    labelStatus: full.label ? "bought" : full.labels.some(label => label.status === "cancelled") ? "cancelled" : null,
    delivery: full.label?.delivery ?? null,
  };
}

function adminSettings(settings: Settings): AdminSettings {
  return { shipFrom: settings.shipFrom !== null, boxes: settings.boxes, postageConnected: settings.postageConnected, testSandbox: settings.testSandbox };
}

function body(value: unknown): Body {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ServiceError(400, "INVALID_INPUT", "body must be a JSON object");
  return value as Body;
}

/** Label form fields as the owner's page posts them, from the plugin's JSON: numbers and short one-line strings only. */
function labelFields(input: Body, names: string[]): Fields {
  const fields: Fields = {};
  for (const name of names) {
    const value = input[name];
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && Number.isFinite(value)) fields[name] = String(value);
    else if (typeof value === "string" && value.length <= MAX_TEXT && !NOT_ONE_LINE.test(value)) fields[name] = value;
    else throw new ServiceError(400, "INVALID_INPUT", `${name} must be a number or a short line of text`);
  }
  return fields;
}

/** Who pressed the button in the store admin, kept as the label's creator; EmDash checked their role. */
function actor(input: Body): string {
  const by = input.by;
  if (typeof by !== "string" || !by.trim() || by.length > MAX_TEXT || NOT_ONE_LINE.test(by)) throw new ServiceError(400, "INVALID_INPUT", "by must name who is buying the label");
  return `admin:${by.trim()}`;
}

/** The list, plus the order Ship forwarded this same admin here for, if one waits (null when the call names nobody). */
export async function listAdminOrders(store: Store, adminUser: string | null): Promise<Outcome> {
  const [orders, settings, open] = await Promise.all([store.listOrders(), store.getSettings(), store.takeAdminOpen(adminUser)]);
  return ok({ orders: orders.map(adminOrderRow), settings: adminSettings(settings), open });
}

export async function showAdminOrder(store: Store, orderId: string): Promise<Outcome> {
  const [summary, settings] = await Promise.all([store.orderSummary(orderId), store.getSettings()]);
  if (!summary) throw new ServiceError(404, "NOT_FOUND", "Ship has not received this order from Commerce yet.");
  return ok({ order: adminOrder(summary), settings: adminSettings(settings) });
}

export async function quoteAdminLabel(store: Store, orderId: string, input: unknown): Promise<Outcome> {
  return outcomeOf(store.quoteLabel({ orderId, review: true, fields: labelFields(body(input), ["version", "boxId", "weightOz"]) }));
}

export async function buyAdminLabel(store: Store, orderId: string, input: unknown, reviewed = false): Promise<Outcome> {
  const payload = body(input);
  const fields = labelFields(payload, ["version", "boxId", "weightOz", "service", "kind", "reviewedDimensions"]);
  if (Object.hasOwn(payload, "quoteId")) fields.quoteId = typeof payload.quoteId === "string" && /^[0-9a-f-]{36}$/.test(payload.quoteId) ? payload.quoteId : "";
  if (reviewed && (!fields.quoteId || fields.kind === "practice")) {
    throw new ServiceError(409, "QUOTE_CHANGED", "Check prices again before buying a label.");
  }
  if (payload.buyAgain === true) fields.buyAgain = "yes";
  const outcome = await outcomeOf(store.buyLabel({ orderId, fields, uid: actor(payload) }));
  if (!outcome.ok) return outcome;
  if (!reviewed) return ok({ label: outcome.body }, 201); // Existing clients get the original status and shape.
  return ok({ label: outcome.body, disposition: outcome.status === 200 ? "recovered" : "created" }, outcome.status);
}

export async function checkAdminLabel(store: Store, orderId: string, input: unknown): Promise<Outcome> {
  const outcome = await outcomeOf(store.checkLabel({ orderId, fields: labelFields(body(input), ["version"]) }));
  return outcome.ok ? ok({ label: outcome.body }) : outcome;
}

export async function cancelAdminLabel(store: Store, labelId: string): Promise<Outcome> {
  return outcomeOf(store.cancelLabel(labelId));
}

/** A link that opens this one label's PDF for five minutes, with no Ship sign-in, for the admin's new tab. */
export async function printLink(env: Env, origin: string, store: Store, site: string, labelId: string): Promise<Outcome> {
  if (!await store.labelOrder(labelId)) throw new ServiceError(404, "NOT_FOUND", "This store has no such label.");
  const expiresAt = Math.floor(Date.now() / 1000) + PRINT_LINK_SECONDS;
  const token = await mintPrintLink(env, { site, labelId, exp: expiresAt });
  return ok({ url: `${origin}/print/${token}`, expiresAt: new Date(expiresAt * 1000).toISOString() });
}

/**
 * Ship's settings as the plugin's Shipping settings page shows them (ship-settings-in-admin-129):
 * everything Ship's own Settings page shows, except the Pitney Bowes Shipper ID and who connected it.
 */
export interface AdminSettingsPage {
  shipFrom: Settings["shipFrom"]; boxes: Box[]; replyTo: string | null; storeName: string | null;
  /** Whether Ship can buy labels from Pitney Bowes at all, and whether TEST orders use its sandbox. */
  postageConnected: boolean; testSandbox: boolean;
  /** The owner's own Pitney Bowes postage account, which pays for real orders' labels; null until connected. */
  postageAccount: { company: string | null; email: string | null; accountEnding: string | null; connectedAt: string } | null;
  /**
   * Pitney Bowes' sign-up page with the ship-from address and the admin's email filled in, as Ship's own
   * Settings links it; null while Ship cannot connect owners' accounts. The developer id itself stays here.
   */
  signupUrl: string | null;
}

function adminSettingsPage(settings: Settings, adminUser: string | null): AdminSettingsPage {
  const account = settings.postageAccount, from = settings.shipFrom;
  return {
    shipFrom: settings.shipFrom, boxes: settings.boxes, replyTo: settings.replyTo, storeName: settings.storeName,
    postageConnected: settings.postageConnected, testSandbox: settings.testSandbox,
    postageAccount: account ? { company: account.company, email: account.email, accountEnding: account.accountEnding, connectedAt: account.connectedAt } : null,
    signupUrl: settings.signupDeveloperId ? signupUrl(settings.signupDeveloperId, {
      email: adminUser ?? undefined, name: from?.name, company: from?.company ?? settings.storeName ?? undefined,
      line1: from?.line1, line2: from?.line2, city: from?.city, state: from?.region, postalCode: from?.postalCode,
    }) : null,
  };
}

/** A settings form's JSON, with only the named fields, each a string or a number. */
function settingsFields(input: unknown, names: string[]): Fields {
  const fields = body(input), out: Fields = {};
  for (const key of Object.keys(fields)) if (!names.includes(key)) throw new ServiceError(400, "INVALID_INPUT", `${key} is not a field of this form`);
  for (const name of names) {
    const value = fields[name];
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[name] = String(value);
    else if (typeof value === "string" && value.length <= 300) out[name] = value;
    else throw new ServiceError(400, "INVALID_INPUT", `${name} must be a number or a short line of text`);
  }
  return out;
}

/** After a save, the whole page again, or Ship's refusal with the store's own words. */
async function settingsAfter(store: Store, adminUser: string | null, pending: Promise<unknown>, status = 200): Promise<Outcome> {
  const outcome = await outcomeOf(pending);
  return outcome.ok ? ok({ settings: adminSettingsPage(await store.getSettings(), adminUser) }, status) : outcome;
}

export async function showAdminSettings(store: Store, adminUser: string | null): Promise<Outcome> {
  return ok({ settings: adminSettingsPage(await store.getSettings(), adminUser) });
}

export const saveAdminShipFrom = (store: Store, input: unknown, adminUser: string | null) =>
  settingsAfter(store, adminUser, store.saveShipFrom(settingsFields(input, ["name", "company", "line1", "line2", "city", "region", "postalCode"])));
export const saveAdminReplyTo = (store: Store, input: unknown, adminUser: string | null) =>
  settingsAfter(store, adminUser, store.saveReplyTo(settingsFields(input, ["replyTo"])));
export const addAdminBox = (store: Store, input: unknown, adminUser: string | null) =>
  settingsAfter(store, adminUser, store.addBox(settingsFields(input, ["name", "lengthIn", "widthIn", "heightIn", "weightOz"])), 201);
export const removeAdminBox = (store: Store, boxId: string, adminUser: string | null) => settingsAfter(store, adminUser, store.removeBox(boxId));
export const disconnectAdminPostage = (store: Store, adminUser: string | null) => settingsAfter(store, adminUser, store.disconnectPostage());

/**
 * Connects the owner's Pitney Bowes postage account from the store admin. The username and
 * password go to Pitney Bowes once, as from Ship's own page, and Ship keeps neither.
 * The admin who pressed it is recorded as who connected it.
 */
export async function connectAdminPostage(store: Store, input: unknown, adminUser: string | null): Promise<Outcome> {
  if (!adminUser) throw new ServiceError(400, "INVALID_INPUT", "connecting Pitney Bowes needs the store admin's email in x-ship-admin-user");
  return settingsAfter(store, adminUser, store.connectPostage(settingsFields(input, ["username", "password"]), `admin:${adminUser}`));
}

/** One row of the store's label history. */
export interface AdminLabelRow extends Label { number: number | null }
export const LABEL_HISTORY_PAGE = 50;

/** Every label the store has bought or cancelled, newest first, 50 at a time; `before` is the previous answer's `next`. */
export async function adminLabelHistory(store: Store, before: string | null): Promise<Outcome> {
  return outcomeOf(store.labelHistory(before, LABEL_HISTORY_PAGE));
}
