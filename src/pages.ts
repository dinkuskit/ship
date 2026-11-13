import type { Block, BlockResponse, FormField, LinkElement } from "@emdash-cms/blocks/server";
import { type Delivery, shipPages, type Box, type Label, type Prices, type ServiceCode, type ShipOrder, type ShipOrderRow, type ShipSettings } from "./ship.js";

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
const section = (text: string): Block => ({ type: "section", text });
/** An address as the lines on a parcel, one section each (a section cannot break lines). */
const parcelLines = (to: ShipOrder["shipTo"]): Block[] =>
  [to.name, to.lines.join(", "), `${to.city}${to.region ? `, ${to.region}` : ""} ${to.postalCode}`].map(section);
/** Times read in UTC, as on Commerce's order page, until stores record a time zone. */
const when = (at: string) => `${new Date(at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
const day = (at: string) => new Date(at).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
/** "12 oz", "2 lb" or "1 lb 4.5 oz", as Shopify and WooCommerce show weights. */
export function weight(oz: number): string {
  const tenths = Math.round(oz * 10), pounds = Math.floor(tenths / 160), rest = (tenths - pounds * 160) / 10;
  return pounds === 0 ? `${rest} oz` : rest === 0 ? `${pounds} lb` : `${pounds} lb ${rest} oz`;
}
const count = (quantity: number) => `${quantity} ${quantity === 1 ? "item" : "items"}`;
const tracking = (label: Label) => label.test ? `${label.tracking} (test, not trackable)` : label.tracking;
/** A tracking number in USPS's groups of four, so it wraps in a narrow column. */
const grouped = (label: Label) => label.test ? tracking(label) : label.tracking.replace(/(.{4})(?=.)/g, "$1 ");
/** What a label cost, short, for the Labels table. */
const postage = (label: Label) => label.practice ? "free practice label" : label.priceCents === null ? "price not recorded" : `${money(label.priceCents)}${label.test ? " sandbox, not charged" : ""}`;
/** "In transit · Nov 13, 2026, 9:12 AM UTC", with the scan's note when there is a problem. */
const delivered = (delivery: Delivery) => `${deliveryText(delivery)}${delivery.state === "problem" && delivery.note ? `: ${delivery.note}` : ""} · ${when(delivery.at)}`;
const trackUrl = (label: Label) => `${USPS_TRACKING}${encodeURIComponent(label.tracking)}`;

/** One line on what a label costs: nothing in the sandbox or on a practice label, else what Pitney Bowes charged. */
function price(label: Label): string {
  if (label.practice) return "Free practice label, no postage";
  if (label.test) return `${label.priceCents === null ? "" : `${money(label.priceCents)} `}sandbox price, nothing charged`;
  return label.priceCents === null ? "Charged to your Pitney Bowes postage account" : `${money(label.priceCents)} from your Pitney Bowes postage account`;
}

const DELIVERY: Record<Delivery["state"], string> = { in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered", problem: "Delivery problem" };
/** "Delivered", or "Delivery problem: Delivery attempted", with the scan's day when asked. */
function deliveryText(delivery: Delivery, withNote = false): string {
  const phrase = withNote && delivery.note && delivery.state === "problem" ? `${DELIVERY[delivery.state]}: ${delivery.note}` : DELIVERY[delivery.state];
  return withNote ? `${phrase}, ${delivery.at.replace("T", " ").slice(0, 16)} UTC` : phrase;
}

function status(order: ShipOrder | ShipOrderRow): string {
  const labelStatus = "labelStatus" in order ? order.labelStatus : order.label ? "bought" : order.labels.some(label => label.status === "cancelled") ? "cancelled" : null;
  const delivery = "labelStatus" in order ? order.delivery : order.label?.delivery;
  if (labelStatus === "bought" && delivery) return deliveryText(delivery);
  if (labelStatus === "bought") return "Label bought";
  if (order.addressProblem && order.status === "processing") return "Fix address";
  if (labelStatus === "cancelled") return "Label cancelled";
  return order.status === "completed" ? "Completed" : "Needs label";
}

/**
 * A status with a coloured dot, as Shopify and WooCommerce colour theirs: yellow waits on you, red needs fixing,
 * blue is on its way, green arrived, white is done elsewhere. Block Kit 1.4 draws every badge black, so the colour
 * travels in the text until EmDash lets a table badge pick a colour.
 */
function dotted(text: string): string {
  const dot = /^Needs label/.test(text) ? "🟡" : /^(Fix address|Delivery problem|Label cancelled|Cancelled)/.test(text) ? "🔴"
    : /^Delivered/.test(text) ? "🟢" : /^(Label bought|Bought|In transit|Out for delivery)/.test(text) ? "🔵" : "⚪";
  return `${dot} ${text}`;
}

/**
 * The plugin is not connected to DinkusKit.com yet, or its key stopped working. An Administrator presses
 * Connect; the business owner approves at DinkusKit.com. Commerce connects first.
 */
export function connectPage(isAdmin: boolean, failure?: string): BlockResponse {
  return { blocks: [
    header("Shipments"),
    banner(failure ? "error" : "default", failure ? "Connect Ship again" : "Connect Ship", failure ??
      "Connect this plugin to DinkusKit.com so it can buy labels through Ship. Commerce connects first; the business owner approves at DinkusKit.com."),
    isAdmin
      ? { type: "actions", elements: [{ type: "button", label: failure ? "Connect again" : "Connect", action_id: "connect", style: "primary" }, link("DinkusKit.com", "https://dinkuskit.com/")] }
      : context("Ask an Administrator of this site to press Connect on this page."),
  ] };
}

/** A Connect waits for the business owner's Approve at DinkusKit.com, which sends them back here. */
export function pendingPage(verificationUri: string, checked = false): BlockResponse {
  return { blocks: [
    header("Shipments"),
    banner("default", "Approve at DinkusKit.com", "The business owner opens this link, signs in to DinkusKit.com and presses Approve. Anyone helping can send the owner the same link."),
    ...(checked ? [context("Not approved yet.")] : []),
    { type: "actions", elements: [
      { type: "link", label: "Approve at DinkusKit.com", target: { kind: "external", url: verificationUri }, appearance: "primary" },
      { type: "button", label: "Check", action_id: "check" },
      { type: "button", label: "Cancel", action_id: "cancel_connect" },
    ] },
  ] };
}

/** Ship could not be used for this click; the owner sees why, and Ship's own page stays one click away. */
export function problemPage(siteId: string, title: string, message: string): BlockResponse {
  return { blocks: [header("Shipments"), banner("error", title, message), { type: "actions", elements: [
    { type: "button", label: "Try again", action_id: "list" },
    link("Open Ship", shipPages(siteId).orders),
  ] }] };
}

/** Paid orders waiting to ship, newest first within each status, as hosted Ship lists them. */
/**
 * Orders per Shipping page. EmDash refuses a Block Kit page of more than 2,000 parts, which is about
 * 175 order rows, and hosted Ship sends up to 200, so the list shows them a page at a time.
 */
export const ORDERS_PER_PAGE = 50;

/** The list page's start, from the cursor its Load more sends; the first page for anything else. */
export function pageStart(value: unknown): number {
  const cursor = typeof value === "object" && value !== null ? (value as { cursor?: unknown }).cursor : undefined;
  return typeof cursor === "string" && /^\d{1,4}$/.test(cursor) ? Number(cursor) : 0;
}

/** Waiting for a label: paid, still Processing, no live label and an address USPS takes. */
const toShip = (order: ShipOrderRow) => order.status === "processing" && order.labelStatus !== "bought" && !order.addressProblem;

/**
 * The orders Ship has, laid out like Shopify's and WooCommerce's order lists: counts first, then one
 * short row per order with its status and the next step. Fifty a page, as hosted Ship sends up to 200.
 */
export function listPage(siteId: string, orders: ShipOrderRow[], settings: ShipSettings, toast?: Toast, from = 0): BlockResponse {
  const pages = shipPages(siteId);
  const start = from < orders.length ? from : 0;
  const shown = orders.slice(start, start + ORDERS_PER_PAGE);
  const next = start + ORDERS_PER_PAGE < orders.length ? String(start + ORDERS_PER_PAGE) : undefined;
  const blocks: Block[] = [header("Shipments")];
  if (!settings.shipFrom || settings.boxes.length === 0) {
    blocks.push(banner("alert", "Set up Ship first", "Labels need your ship-from address and at least one box size. Add them in Ship Settings; they are kept there for every order."));
  } else if (!settings.postageConnected) {
    blocks.push(banner("alert", "Pitney Bowes is not connected", "Real orders need your own Pitney Bowes postage account, connected in Ship Settings. TEST orders get free sandbox or practice labels either way."));
  }
  if (orders.length) {
    blocks.push({ type: "stats", items: [
      { label: "To ship", value: orders.filter(toShip).length },
      { label: "Fix address", value: orders.filter(order => order.status === "processing" && order.labelStatus !== "bought" && order.addressProblem).length },
      { label: "On the way", value: orders.filter(order => order.labelStatus === "bought" && order.delivery?.state !== "delivered").length },
    ] });
  }
  blocks.push({ type: "table", page_action_id: "list", empty_text: "No paid orders have reached Ship yet. Commerce sends each paid order with a US address here within a few minutes.",
    columns: [
      // The order number opens the order, as in Shopify's list; blue while it waits for a label. Three columns fit a phone.
      { key: "order", label: "Order", format: "element" }, { key: "to", label: "Ship to" }, { key: "status", label: "Status" },
    ],
    ...(next ? { next_cursor: next } : {}),
    rows: shown.map(order => ({
      order: { type: "button", label: orderName(order), action_id: "open", value: order.orderId,  }, to: `${order.shipTo.name} · ${order.shipTo.city}${order.shipTo.region ? `, ${order.shipTo.region}` : ""}`, status: dotted(status(order)),
    })),
  });
  if (orders.length > ORDERS_PER_PAGE) blocks.push(context(`Orders ${start + 1} to ${start + shown.length} of ${orders.length}, newest first. Refresh goes back to the newest.`));
  blocks.push(context("Refunds, label history, Settings and your Pitney Bowes account are on Ship's own page."), { type: "actions", elements: [
    { type: "button", label: "Refresh", action_id: "list" },
    link("Open Ship", pages.orders), link("Ship Settings", pages.settings),
  ] });
  return { blocks, ...(toast ? { toast } : {}) };
}

/** A label's status in the Labels table: its delivery, or Bought, or Cancelled with the refund. */
function labelStatus(label: Label): string {
  if (label.status === "cancelled") return label.refund && !label.test ? `Cancelled, refund ${label.refund.toLowerCase()}` : "Cancelled";
  return label.delivery ? deliveryText(label.delivery) : label.practice ? "Practice" : "Bought";
}

/** Every label Ship made for the order, newest first, as one table (the live one included). */
function labelsTable(labels: Label[]): Block {
  return { type: "table", page_action_id: "labels", columns: [
    { key: "bought", label: "Bought" }, { key: "service", label: "Service" }, { key: "tracking", label: "Tracking number" },
    { key: "status", label: "Status" },
  ], rows: labels.map(label => ({
    bought: day(label.createdAt), service: `${SERVICES[label.service] ?? label.service}, ${postage(label)}`, tracking: grouped(label), status: dotted(labelStatus(label)),
  })) };
}

/**
 * The label form: box and weight, then once Ship has quoted them, the USPS services with their
 * prices to pick from and "Buy label". A practice label needs no quote (Pitney Bowes is not asked),
 * so picking it goes straight to the buy step; so does Ship's "tick Buy a new label" refusal,
 * which must be answered on the buy step, with the service kept and no new quote.
 */
function labelForm(view: OrderView): Block[] {
  const { order, settings, typed = {}, prices } = view;
  const box = settings.boxes.find(candidate => candidate.boxId === typed.boxId) ?? settings.boxes[0]!;
  const packed = typed.weightOz ?? Math.round((order.itemsWeightOz + box.weightOz) * 10) / 10;
  const id = `${order.version}:${encodeURIComponent(order.orderId)}`;
  const boxOption = (candidate: Box) => ({ label: `${candidate.name}: ${candidate.lengthIn} × ${candidate.widthIn} × ${candidate.heightIn} in, ${weight(candidate.weightOz)} empty`, value: candidate.boxId });
  const practiceOnly = order.test && !settings.testSandbox;
  const practice = practiceOnly || (order.test && typed.kind === "practice");
  const buyAgain = view.askBuyAgain === true || typed.buyAgain === true;
  const quoted = prices !== undefined || practice || buyAgain;
  const form: FormField[] = [
    { type: "select", action_id: "boxId", label: "Box", options: settings.boxes.map(boxOption), initial_value: box.boxId },
    // A text field: the browser's number field rejects most tenths of an ounce as "not a valid value".
    { type: "text_input", action_id: "weightOz", label: `Package weight in ounces, items plus box (16 oz = 1 lb)`, initial_value: String(Math.max(0.1, Math.min(MAX_WEIGHT_OZ, packed))), placeholder: "28.5" },
  ];
  if (quoted) {
    // Radio choices, as Shopify and WooCommerce Shipping list rates: every service and its price in view.
    form.push({ type: "radio", action_id: "service", label: prices === undefined ? "USPS service" : "USPS service and price", initial_value: typed.service && typed.service in SERVICES ? typed.service : "GA",
      options: (Object.keys(SERVICES) as ServiceCode[]).map(code => ({ value: code, label: prices === undefined ? SERVICES[code]
        : `${SERVICES[code]} · ${prices[code] == null ? "not available for this package" : money(prices[code]!)}` })) });
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

/**
 * One order, laid out like the Commerce order page and WooCommerce Shipping: who it goes to beside
 * the package or label, the label's next step, the items to pack, then every label Ship made.
 */
export function orderPage(view: OrderView, toast?: Toast): BlockResponse {
  const { order, settings, siteId } = view;
  const pages = shipPages(siteId), label = order.label;
  const quantity = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const missing = order.lines.filter(line => line.weightOz === null).length;
  const next = label ? status(order) : order.status === "completed" ? "Completed in Commerce" : order.addressProblem ? "Fix address" : "ready to ship · No label yet";
  const blocks: Block[] = [header("Shipments"), { type: "actions", elements: [{ type: "button", label: "Back to Shipments", action_id: "list" }] },
    header(`Order ${orderName(order)}`), context(`${count(quantity)}${label || order.status === "completed" || order.addressProblem ? " · " : " "}${next}`)];
  if (order.test) blocks.push(banner("alert", "TEST order", "Nothing ships and nothing is charged. A TEST order gets a free Pitney Bowes sandbox label, or a practice label, never live postage."));
  if (view.failure) blocks.push(banner("error", label ? "Not done" : "No label bought", view.failure));
  if (order.addressProblem && !label) {
    blocks.push(banner("error", "This address cannot take a label yet", `${order.addressProblem} Correct it on the order in Commerce; Commerce sends Ship the corrected address.`));
  }
  // Two columns, as on Commerce's order page: EmDash's columns never stack, so only short lines go in them.
  blocks.push({ type: "columns", columns: [
    [header("Ship to"), ...parcelLines(order.shipTo)],
    label
      ? [header("Label"), section(SERVICES[label.service] ?? label.service), section(`Tracking ${grouped(label)}`),
        section(`${label.box.name}, ${weight(label.weightOz)}`), ...(label.delivery ? [section(delivered(label.delivery))] : [])]
      : [header("Package"), section(count(quantity)), section(missing === order.lines.length ? "No item weights in Commerce" : `Items weigh ${weight(order.itemsWeightOz)}`),
        section(missing ? `${missing === 1 ? "1 item has" : `${missing} items have`} no weight: weigh the package` : "Plus the box, added when you buy")],
  ] }, { type: "divider" });
  if (label) {
    // Print label is the one main button, beside the line saying what was bought, as Complete order sits on Commerce's page.
    const bought: Block = { type: "section", text: `Label bought ${when(label.createdAt)} · ${price(label)}`, ...(view.printUrl ? { accessory: link("Print label", view.printUrl, "primary") } : {}) };
    const actions: Block & { type: "actions" } = { type: "actions", elements: [] };
    if (!label.test) actions.elements.push(link("Track on USPS", trackUrl(label)));
    actions.elements.push({ type: "button", label: "Cancel label", action_id: `cancel:${encodeURIComponent(order.orderId)}`, value: label.labelId,
      confirm: { title: "Cancel this label?", text: label.practice ? "The practice label is thrown away. The order stays as it is in Commerce." :
        label.test ? "The sandbox label is voided with Pitney Bowes. The order stays as it is in Commerce." :
        "The label is voided with Pitney Bowes and USPS refunds your postage account within about 14 days. The order stays as it is in Commerce.", confirm: "Cancel label", deny: "Keep label", style: "danger" } });
    blocks.push(bought, actions,
      context(view.printUrl ? "Print label opens the PDF in a new tab. The link works for 5 minutes; open the order again for a fresh one."
        : "Ship could not make a print link just now. Open the order again, or print from Ship's own page."));
  } else if (order.status === "completed") {
    blocks.push(section("This order is Completed in Commerce, so Ship makes no label for it. Move it back to Processing in Commerce's Orders page first."));
  }
  blocks.push({ type: "table", page_action_id: "items", columns: [
    { key: "item", label: "Item" }, { key: "quantity", label: "Qty" }, { key: "each", label: "Weight each" }, { key: "total", label: "Weight" },
  ], rows: order.lines.map(line => ({ item: line.name, quantity: `× ${line.quantity}`,
    each: line.weightOz === null ? "Not set" : weight(line.weightOz), total: line.weightOz === null ? "Not set" : weight(line.weightOz * line.quantity) })) });
  if (missing && !label && order.status === "processing") {
    blocks.push(banner("alert", "Item weights missing", "Some items have no weight in Commerce. Weigh the whole package and update Package weight before checking prices or buying a label."));
  }
  if (!label && order.status === "processing" && !order.addressProblem) {
    if (!settings.shipFrom || settings.boxes.length === 0) {
      blocks.push(banner("alert", "Set up Ship first", "Labels need your ship-from address and at least one box size. Add them in Ship Settings, then open this order again."));
    } else if (!order.test && !settings.postageConnected) {
      blocks.push(banner("alert", "Connect your Pitney Bowes account first", "Real orders' labels are paid from your own Pitney Bowes postage account. Connect it in Ship Settings, then open this order again."));
    } else {
      blocks.push(header(order.labels.length ? "Buy a new label" : "Buy a label"), ...labelForm(view));
    }
  }
  if (order.labels.length) blocks.push(header("Labels"), labelsTable(order.labels));
  blocks.push({ type: "actions", elements: [link("Open in Ship", pages.order(order.orderId)), link("Ship Settings", pages.settings)] });
  return { blocks, ...(toast ? { toast } : {}) };
}
