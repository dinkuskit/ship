import { ServiceError, ok, type Outcome } from "./errors.js";
import { NOT_ONE_LINE } from "./order.js";
import { mintPrintLink } from "./session.js";
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
  lines: { name: string; quantity: number; weightOz: number | null }[];
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
    lines: order.lines.map(line => ({ name: line.name, quantity: line.quantity, weightOz: line.weightOz ?? null })),
    itemsWeightOz: order.lines.reduce((total, line) => total + (line.weightOz ?? 0) * line.quantity, 0),
    label: orderLabel(order, labels),
    labels,
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

export async function listAdminOrders(store: Store): Promise<Outcome> {
  const [orders, settings, open] = await Promise.all([store.listOrders(), store.getSettings(), store.takeAdminOpen()]);
  return ok({ orders: orders.map(adminOrderRow), settings: adminSettings(settings), open });
}

export async function showAdminOrder(store: Store, orderId: string): Promise<Outcome> {
  const [summary, settings] = await Promise.all([store.orderSummary(orderId), store.getSettings()]);
  if (!summary) throw new ServiceError(404, "NOT_FOUND", "Ship has not received this order from Commerce yet.");
  return ok({ order: adminOrder(summary), settings: adminSettings(settings) });
}

export async function quoteAdminLabel(store: Store, orderId: string, input: unknown): Promise<Outcome> {
  const outcome = await outcomeOf(store.quoteLabel({ orderId, fields: labelFields(body(input), ["version", "boxId", "weightOz"]) }));
  return outcome.ok ? ok({ prices: outcome.body }) : outcome;
}

export async function buyAdminLabel(store: Store, orderId: string, input: unknown): Promise<Outcome> {
  const fields = labelFields(body(input), ["version", "boxId", "weightOz", "service", "kind"]);
  if (body(input).buyAgain === true) fields.buyAgain = "yes";
  const outcome = await outcomeOf(store.buyLabel({ orderId, fields, uid: actor(body(input)) }));
  return outcome.ok ? ok({ label: outcome.body }, 201) : outcome;
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
