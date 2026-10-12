import type { LabelAddress } from "./address.js";
import type { ShipOrder } from "./order.js";
import { signupUrl } from "./pitney.js";
import { MAX_WEIGHT_OZ, SERVICES, type Label, type OrderSummary, type Quotes, type ServiceCode, type Settings } from "./store.js";

/** Escapes text for HTML element content and attribute values. */
export function esc(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1d1d1f;--muted:#6b6b70;--line:#d9d9de;--accent:#0b5cad;--warn:#8a4b00;--warnbg:#fff4e0;--bad:#a1121a}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececf0;--muted:#a0a0a8;--line:#34343a;--accent:#6aa7ff;--warn:#ffcf8a;--warnbg:#3a2a10;--bad:#ff8a8f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
header nav{display:flex;gap:16px;align-items:center}main{max-width:880px;margin:0 auto;padding:16px}
a{color:var(--accent)}h1{font-size:22px;margin:8px 0 16px}h2{font-size:17px;margin:24px 0 8px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
.muted{color:var(--muted)}.tag{display:inline-block;padding:0 6px;border-radius:4px;border:1px solid var(--line);font-size:12px}
.test{background:var(--warnbg);color:var(--warn);border-color:var(--warn)}.notice{background:var(--warnbg);color:var(--warn);padding:10px 12px;border-radius:6px;margin:12px 0}
.error{color:var(--bad);font-weight:600}form.inline{display:inline}label{display:block;margin:8px 0 2px;font-weight:600}
input,select{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);width:100%;max-width:420px}
.row{display:flex;gap:8px;flex-wrap:wrap}.row>div{flex:1;min-width:90px}
button{font:inherit;padding:7px 14px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;margin-top:12px}
button.secondary{background:transparent;color:var(--accent)}button:disabled{opacity:.5;cursor:not-allowed}
`;

export function page(title: string, body: string, options: { site?: string; email?: string } = {}): string {
  const base = options.site ? `/stores/${encodeURIComponent(options.site)}` : "";
  const nav = options.site
    ? `<nav><a href="${base}/orders">Orders</a><a href="${base}/settings">Settings</a>${options.email
      ? `<span class="muted">${esc(options.email)}</span><form class="inline" method="post" action="/auth/sign-out"><button class="secondary" style="margin:0">Sign out</button></form>` : ""}</nav>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · DinkusKit Ship</title><style>${STYLE}</style></head>
<body><header><strong>DinkusKit Ship</strong>${nav}</header><main>${body}</main></body></html>`;
}

export function html(body: string, status = 200, headers?: HeadersInit): Response {
  const result = new Response(body, { status, headers });
  result.headers.set("content-type", "text/html; charset=utf-8");
  result.headers.set("cache-control", "no-store");
  result.headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  result.headers.set("x-content-type-options", "nosniff");
  result.headers.set("referrer-policy", "same-origin");
  return result;
}

export function messagePage(title: string, message: string, link?: { href: string; text: string }, status = 200): Response {
  return html(page(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p>${link ? `<p><a href="${esc(link.href)}">${esc(link.text)}</a></p>` : ""}`), status);
}

function orderName(order: ShipOrder): string {
  return order.number === null ? order.orderId : `#${order.number}`;
}

function liveLabel(summary: OrderSummary): Label | undefined {
  return summary.labels.find(label => label.status === "bought" && label.version === summary.order.version);
}

function addressBlock(address: ShipOrder["shipTo"]): string {
  return [address.name, address.line1, address.line2, `${address.city}${address.region ? `, ${address.region}` : ""} ${address.postalCode}`]
    .filter(Boolean).map(esc).join("<br>");
}

