import type { Block, BlockResponse, FormField, LinkElement } from "@emdash-cms/blocks/server";
import { shipPages, type Box, type Label, type Prices, type ServiceCode, type ShipOrder, type ShipOrderRow, type ShipSettings } from "./ship.js";

/** The Shipping pages, drawn fresh from hosted Ship's answers; nothing here is kept. */
export const SERVICES: Record<ServiceCode, string> = { GA: "USPS Ground Advantage", PM: "USPS Priority Mail", EM: "USPS Priority Mail Express" };
export const MAX_WEIGHT_OZ = 70 * 16;
const USPS_TRACKING = "https://tools.usps.com/go/TrackConfirmAction?tLabels=";

export type Toast = BlockResponse["toast"];
export interface OrderView {
  order: ShipOrder; settings: ShipSettings; siteId: string;
  /** Prices Ship quoted for the typed box and weight, when "See prices" was pressed. */
  prices?: Prices;
  /** What the owner typed, kept across a refusal or a quote. */
  typed?: { boxId?: string; weightOz?: number; service?: string; kind?: string; buyAgain?: boolean };
  /** Why the last press was refused, shown as it came from Ship. */
  failure?: string;
  /** Ship has no record of its last purchase for this order: offer to buy a new label. */
  askBuyAgain?: boolean;
  /** The five-minute link that opens the live label's PDF in a new tab. */
  printUrl?: string;
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const orderName = (order: ShipOrder | ShipOrderRow) => (order.number === null ? order.orderId : `#${order.number}`) + (order.test ? " (TEST)" : "");
const link = (label: string, url: string, appearance: LinkElement["appearance"] = "secondary"): LinkElement =>
  ({ type: "link", label, target: { kind: "external", url }, appearance });
const header = (text: string): Block => ({ type: "header", text });
const context = (text: string): Block => ({ type: "context", text });
const banner = (variant: "default" | "alert" | "error", title: string, description: string): Block => ({ type: "banner", variant, title, description });
const fields = (...pairs: [string, string][]): Block => ({ type: "fields", fields: pairs.map(([label, value]) => ({ label, value })) });
const oneLine = (order: ShipOrder | ShipOrderRow) => [order.shipTo.name, ...order.shipTo.lines, `${order.shipTo.city}${order.shipTo.region ? `, ${order.shipTo.region}` : ""} ${order.shipTo.postalCode}`].join(", ");
const items = (order: ShipOrder) => order.lines.map(line => `${line.quantity} × ${line.name}`).join(", ") || "No items";
const tracking = (label: Label) => label.test ? `${label.tracking} (test, not trackable)` : label.tracking;
/** A live label's tracking number links to USPS; a sandbox or practice label's is not trackable. */
const trackingLink = (label: Label): Block[] => label.test ? [] : [{ type: "actions", elements: [link("Track on USPS", `${USPS_TRACKING}${encodeURIComponent(label.tracking)}`)] }];

/** One line on what a label costs: nothing in the sandbox or on a practice label, else what Pitney Bowes charged. */
function price(label: Label): string {
  if (label.practice) return "Free practice label, no postage";
  if (label.test) return `${label.priceCents === null ? "" : `${money(label.priceCents)} `}sandbox price, nothing charged`;
  return label.priceCents === null ? "Charged to your Pitney Bowes postage account" : `${money(label.priceCents)} from your Pitney Bowes postage account`;
}

function status(order: ShipOrder | ShipOrderRow): string {
  const labelStatus = "labelStatus" in order ? order.labelStatus : order.label ? "bought" : order.labels.some(label => label.status === "cancelled") ? "cancelled" : null;
  if (labelStatus === "bought") return "Label bought";
  if (order.addressProblem && order.status === "processing") return "Fix address";
  if (labelStatus === "cancelled") return "Label cancelled";
  return order.status === "completed" ? "Completed" : "No label";
}

/** The plugin is installed but not connected to this store's Ship yet. */
export function connectPage(failure?: string): BlockResponse {
  return { blocks: [
    header("Shipping"),
    banner(failure ? "error" : "default", failure ? "Ship settings need a look" : "Connect Ship", failure ??
      "Paste this store's Store ID and store key from the Set up Commerce box on DinkusKit.com into this plugin's settings. They are the same ones Commerce uses."),
    { type: "actions", elements: [
      { type: "link", label: "Open plugin settings", target: { kind: "plugin-settings" }, appearance: "primary" },
      link("DinkusKit.com", "https://dinkuskit.com/"),
    ] },
  ] };
}

/** Ship could not be used for this click; the owner sees why, and Ship's own page stays one click away. */
export function problemPage(siteId: string, title: string, message: string): BlockResponse {
  return { blocks: [header("Shipping"), banner("error", title, message), { type: "actions", elements: [
    { type: "button", label: "Try again", action_id: "list" },
    link("Open Ship", shipPages(siteId).orders),
  ] }] };
}

/** Paid orders waiting to ship, newest first within each status, as hosted Ship lists them. */
export function listPage(siteId: string, orders: ShipOrderRow[], settings: ShipSettings, toast?: Toast): BlockResponse {
  const pages = shipPages(siteId);
  const blocks: Block[] = [header("Shipping")];
  if (!settings.shipFrom || settings.boxes.length === 0) {
    blocks.push(banner("alert", "Set up Ship first", "Labels need your ship-from address and at least one box size. Add them in Ship Settings; they are kept there for every order."));
  } else if (!settings.postageConnected) {
    blocks.push(banner("alert", "Pitney Bowes is not connected", "Real orders need your own Pitney Bowes postage account, connected in Ship Settings. TEST orders get free sandbox or practice labels either way."));
  }
  blocks.push({ type: "table", page_action_id: "list", empty_text: "No paid orders have reached Ship yet. Commerce sends each paid order with a US address here within a few minutes.",
    columns: [
      { key: "order", label: "Order" }, { key: "to", label: "Ship to" }, { key: "items", label: "Items" },
      { key: "status", label: "Status", format: "badge" }, { key: "open", label: "", format: "element" },
    ],
    rows: orders.map(order => ({
      order: orderName(order), to: oneLine(order), items: order.items, status: status(order),
      open: { type: "button", label: "Open", action_id: "open", value: order.orderId, style: order.labelStatus === "bought" || order.status === "completed" ? "secondary" : "primary" },
    })),
  });
  blocks.push(context("Refunds, label history, Settings and your Pitney Bowes account are on Ship's own page."), { type: "actions", elements: [
    { type: "button", label: "Refresh", action_id: "list" },
    link("Open Ship", pages.orders), link("Ship Settings", pages.settings),
  ] });
  return { blocks, ...(toast ? { toast } : {}) };
}

function labelFields(label: Label): Block {
  return fields(["Service", SERVICES[label.service] ?? label.service], ["Tracking number", tracking(label)],
    ["Box", `${label.box.name}: ${label.box.lengthIn} × ${label.box.widthIn} × ${label.box.heightIn} in`], ["Weight", `${label.weightOz} oz`],
    ["Postage", price(label)], ["Bought", label.createdAt.replace("T", " ").slice(0, 16)],
    ...(label.status === "cancelled" ? [["Cancelled", `${(label.cancelledAt ?? "").replace("T", " ").slice(0, 16)}${label.refund ? `, refund ${label.refund.toLowerCase()}` : ""}`] as [string, string]] : []));
}

/**
 * The label form: box and weight, then once Ship has quoted them, the service with its
 * price and "Buy label". A practice label needs no quote (Pitney Bowes is not asked), so
 * picking it goes straight to the buy step; so does Ship's "tick Buy a new label" refusal,
 * which must be answered on the buy step, with the service kept and no new quote.
 */
function labelForm(view: OrderView): Block[] {
  const { order, settings, typed = {}, prices } = view;
  const box = settings.boxes.find(candidate => candidate.boxId === typed.boxId) ?? settings.boxes[0]!;
  const weight = typed.weightOz ?? Math.round((order.itemsWeightOz + box.weightOz) * 10) / 10;
  const id = `${order.version}:${encodeURIComponent(order.orderId)}`;
  const boxOption = (candidate: Box) => ({ label: `${candidate.name}: ${candidate.lengthIn} × ${candidate.widthIn} × ${candidate.heightIn} in, ${candidate.weightOz} oz empty`, value: candidate.boxId });
  const practiceOnly = order.test && !settings.testSandbox;
  const practice = practiceOnly || (order.test && typed.kind === "practice");
  const buyAgain = view.askBuyAgain === true || typed.buyAgain === true;
  const quoted = prices !== undefined || practice || buyAgain;
  const form: FormField[] = [
    { type: "select", action_id: "boxId", label: "Box", options: settings.boxes.map(boxOption), initial_value: box.boxId },
    { type: "number_input", action_id: "weightOz", label: "Package weight (oz), items plus box", initial_value: Math.max(0.1, Math.min(MAX_WEIGHT_OZ, weight)), min: 0.1, max: MAX_WEIGHT_OZ },
  ];
  if (quoted) {
    form.push({ type: "select", action_id: "service", label: "Service", initial_value: typed.service && typed.service in SERVICES ? typed.service : "GA",
      options: (Object.keys(SERVICES) as ServiceCode[]).map(code => ({ value: code, label: prices === undefined ? SERVICES[code]
        : `${SERVICES[code]}: ${prices[code] == null ? "not available for this package" : money(prices[code]!)}` })) });
  }
  if (order.test) {
    form.push({ type: "select", action_id: "kind", label: "Label kind", initial_value: practiceOnly || typed.kind === "practice" ? "practice" : "sandbox",
      options: [...(practiceOnly ? [] : [{ label: "Free Pitney Bowes sandbox label (real sandbox price, nothing charged)", value: "sandbox" }]),
        { label: "Practice label (no Pitney Bowes, marked TEST - NOT POSTAGE)", value: "practice" }] });
  }
  if (buyAgain) form.push({ type: "toggle", action_id: "buyAgain", label: "Buy a new label", description: "Pitney Bowes has no record of the last one Ship bought for this order.", initial_value: typed.buyAgain === true });
  const blocks: Block[] = [{ type: "form", block_id: `label-${order.orderId}-${quoted ? "buy" : "prices"}`, fields: form,
    submit: quoted ? { label: practice ? "Make practice label" : "Buy label", action_id: `buy:${id}` } : { label: "See prices", action_id: `prices:${id}` } }];
  if (prices !== undefined) blocks.push(context("Prices are for the box and weight above. Changed them? Press See prices again."));
  else if (practice && !practiceOnly) blocks.push(context("A practice label is free and asks Pitney Bowes nothing, so there are no prices to see. Want a sandbox label instead? Press See prices."));
  else if (buyAgain) blocks.push(context("Pitney Bowes has no record of the last label Ship bought for this order. Tick Buy a new label and press Buy label to buy one, with the service you chose."));
  if (quoted && !practiceOnly) blocks.push({ type: "actions", elements: [{ type: "button", label: "See prices again", action_id: "open", value: order.orderId }] });
  return blocks;
}

/** One order: its label, or the form to buy one, read from Ship on this click. */
export function orderPage(view: OrderView, toast?: Toast): BlockResponse {
  const { order, settings, siteId } = view;
  const pages = shipPages(siteId), label = order.label;
  const blocks: Block[] = [header("Shipping"), { type: "actions", elements: [{ type: "button", label: "Back to Shipping", action_id: "list" }] }, header(`Order ${orderName(order)}`)];
  if (order.test) blocks.push(banner("alert", "TEST order", "Nothing ships and nothing is charged. A TEST order gets a free Pitney Bowes sandbox label, or a practice label, never live postage."));
  if (view.failure) blocks.push(banner("error", label ? "Not done" : "No label bought", view.failure));
  blocks.push(fields(["Ship to", oneLine(order)], ["Items", items(order)], ["Items' weight", `${order.itemsWeightOz} oz`], ["Status", status(order)]));
  if (order.addressProblem && !label) {
    blocks.push(banner("error", "This address cannot take a label yet", `${order.addressProblem} Commerce sends Ship the corrected address.`));
  }
  if (label) {
    blocks.push(header("Label"), labelFields(label));
    const elements: Block & { type: "actions" } = { type: "actions", elements: [] };
    if (view.printUrl) elements.elements.push(link("Print label", view.printUrl, "primary"));
    if (!label.test) elements.elements.push(link("Track on USPS", `${USPS_TRACKING}${encodeURIComponent(label.tracking)}`));
    elements.elements.push({ type: "button", label: "Cancel label", action_id: `cancel:${encodeURIComponent(order.orderId)}`, value: label.labelId, style: "danger",
      confirm: { title: "Cancel this label?", text: label.practice ? "The practice label is thrown away. The order stays as it is in Commerce." :
        label.test ? "The sandbox label is voided with Pitney Bowes. The order stays as it is in Commerce." :
        "The label is voided with Pitney Bowes and USPS refunds your postage account within about 14 days. The order stays as it is in Commerce.", confirm: "Cancel label", deny: "Keep label", style: "danger" } });
    blocks.push(elements, context(view.printUrl ? "Print label opens the PDF in a new tab. The link works for 5 minutes; open the order again for a fresh one."
      : "Ship could not make a print link just now. Open the order again, or print from Ship's own page."));
  } else if (order.status === "completed") {
    blocks.push(context("This order is Completed in Commerce, so Ship makes no label for it. Move it back to Processing in Commerce's Orders page first."));
  } else if (!order.addressProblem) {
    if (!settings.shipFrom || settings.boxes.length === 0) {
      blocks.push(banner("alert", "Set up Ship first", "Labels need your ship-from address and at least one box size. Add them in Ship Settings, then open this order again."));
    } else if (!order.test && !settings.postageConnected) {
      blocks.push(banner("alert", "Connect your Pitney Bowes account first", "Real orders' labels are paid from your own Pitney Bowes postage account. Connect it in Ship Settings, then open this order again."));
    } else {
      blocks.push(header(order.label ? "New label" : "Buy a label"), ...labelForm(view));
    }
  }
  const earlier = order.labels.filter(candidate => candidate.labelId !== label?.labelId);
  if (earlier.length) blocks.push({ type: "accordion", label: `Earlier labels (${earlier.length})`, blocks: earlier.flatMap(candidate => [labelFields(candidate), ...trackingLink(candidate)]) });
  blocks.push({ type: "actions", elements: [link("Open in Ship", pages.order(order.orderId)), link("Ship Settings", pages.settings)] });
  return { blocks, ...(toast ? { toast } : {}) };
}
