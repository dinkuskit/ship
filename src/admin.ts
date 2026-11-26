import type { BlockResponse } from "@emdash-cms/blocks/server";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import {
  connectPage, finishPage, labelHistoryPage, listPage, pageStart, pendingPage, unconfirmedPage, MAX_WEIGHT_OZ, money, orderPage, problemPage, SERVICES, SETTINGS_PATH,
  type OrderView, type Toast,
} from "./pages.js";
import { settingsAdmin } from "./settings.js";
import { cancelConnect, connectedTo, connectionState, finishSetup, startConnect, type ConnectView } from "./connect.js";
import { adminPageFrom, adminUserFrom, ship, ShipError, type LabelRequest, type Ship, type ShipOrder } from "./ship.js";

/** EmDash's Editor role; Administrators are above it. Lower roles never see Shipping. */
const EDITOR = 40;
/** Only an Administrator connects the plugin to DinkusKit.com (store-connect-flow-081). */
const ADMIN = 50;

/** `page` is the plugin page the press came from, as EmDash names it: "/shipping" or "/shipping-settings". */
export interface Action { type: "block_action"; action_id: string; value?: unknown; page?: string }
export interface Submit { type: "form_submit"; action_id: string; values: Record<string, unknown>; page?: string }
export type Interaction = { type: "page_load"; page?: string } | Action | Submit;

function interaction(input: unknown): Interaction | null {
  if (typeof input !== "object" || input === null) return null;
  const value = input as Record<string, unknown>;
  const page = typeof value.page === "string" ? { page: value.page } : {};
  if (value.type === "page_load") return { type: "page_load", ...page };
  if (value.type === "block_action" && typeof value.action_id === "string") return { type: "block_action", action_id: value.action_id, value: value.value, ...page };
  if (value.type === "form_submit" && typeof value.action_id === "string" && typeof value.values === "object" && value.values !== null) {
    return { type: "form_submit", action_id: value.action_id, values: value.values as Record<string, unknown>, ...page };
  }
  return null;
}

/** `verb:<version>:<encoded order id>[:<replacement transaction>]` from a form. */
function target(actionId: string): { version: number; orderId: string; transactionId?: string } | null {
  const [verb, version, encoded, transactionId, extra] = actionId.split(":", 5);
  if (!version || !encoded || !/^\d{1,15}$/.test(version) || extra !== undefined ||
      transactionId !== undefined && (verb !== "buy" || !/^shp[a-z0-9]{22}$/.test(transactionId))) return null;
  try {
    return { version: Number(version), orderId: decodeURIComponent(encoded), transactionId };
  } catch {
    return null;
  }
}

function text(value: unknown, max = 200): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value) ? value : undefined;
}

/** Keep the label draft separately so validation can fail without losing the merchant's choices. */
function labelDraft(values: Record<string, unknown>): NonNullable<OrderView["typed"]> {
  const weight = typeof values.weightOz === "number" ? values.weightOz : typeof values.weightOz === "string" ? Number(values.weightOz.trim().replace(/\s*oz\.?$/i, "") || NaN) : NaN;
  const weightOz = Math.round(weight * 10) / 10;
  return { boxId: text(values.boxId), weightOz: Number.isFinite(weightOz) ? weightOz : undefined,
    service: text(values.service), kind: text(values.kind) };
}

/** Check the draft before asking Ship for prices or a label. */
function labelRequest(version: number, typed: NonNullable<OrderView["typed"]>, by: string): LabelRequest {
  const { boxId, weightOz, service, kind } = typed;
  if (!boxId) throw new ShipError("INPUT", "Pick a box.");
  if (weightOz === undefined || weightOz < 0.1 || weightOz > MAX_WEIGHT_OZ) throw new ShipError("INPUT", `Enter the package weight in ounces, from 0.1 to ${MAX_WEIGHT_OZ} (70 lb).`);
  if (service !== undefined && !(service in SERVICES)) throw new ShipError("INPUT", "Pick a USPS service.");
  return { version, boxId, weightOz, by, ...(service ? { service: service as LabelRequest["service"] } : {}),
    ...(kind === "practice" ? { kind: "practice" as const } : {}) };
}

/** The order as Ship has it right now, with a fresh five-minute print link when it has a live label. */
async function openOrder(hosted: Ship, orderId: string, extra: Partial<OrderView> = {}, toast?: Toast | ((order: ShipOrder) => Toast)): Promise<BlockResponse> {
  const { order, settings } = await hosted.order(orderId);
  if (typeof toast === "function") toast = toast(order);
  let printUrl: string | undefined;
  if (order.label) {
    try { printUrl = (await hosted.printLink(order.label.labelId)).url; } catch { /* the page says to open the order again */ }
  }
  return orderPage({ order, settings, siteId: hosted.siteId, printUrl, ...extra }, toast);
}

