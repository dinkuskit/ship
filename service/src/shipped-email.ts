import type { ShipOrder } from "./order.js";

/** The sender address when the deploy names none; the sender name is the store's Site title. */
export const DEFAULT_FROM = "orders@dinkuskit.com";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** USPS's public tracking page for a tracking number; other carriers get no link. */
export function trackingLink(carrier: string | undefined, tracking: string | undefined): string | null {
  if (!tracking || !carrier || carrier.trim().toUpperCase() !== "USPS") return null;
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking)}`;
}

/**
 * The short "your order has shipped" email: store name, order number, carrier and
 * tracking. No item list, so Ship never puts cart contents in an email. Shipped
 * means handed to the carrier, never delivered.
 */
export function shippedEmail(order: ShipOrder, options: { to: string; from: string; storeName: string | null; replyTo: string | null }): EmailMessageBuilder {
  const store = options.storeName;
  const number = order.number === null ? order.orderId : `#${order.number}`;
  const carrier = order.completed?.carrier?.trim();
  const tracking = order.completed?.tracking?.trim();
  const link = trackingLink(carrier, tracking);
  const subject = `${order.test ? "[TEST] " : ""}Your order ${number} has shipped`;
  const lines = [
    ...(order.test ? ["This is a TEST order. Only the store owner gets this email, and nothing was mailed."] : []),
    `Good news: your order ${number}${store ? ` from ${store}` : ""} has shipped.`,
    ...(carrier ? [`Carrier: ${carrier}`] : []),
    ...(tracking ? [`Tracking number: ${tracking}`] : []),
    ...(link ? [`Track it: ${link}`] : []),
    "Reply to this email if you have a question about your order.",
  ];
  const html = [
    ...(order.test ? [`<p><strong>This is a TEST order.</strong> Only the store owner gets this email, and nothing was mailed.</p>`] : []),
    `<p>Good news: your order ${esc(number)}${store ? ` from ${esc(store)}` : ""} has shipped.</p>`,
    ...(carrier || tracking ? [`<p>${carrier ? `Carrier: ${esc(carrier)}<br>` : ""}${tracking ? `Tracking number: ${esc(tracking)}` : ""}</p>`] : []),
    ...(link ? [`<p><a href="${esc(link)}">Track your package</a></p>`] : []),
    "<p>Reply to this email if you have a question about your order.</p>",
  ];
  return {
    to: options.to,
    from: { email: options.from, name: store ?? "Order update" },
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    subject,
    text: `${lines.join("\n\n")}\n`,
    html: html.join("\n"),
  };
}