export function ordersPage(site: string, email: string, orders: OrderSummary[]): string {
  const rows = orders.map(summary => {
    const { order } = summary;
    const label = liveLabel(summary);
    const state = order.status === "completed" ? "Completed" : label ? "Label bought" : summary.address.ok ? "Waiting for a label" : "Address needs a fix";
    return `<tr><td><a href="/stores/${encodeURIComponent(site)}/orders/${encodeURIComponent(order.orderId)}">${esc(orderName(order))}</a>
      ${order.test ? ' <span class="tag test">TEST</span>' : ""}</td><td>${esc(order.shipTo.name)}<br><span class="muted">${esc(order.shipTo.city)}${order.shipTo.region ? `, ${esc(order.shipTo.region)}` : ""}</span></td>
      <td>${order.lines.reduce((sum, line) => sum + line.quantity, 0)}</td><td>${esc(state)}</td></tr>`;
  }).join("");
  const body = orders.length
    ? `<table><thead><tr><th>Order</th><th>Ship to</th><th>Items</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="muted">No orders yet. Paid orders with a delivery address arrive here from Commerce.</p>`;
  return page("Orders", `<h1>Orders</h1>${body}`, { site, email });
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function labelRow(site: string, label: Label, current: boolean): string {
  const base = `/stores/${encodeURIComponent(site)}/labels/${encodeURIComponent(label.labelId)}`;
  const actions = label.status === "bought"
    ? `<a href="${base}.pdf" target="_blank" rel="noopener">Open PDF to print</a>
       <form class="inline" method="post" action="${base}/cancel"><button class="secondary" style="margin:0 0 0 12px">Cancel label</button></form>`
    : `<span class="muted">Cancelled${label.refund && !label.test ? ". USPS refunds your postage account, which can take up to 14 days." : ""}</span>`;
  return `<tr><td>${esc(SERVICES[label.service])}${label.practice ? ' <span class="tag test">PRACTICE</span>' : label.test ? ' <span class="tag test">TEST SANDBOX</span>' : ""}${current ? "" : ' <span class="muted">(older order version)</span>'}</td>
    <td>${esc(label.tracking)}</td><td>${esc(label.box.name)}, ${esc(label.weightOz)} oz</td>
    <td>${label.priceCents === null ? '<span class="muted">—</span>' : `${money(label.priceCents)}${label.test ? ' <span class="muted">(sandbox, not charged)</span>' : ""}`}</td><td>${actions}</td></tr>`;
}

/** What the label form shows besides the order: an error, the owner's last choices, prices. */
export interface LabelForm {
  error?: string; fields?: Record<string, string>; quotes?: Quotes; askBuyAgain?: boolean;
  /** The latest completion's shipped email. */
  shippedEmail?: { state: string; sentAt: number | null } | null;
}

const EMAIL_STATES: Record<string, string> = {
  pending: "Ship is sending the shipped email.",
  sent: "Ship sent the shipped email.",
  no_recipient: "No shipped email: the order has no email address to send to.",
  failed: "The shipped email could not be sent.",
  expired: "The shipped email could not be sent in time and was dropped.",
};

export function orderPage(site: string, email: string, summary: OrderSummary, settings: Settings, options: LabelForm = {}): string {
  const { order } = summary;
  const { error, fields = {}, quotes } = options;
  const label = liveLabel(summary);
  const knownWeight = order.lines.reduce((sum, line) => sum + (line.weightOz ?? 0) * line.quantity, 0);
  const missingWeight = order.lines.some(line => line.weightOz === undefined);
  const lines = order.lines.map(line => `<tr><td>${esc(line.name)}</td><td>${line.quantity}</td>
    <td>${line.weightOz === undefined ? '<span class="muted">not set</span>' : `${esc(line.weightOz)} oz`}</td>
    <td>${line.unitPrice ? `$${(Number(line.unitPrice.minor) / 100).toFixed(2)}` : '<span class="muted">—</span>'}</td></tr>`).join("");
  const notices: string[] = [];
  const sandbox = order.test && settings.testSandbox;
  if (sandbox) notices.push("This is a TEST order. Ship makes a free Pitney Bowes sandbox label: nothing is charged and it is not real postage, so never mail with it.");
  else if (order.test) notices.push("This is a TEST order. Ship makes a practice label marked \"TEST - NOT POSTAGE\" and buys no postage.");
  else if (!settings.postageConnected) notices.push("Pitney Bowes is not connected to Ship yet, so only TEST orders can get labels.");
  else if (!settings.postageAccount) notices.push(`Connect your Pitney Bowes postage account in <a href="/stores/${encodeURIComponent(site)}/settings">Settings</a> before buying labels for real orders.`);
  if (!summary.address.ok) notices.push(summary.address.problem);
  if (!settings.shipFrom) notices.push(`Add your ship-from address in <a href="/stores/${encodeURIComponent(site)}/settings">Settings</a> before buying labels.`);
  if (!settings.boxes.length) notices.push(`Add your box sizes in <a href="/stores/${encodeURIComponent(site)}/settings">Settings</a> before buying labels.`);
  if (missingWeight) notices.push("Some items have no weight in Commerce, so check the package weight before buying.");
  const blocked = order.status !== "processing" || Boolean(label) || !summary.address.ok || !settings.shipFrom || !settings.boxes.length ||
    (!order.test && (!settings.postageConnected || !settings.postageAccount));
  const base = `/stores/${encodeURIComponent(site)}/orders/${encodeURIComponent(order.orderId)}`;
  const chosenBox = settings.boxes.find(box => box.boxId === fields.boxId) ?? settings.boxes[0];
  const weight = fields.weightOz ?? (chosenBox ? String(Math.round((knownWeight + chosenBox.weightOz) * 10) / 10) : "");
  const chosenService = fields.service && fields.service in SERVICES ? fields.service : "GA";
  const price = (code: ServiceCode) => {
    if (!quotes || !(code in quotes)) return "";
    const cents = quotes[code];
    return cents === null || cents === undefined ? " (not available for this package)" : `: ${money(cents)}`;
  };
  const form = order.status === "completed"
    ? `<p>This order is Completed in Commerce${order.completed?.tracking ? ` with tracking ${esc(order.completed.tracking)}` : ""}.</p>${
      options.shippedEmail && EMAIL_STATES[options.shippedEmail.state] ? `<p class="muted">${esc(EMAIL_STATES[options.shippedEmail.state])}${order.test ? " TEST orders email you, never the shopper." : ""}</p>` : ""}`
    : label ? `<p>This order has a label. Commerce marks it Completed with the tracking number on its next check.</p>`
    : `<form method="post" action="${base}/labels">
      <input type="hidden" name="version" value="${order.version}">
      <label for="boxId">Box</label><select id="boxId" name="boxId" required>${settings.boxes.map(box =>
        `<option value="${esc(box.boxId)}"${box === chosenBox ? " selected" : ""}>${esc(box.name)}: ${box.lengthIn} × ${box.widthIn} × ${box.heightIn} in, ${box.weightOz} oz empty</option>`).join("")}</select>
      <label for="weightOz">Package weight (oz)</label>
      <input id="weightOz" name="weightOz" type="number" step="0.1" min="0.1" max="${MAX_WEIGHT_OZ}" required value="${esc(weight)}">
      <p class="muted">Items ${Math.round(knownWeight * 10) / 10} oz plus the empty box. Change it if your scale says otherwise.</p>
      <label for="service">Service</label><select id="service" name="service">${Object.entries(SERVICES).map(([code, name]) =>
        `<option value="${code}"${code === chosenService ? " selected" : ""}>${esc(name)}${esc(price(code as ServiceCode))}</option>`).join("")}</select>
      ${options.askBuyAgain ? '<label><input type="checkbox" name="buyAgain" value="yes" style="width:auto"> Buy a new label (Pitney Bowes has no record of the last one)</label>' : ""}
      ${sandbox ? `<p class="muted">Sandbox prices come from Pitney Bowes's test system. Nothing is charged to any postage account.</p>
      <button class="secondary" formaction="${base}/prices"${blocked ? " disabled" : ""}>See prices</button> <button${blocked ? " disabled" : ""}>Make sandbox label</button>
      <button class="secondary" name="kind" value="practice"${blocked ? " disabled" : ""}>Make practice label instead</button>`
      : order.test ? `<button${blocked ? " disabled" : ""}>Make practice label</button>`
      : `<p class="muted">${quotes ? "Prices come from your Pitney Bowes postage account." : "Check prices before buying, or buy at the price Pitney Bowes charges."} Postage is paid from your Pitney Bowes postage account.</p>
      <button class="secondary" formaction="${base}/prices"${blocked ? " disabled" : ""}>See prices</button> <button${blocked ? " disabled" : ""}>Buy label</button>`}</form>`;
  const labels = summary.labels.length
    ? `<h2>Labels</h2><table><thead><tr><th>Service</th><th>Tracking</th><th>Package</th><th>Postage</th><th></th></tr></thead><tbody>${summary.labels.map(item => labelRow(site, item, item.version === order.version)).join("")}</tbody></table>`
    : "";
  return page(`Order ${orderName(order)}`, `<p><a href="/stores/${encodeURIComponent(site)}/orders">← Orders</a></p>
    <h1>Order ${esc(orderName(order))}${order.test ? ' <span class="tag test">TEST</span>' : ""}</h1>
    ${error ? `<p class="error">${esc(error)}</p>` : ""}${notices.map(text => `<div class="notice">${text.includes("<a ") ? text : esc(text)}</div>`).join("")}
    <h2>Ship to</h2><p>${addressBlock(order.shipTo)}</p>
    <h2>In the box</h2><table><thead><tr><th>Item</th><th>Qty</th><th>Weight each</th><th>Price paid each</th></tr></thead><tbody>${lines}</tbody></table>
    ${labels}<h2>${label || order.status === "completed" ? "Shipping" : "Create shipping label"}</h2>${form}`, { site, email });
}

/** Real orders' labels are paid from the owner's own Pitney Bowes postage account (decision 2a). */
function postageBox(base: string, email: string, settings: Settings): string {
  const account = settings.postageAccount;
  if (account) {
    const details = [account.company, account.accountEnding ? `postage account ending ${account.accountEnding}` : null, account.email].filter(Boolean).map(esc).join(" · ");
    return `<h2>Postage</h2><p>Connected to Pitney Bowes: ${details || "your postage account"}.</p>
      <p class="muted">Labels for real orders are paid from this account. Pitney Bowes charges your card there, not DinkusKit.</p>
      <form method="post" action="${base}/postage/disconnect"><button class="secondary">Disconnect Pitney Bowes</button></form>`;
  }
  const intro = `<h2>Postage</h2><p>To buy USPS labels for real orders, you need your own Pitney Bowes postage account. Pitney Bowes charges postage to the card you add there, not DinkusKit. TEST orders don't need one.</p>`;
  if (!settings.signupDeveloperId) return `${intro}<p class="muted">Connecting a Pitney Bowes account isn't available in Ship yet.</p>`;
  const from = settings.shipFrom;
  const link = signupUrl(settings.signupDeveloperId, {
    email, name: from?.name, company: from?.company ?? settings.storeName ?? undefined,
    line1: from?.line1, line2: from?.line2, city: from?.city, state: from?.region, postalCode: from?.postalCode,
  });
  return `${intro}${settings.testSandbox ? '<p class="muted">Ship is on the Pitney Bowes sandbox, so this makes a test account and nothing is charged.</p>' : ""}
    <p><strong>1.</strong> <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Create your Pitney Bowes account</a> (opens Pitney Bowes with your details filled in). Add a card there; Pitney Bowes refills your postage balance automatically. Use this link: an account made elsewhere may not connect.</p>
    <p><strong>2.</strong> Come back here and connect it. Ship sends your username and password to Pitney Bowes once to find your account, and never keeps your password.</p>
    <form method="post" action="${base}/postage" autocomplete="off">
      <div><label for="pbUsername">Pitney Bowes username</label><input id="pbUsername" name="username" required autocomplete="off"></div>
      <div><label for="pbPassword">Pitney Bowes password</label><input id="pbPassword" name="password" type="password" required autocomplete="off"></div>
      <button>Connect Pitney Bowes</button></form>`;
}

export function settingsPage(site: string, email: string, settings: Settings, error?: string): string {
  const from = settings.shipFrom;
  const field = (name: string, label: string, value = "", required = true) =>
    `<div><label for="${name}">${esc(label)}</label><input id="${name}" name="${name}" value="${esc(value)}"${required ? " required" : ""}></div>`;
  const base = `/stores/${encodeURIComponent(site)}/settings`;
  const boxes = settings.boxes.map(box => `<tr><td>${esc(box.name)}</td><td>${box.lengthIn} × ${box.widthIn} × ${box.heightIn} in</td><td>${box.weightOz} oz</td>
    <td><form class="inline" method="post" action="${base}/boxes/${encodeURIComponent(box.boxId)}/remove"><button class="secondary" style="margin:0">Remove</button></form></td></tr>`).join("");
  return page("Settings", `<h1>Settings</h1>${error ? `<p class="error">${esc(error)}</p>` : ""}
    <h2>Ship from</h2><p class="muted">The return address printed on every label.</p>
    <form method="post" action="${base}/ship-from">
      ${field("name", "Name", from?.name)}${field("company", "Company (optional)", from?.company, false)}
      ${field("line1", "Address", from?.line1)}${field("line2", "Address line 2 (optional)", from?.line2, false)}
      <div class="row">${field("city", "City", from?.city)}${field("region", "State", from?.region)}${field("postalCode", "ZIP code", from?.postalCode)}</div>
      <button>Save ship-from address</button></form>
    ${postageBox(base, email, settings)}
    <h2>Shipped email</h2><p class="muted">Sent from orders@dinkuskit.com under ${settings.storeName ? `the name ${esc(settings.storeName)} (your store's Site title)` : "your store's Site title"}. When a shopper replies, the reply goes here.</p>
    <form method="post" action="${base}/reply-to">${field("replyTo", "Reply-to email", settings.replyTo ?? "")}
      <button>Save reply-to email</button></form>
    <h2>Box sizes</h2>${boxes ? `<table><thead><tr><th>Name</th><th>Size</th><th>Empty weight</th><th></th></tr></thead><tbody>${boxes}</tbody></table>` : '<p class="muted">No box sizes yet.</p>'}
    <form method="post" action="${base}/boxes">${field("name", "Box name")}
      <div class="row">${field("lengthIn", "Length (in)")}${field("widthIn", "Width (in)")}${field("heightIn", "Height (in)")}${field("weightOz", "Empty weight (oz)", "0")}</div>
      <button>Add box size</button></form>`, { site, email });
}

export type { LabelAddress };