/** A refusal while on an order's page keeps the page, with Ship's reason and what was typed. */
async function refused(hosted: Ship, orderId: string, error: ShipError, typed: OrderView["typed"], historyFrom: OrderView["historyFrom"], labelInputError?: OrderView["labelInputError"], version?: number): Promise<BlockResponse> {
  if (error.code === "RECONNECT") throw error;
  if (error.code === "NOT_FOUND") return problemPage(hosted.siteId, "Order not at Ship", error.message);
  try {
    const replacement = error.retryTransactionId && version !== undefined ? { transactionId: error.retryTransactionId, version } : undefined;
    const failure = error.code === "CHECK_PITNEY_BOWES" && !replacement
      ? "Open in Ship to check the last label and confirm a replacement there." : error.message;
    return await openOrder(hosted, orderId, { failure, typed, labelInputError, replacement, historyFrom });
  } catch (again) {
    return problemPage(hosted.siteId, "Ship could not be used", again instanceof ShipError ? again.message : error.message);
  }
}

/**
 * The Shipping page's one private route. EmDash lets only Editors and Administrators
 * in (content:edit_any); the check here is the belt to that permission's braces.
 */
export async function shippingAdmin(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  const user = route.user;
  if (route.ui?.surface !== "admin-page" || typeof user?.role !== "number" || user.role < EDITOR) {
    return { blocks: [{ type: "banner", variant: "error", title: "Shipping is for Editors and Administrators", description: "Ask an Administrator of this site to buy or print labels." }] };
  }
  const parsed = interaction(route.input);
  if (!parsed) return { blocks: [] };
  const isAdmin = user.role >= ADMIN;
  if (parsed.page === SETTINGS_PATH) return settingsAdmin(parsed, isAdmin, route, ctx);
  let input = parsed, historyFrom: OrderView["historyFrom"];
  if (parsed.type !== "page_load" && parsed.action_id.startsWith("history-order:")) {
    const wrapped = /^history-order:([^:]*):(open|(?:prices|buy|cancel):.+)$/.exec(parsed.action_id);
    if (!wrapped) return { blocks: [] };
    try { historyFrom = decodeURIComponent(wrapped[1]!) || null; } catch { return { blocks: [] }; }
    if (historyFrom !== null && historyCursor({ cursor: historyFrom }) === null) return { blocks: [] };
    input = { ...parsed, action_id: wrapped[2]! };
  }
  const connect = input.type === "block_action" && ["connect", "finish_setup", "check", "cancel_connect"].includes(input.action_id) ? input.action_id : null;
  let settings: ConnectView;
  try {
    settings = connect === "connect" && isAdmin ? await startConnect(ctx)
      : connect === "finish_setup" && isAdmin ? await finishSetup(ctx)
      : connect === "cancel_connect" && isAdmin ? await cancelConnect(ctx)
      : await connectionState(ctx, connect === "check");
  } catch (error) {
    ctx.log.error("Connect failed", { message: error instanceof Error ? error.message : String(error) });
    return connectPage(isAdmin, "Connect could not finish. Try again in a moment.");
  }
  if (settings.state === "pending") return pendingPage(settings.verificationUri, settings.checked);
  if (settings.state === "finish_unconfirmed") return unconfirmedPage(isAdmin, settings.checked);
  if (settings.state === "disconnected") return connectPage(isAdmin, settings.failure);
  if (settings.state === "finish_setup") return finishPage(isAdmin, settings.retry);
  const hosted = ship(ctx, settings.siteId, settings.key, adminPageFrom(route.request?.url), adminUserFrom(user.email));
  const by = typeof user.email === "string" && user.email ? user.email : user.id;
  try {
    if (input.type === "block_action" && input.action_id === "open" && typeof input.value === "string") return await openOrder(hosted, input.value, { historyFrom });
    if (input.type === "block_action" && input.action_id === "history") {
      const before = historyCursor(input.value);
      try {
        return labelHistoryPage(hosted.siteId, await hosted.labels(before), before);
      } catch (error) {
        // Until ship.dinkuskit.com has the label history route, Ship's own page lists them.
        if (error instanceof ShipError && error.status === 404) return problemPage(hosted.siteId, "Label history is on Ship's page for now", "Ship has not been updated to list labels here yet. Open Ship to see every label.");
        throw error;
      }
    }
    if (input.type === "block_action" && input.action_id.startsWith("cancel:") && typeof input.value === "string") {
      const orderId = decodeURIComponent(input.action_id.slice("cancel:".length));
      try {
        const cancelled = await hosted.cancel(input.value);
        // Ship records a refund for sandbox labels too; only a live label's postage comes back.
        const live = (order: ShipOrder) => cancelled.refund !== null && order.labels.some(label => label.labelId === cancelled.labelId && !label.test);
        return await openOrder(hosted, orderId, { historyFrom }, order => ({ type: "success", message: live(order) ? "Label cancelled. USPS refunds the postage account within about 14 days." : "Label cancelled." }));
      } catch (error) {
        if (error instanceof ShipError) return await refused(hosted, orderId, error, undefined, historyFrom);
        throw error;
      }
    }
    if (input.type === "form_submit") {
      const found = target(input.action_id);
      if (!found) return { blocks: [] };
      const typed = labelDraft(input.values);
      const quote = input.action_id.startsWith("prices:");
      const buy = input.action_id.startsWith("buy:");
      if (!quote && !buy) return { blocks: [] };
      if (buy && Object.hasOwn(input.values, "buyAgain") && !found.transactionId) {
        return await refused(hosted, found.orderId, new ShipError("LABEL_ATTEMPT_CHANGED", "This confirmation no longer applies. Check the label again, or open Ship to confirm a replacement there."), typed, historyFrom);
      }
      let request: LabelRequest;
      try {
        request = labelRequest(found.version, typed, by);
      } catch (error) {
        if (!(error instanceof ShipError)) throw error;
        const rawWeight = input.values.weightOz;
        return await refused(hosted, found.orderId, error, typed, historyFrom, {
          // Text fields have no length cap in Block Kit. Reflect a bounded draft,
          // or leave it blank rather than replacing an oversized paste with a weight.
          quote, weight: typeof rawWeight === "string" ? text(rawWeight) ?? "" : undefined,
        });
      }
      try {
        if (quote) {
          // A practice label asks Pitney Bowes nothing, so there is nothing to quote: straight to the buy step.
          if (request.kind === "practice") return await openOrder(hosted, found.orderId, { typed, historyFrom });
          const prices = await hosted.prices(found.orderId, request);
          return await openOrder(hosted, found.orderId, { prices, typed, historyFrom });
        }
        if (found.transactionId && request.kind !== "practice") {
          if (input.values.buyAgain === true) request.buyAgain = found.transactionId;
          else request.retryTransactionId = found.transactionId;
        }
        const label = await hosted.buy(found.orderId, request);
        const message = label.practice ? "Practice label made." : `Label bought${label.priceCents === null ? "" : `, ${money(label.priceCents)}${label.test ? " sandbox" : ""}`}. Tracking ${label.tracking}.`;
        return await openOrder(hosted, found.orderId, { historyFrom }, { type: "success", message });
      } catch (error) {
        if (error instanceof ShipError) return await refused(hosted, found.orderId, error, typed, historyFrom, undefined, found.version);
        throw error;
      }
    }
    // The connected-to line is read beside the list; if it fails the list shows without it.
    const [list, shared] = await Promise.all([hosted.orders(), connectedTo(ctx, settings.siteId, settings.key)]);
    // Commerce's "Create shipping label" button went to Ship's own order page, which sent the owner here: open that order.
    if (list.open) return await openOrder(hosted, list.open);
    const from = input.type === "block_action" && input.action_id === "list" ? pageStart(input.value) : 0;
    return listPage(hosted.siteId, list.orders, list.settings, undefined, from, shared);
  } catch (error) {
    if (error instanceof ShipError) {
      if (error.code === "RECONNECT") return connectPage(isAdmin, error.message);
      return error.code === "PASS" || error.code === "NETWORK"
        ? problemPage(hosted.siteId, error.code === "PASS" ? "DinkusKit.com did not sign a pass" : "Ship could not be reached", error.message)
        : problemPage(hosted.siteId, "Ship could not be used", error.message);
    }
    ctx.log.error("Shipping page failed", { message: error instanceof Error ? error.message : String(error) });
    return problemPage(hosted.siteId, "Something went wrong", "The Shipping page could not finish that. Try again, or open Ship's own page.");
  }
}

/** Load more on the label history sends the previous page's `next`; anything else starts at the newest. */
function historyCursor(value: unknown): string | null {
  const cursor = typeof value === "object" && value !== null ? (value as { cursor?: unknown }).cursor : undefined;
  return typeof cursor === "string" && cursor.length > 0 && cursor.length <= 200 ? cursor : null;
}

