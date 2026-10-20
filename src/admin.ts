import type { BlockResponse } from "@emdash-cms/blocks/server";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import { connectPage, listPage, MAX_WEIGHT_OZ, money, orderPage, problemPage, SERVICES, type OrderView, type Toast } from "./pages.js";
import { connection, ship, ShipError, type LabelRequest, type Ship, type ShipOrder } from "./ship.js";

/** EmDash's Editor role; Administrators are above it. Lower roles never see Shipping. */
const EDITOR = 40;

interface Action { type: "block_action"; action_id: string; value?: unknown }
interface Submit { type: "form_submit"; action_id: string; values: Record<string, unknown> }
type Interaction = { type: "page_load" } | Action | Submit;

function interaction(input: unknown): Interaction | null {
  if (typeof input !== "object" || input === null) return null;
  const value = input as Record<string, unknown>;
  if (value.type === "page_load") return { type: "page_load" };
  if (value.type === "block_action" && typeof value.action_id === "string") return { type: "block_action", action_id: value.action_id, value: value.value };
  if (value.type === "form_submit" && typeof value.action_id === "string" && typeof value.values === "object" && value.values !== null) {
    return { type: "form_submit", action_id: value.action_id, values: value.values as Record<string, unknown> };
  }
  return null;
}

/** `verb:<version>:<encoded order id>` from a form's submit action. */
function target(actionId: string): { version: number; orderId: string } | null {
  const [, version, encoded] = actionId.split(":", 3);
  if (!version || !encoded || !/^\d{1,15}$/.test(version)) return null;
  try {
    return { version: Number(version), orderId: decodeURIComponent(encoded) };
  } catch {
    return null;
  }
}

function text(value: unknown, max = 200): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value) ? value : undefined;
}

/** The label form as typed, checked here so an impossible value never reaches Ship. */
function labelRequest(version: number, values: Record<string, unknown>, by: string): { request: LabelRequest; typed: OrderView["typed"] } {
  const boxId = text(values.boxId);
  const weight = typeof values.weightOz === "number" ? values.weightOz : typeof values.weightOz === "string" ? Number(values.weightOz.trim().replace(/\s*oz\.?$/i, "") || NaN) : NaN;
  const weightOz = Number.isFinite(weight) ? Math.round(weight * 10) / 10 : NaN;
  const service = text(values.service), kind = text(values.kind);
  const typed = { boxId, weightOz: Number.isFinite(weightOz) ? weightOz : undefined, service, kind, buyAgain: values.buyAgain === true };
  if (!boxId) throw new ShipError("INPUT", "Pick a box.");
  if (!(weightOz >= 0.1 && weightOz <= MAX_WEIGHT_OZ)) throw new ShipError("INPUT", `Enter the package weight in ounces, from 0.1 to ${MAX_WEIGHT_OZ} (70 lb).`);
  if (service !== undefined && !(service in SERVICES)) throw new ShipError("INPUT", "Pick a USPS service.");
  return { typed, request: { version, boxId, weightOz, by, ...(service ? { service: service as LabelRequest["service"] } : {}),
    ...(kind === "practice" ? { kind: "practice" as const } : {}), ...(values.buyAgain === true ? { buyAgain: true as const } : {}) } };
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
async function refused(hosted: Ship, orderId: string, error: ShipError, typed: OrderView["typed"]): Promise<BlockResponse> {
  if (error.code === "NOT_FOUND") return problemPage(hosted.siteId, "Order not at Ship", error.message);
  try {
    return await openOrder(hosted, orderId, { failure: error.message, typed, askBuyAgain: error.code === "CHECK_PITNEY_BOWES" });
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
  const input = interaction(route.input);
  if (!input) return { blocks: [] };
  let settings;
  try {
    settings = await connection(ctx);
  } catch (error) {
    return connectPage(error instanceof ShipError ? error.message : undefined);
  }
  if (!settings) return connectPage();
  const hosted = ship(ctx, settings.siteId, settings.key);
  const by = typeof user.email === "string" && user.email ? user.email : user.id;
  try {
    if (input.type === "block_action" && input.action_id === "open" && typeof input.value === "string") return await openOrder(hosted, input.value);
    if (input.type === "block_action" && input.action_id.startsWith("cancel:") && typeof input.value === "string") {
      const orderId = decodeURIComponent(input.action_id.slice("cancel:".length));
      try {
        const cancelled = await hosted.cancel(input.value);
        // Ship records a refund for sandbox labels too; only a live label's postage comes back.
        const live = (order: ShipOrder) => cancelled.refund !== null && order.labels.some(label => label.labelId === cancelled.labelId && !label.test);
        return await openOrder(hosted, orderId, {}, order => ({ type: "success", message: live(order) ? "Label cancelled. USPS refunds the postage account within about 14 days." : "Label cancelled." }));
      } catch (error) {
        if (error instanceof ShipError) return await refused(hosted, orderId, error, undefined);
        throw error;
      }
    }
    if (input.type === "form_submit") {
      const found = target(input.action_id);
      if (!found) return { blocks: [] };
      let typed: OrderView["typed"];
      try {
        const form = labelRequest(found.version, input.values, by);
        typed = form.typed;
        if (input.action_id.startsWith("prices:")) {
          // A practice label asks Pitney Bowes nothing, so there is nothing to quote: straight to the buy step.
          if (form.request.kind === "practice") return await openOrder(hosted, found.orderId, { typed });
          const prices = await hosted.prices(found.orderId, form.request);
          return await openOrder(hosted, found.orderId, { prices, typed });
        }
        if (input.action_id.startsWith("buy:")) {
          const label = await hosted.buy(found.orderId, form.request);
          const message = label.practice ? "Practice label made." : `Label bought${label.priceCents === null ? "" : `, ${money(label.priceCents)}${label.test ? " sandbox" : ""}`}. Tracking ${label.tracking}.`;
          return await openOrder(hosted, found.orderId, {}, { type: "success", message });
        }
        return { blocks: [] };
      } catch (error) {
        if (error instanceof ShipError) return await refused(hosted, found.orderId, error, typed);
        throw error;
      }
    }
    const { orders, settings: shipSettings } = await hosted.orders();
    return listPage(hosted.siteId, orders, shipSettings);
  } catch (error) {
    if (error instanceof ShipError) {
      return error.code === "PASS" || error.code === "NETWORK" || error.code === "SETTINGS"
        ? problemPage(hosted.siteId, error.code === "PASS" ? "DinkusKit.com did not sign a pass" : "Ship could not be reached", error.message)
        : problemPage(hosted.siteId, "Ship could not be used", error.message);
    }
    ctx.log.error("Shipping page failed", { message: error instanceof Error ? error.message : String(error) });
    return problemPage(hosted.siteId, "Something went wrong", "The Shipping page could not finish that. Try again, or open Ship's own page.");
  }
}
