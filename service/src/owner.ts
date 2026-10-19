import { ServiceError, type Outcome } from "./errors.js";
import { html, messagePage, orderPage, ordersPage, settingsPage } from "./pages.js";
import { finishSignIn, openPrintLink, readSession, requireSameOrigin, signInConfigured, signOut, startSignIn, type OwnerSession } from "./session.js";
import type { Quotes, StoreShipping } from "./store.js";

/** Store ids, order ids and record ids as they appear in a path segment. */
const SEGMENT = "([A-Za-z0-9._:%-]{1,600})";
const MAX_FORM_BYTES = 16 * 1024;

type Store = DurableObjectStub<StoreShipping>;
type Fields = Record<string, string>;
interface Context { site: string; session: OwnerSession; store: Store; params: string[]; fields: Fields }
type PageRoute = { method: "GET" | "POST"; pattern: RegExp; handle: (context: Context) => Promise<Response> };

const see = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
const storePath = (site: string) => `/stores/${encodeURIComponent(site)}`;

/** Durable Object RPC loses the Outcome union's shape in its types; the value is unchanged. */
const outcomeOf = (pending: Promise<unknown>) => pending as Promise<Outcome>;

function errorStatus(outcome: { status: number }): number {
  return outcome.status >= 400 && outcome.status < 600 ? outcome.status : 400;
}

const ROUTES: PageRoute[] = [
  { method: "GET", pattern: new RegExp(`^/stores/${SEGMENT}/?$`), handle: async ({ site }) => see(`${storePath(site)}/orders`) },
  {
    method: "GET", pattern: new RegExp(`^/stores/${SEGMENT}/orders$`),
    handle: async ({ site, session, store }) => html(ordersPage(site, session.email, await store.listOrders())),
  },
  {
    method: "GET", pattern: new RegExp(`^/stores/${SEGMENT}/orders/${SEGMENT}$`),
    handle: async ({ site, session, store, params }) => {
      const summary = await store.orderSummary(params[0]!);
      if (!summary) return messagePage("Order not found", "Ship has not received this order from Commerce yet. Open Orders in Commerce, then try again.", { href: `${storePath(site)}/orders`, text: "Back to orders" }, 404);
      return html(orderPage(site, session.email, summary, await store.getSettings(), { shippedEmail: await store.shippedEmailState(params[0]!) }));
    },
  },
  {
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/orders/${SEGMENT}/labels$`),
    handle: async ({ site, session, store, params, fields }) => {
      const outcome = await outcomeOf(store.buyLabel({ orderId: params[0]!, fields, uid: session.uid }));
      if (outcome.ok) return see(`${storePath(site)}/orders/${encodeURIComponent(params[0]!)}`);
      const summary = await store.orderSummary(params[0]!);
      if (!summary) return messagePage("Order not found", outcome.message, { href: `${storePath(site)}/orders`, text: "Back to orders" }, 404);
      return html(orderPage(site, session.email, summary, await store.getSettings(),
        { error: outcome.message, fields, askBuyAgain: outcome.code === "CHECK_PITNEY_BOWES" }), errorStatus(outcome));
    },
  },
  {
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/orders/${SEGMENT}/prices$`),
    handle: async ({ site, session, store, params, fields }) => {
      const outcome = await outcomeOf(store.quoteLabel({ orderId: params[0]!, fields }));
      const summary = await store.orderSummary(params[0]!);
      if (!summary) return messagePage("Order not found", "Ship has not received this order.", { href: `${storePath(site)}/orders`, text: "Back to orders" }, 404);
      const form = outcome.ok ? { fields, quotes: outcome.body as Quotes } : { fields, error: outcome.message };
      return html(orderPage(site, session.email, summary, await store.getSettings(), form), outcome.ok ? 200 : errorStatus(outcome));
    },
  },
  {
    method: "GET", pattern: new RegExp(`^/stores/${SEGMENT}/labels/${SEGMENT}\\.pdf$`),
    handle: async ({ store, params }) => labelPdf(store, params[0]!),
  },
  {
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/labels/${SEGMENT}/cancel$`),
    handle: async ({ site, store, params }) => {
      const label = await store.labelOrder(params[0]!);
      const outcome = await outcomeOf(store.cancelLabel(params[0]!));
      if (!outcome.ok || !label) {
        return messagePage("Label not cancelled", outcome.ok ? "This store has no such label." : outcome.message,
          { href: `${storePath(site)}/orders`, text: "Back to orders" }, outcome.ok ? 404 : errorStatus(outcome));
      }
      return see(`${storePath(site)}/orders/${encodeURIComponent(label)}`);
    },
  },
  {
    method: "GET", pattern: new RegExp(`^/stores/${SEGMENT}/settings$`),
    handle: async ({ site, session, store }) => html(settingsPage(site, session.email, await store.getSettings())),
  },
  {
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/settings/ship-from$`),
    handle: async ({ site, session, store, fields }) => settingsResult(site, session, store, await outcomeOf(store.saveShipFrom(fields))),
  },
  {
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/settings/reply-to$`),
    handle: async ({ site, session, store, fields }) => settingsResult(site, session, store, await outcomeOf(store.saveReplyTo(fields))),
  },
  {
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/settings/boxes$`),
    handle: async ({ site, session, store, fields }) => settingsResult(site, session, store, await outcomeOf(store.addBox(fields))),
  },
  {
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/settings/postage$`),
    handle: async ({ site, session, store, fields }) => settingsResult(site, session, store, await outcomeOf(store.connectPostage(fields, session.uid))),
  },
  {
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/settings/postage/disconnect$`),
    handle: async ({ site, session, store }) => settingsResult(site, session, store, await outcomeOf(store.disconnectPostage())),
  },
  {
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/settings/boxes/${SEGMENT}/remove$`),
    handle: async ({ site, session, store, params }) => settingsResult(site, session, store, await outcomeOf(store.removeBox(params[0]!))),
  },
];

/** The label's PDF, for printing; the owner's page and the plugin's print link both end here. */
async function labelPdf(store: Store, labelId: string): Promise<Response> {
  const pdf = await store.labelPdf(labelId);
  if (!pdf) return messagePage("Label not found", "This store has no such label.", undefined, 404);
  if (pdf === "not_ready") return messagePage("Label PDF not ready", "The label is bought, but Ship could not download its PDF from Pitney Bowes yet. Try again in a minute.", undefined, 503);
  return new Response(pdf, { headers: {
    "content-type": "application/pdf", "content-disposition": `inline; filename="label-${labelId.replace(/[^A-Za-z0-9_-]/g, "")}.pdf"`,
    "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  } });
}

/**
 * GET /print/{token}: the one label a print link from the Ship Registry plugin
 * names, for five minutes, with no sign-in (ship-registry-plugin-001). An expired
 * or foreign link opens nothing; "Print label" in the store admin makes a new one.
 */
export async function handlePrint(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") return messagePage("Not found", "There is no such page.", undefined, 404);
  try {
    const link = await openPrintLink(env, url.pathname.slice("/print/".length));
    if (!link) return messagePage("Print link expired", "This print link has expired or is not one Ship made. Press Print label in your store admin for a new one.", undefined, 410);
    return await labelPdf(env.SHIP_STORES.get(env.SHIP_STORES.idFromName(link.site)), link.labelId);
  } catch (error) {
    if (error instanceof ServiceError) return messagePage("Something went wrong", error.message, undefined, error.status);
    console.error("ship print error", error);
    return messagePage("Something went wrong", "Ship could not open the label. Try again.", undefined, 500);
  }
}

async function settingsResult(site: string, session: OwnerSession, store: Store, outcome: Outcome): Promise<Response> {
  if (outcome.ok) return see(`${storePath(site)}/settings`);
  return html(settingsPage(site, session.email, await store.getSettings(), outcome.message), errorStatus(outcome));
}

async function readForm(request: Request): Promise<Fields> {
  if (Number(request.headers.get("content-length") ?? "0") > MAX_FORM_BYTES) throw new ServiceError(413, "BODY_TOO_LARGE", "The form is too large.");
  const text = await request.text();
  if (text.length > MAX_FORM_BYTES) throw new ServiceError(413, "BODY_TOO_LARGE", "The form is too large.");
  const fields: Fields = {};
  for (const [key, value] of new URLSearchParams(text)) fields[key] = value;
  return fields;
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The owner's pages: sign-in with DinkusKit.com, orders, labels and settings for one store at a time. */
export async function handlePage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (!signInConfigured(env)) return messagePage("Ship is not set up", "Ship's sign-in is not configured yet.", undefined, 503);
    if (url.pathname === "/auth/callback" && request.method === "GET") {
      const result = await finishSignIn(request, env);
      if (!result.ok) {
        const restart = result.site ? { href: `${storePath(result.site)}/orders`, text: "Start again" } : undefined;
        return messagePage(result.status === 400 ? "Start again" : "Could not sign in", result.message, restart, result.status);
      }
      result.headers.set("location", result.next);
      return new Response(null, { status: 303, headers: result.headers });
    }
    if (url.pathname === "/auth/sign-out" && request.method === "POST") {
      requireSameOrigin(request);
      const signedOut = messagePage("Signed out", "You are signed out of Ship. DinkusKit.com keeps its own sign-in.");
      (await signOut(request, env)).forEach((value, key) => key === "set-cookie" ? signedOut.headers.append(key, value) : signedOut.headers.set(key, value));
      return signedOut;
    }
    for (const route of ROUTES) {
      const found = route.pattern.exec(url.pathname);
      if (!found) continue;
      if (route.method !== request.method) continue;
      const decoded = found.slice(1).map(decode);
      if (decoded.some(value => value === null)) break;
      const [site, ...params] = decoded as string[];
      const signedIn = await readSession(request, env, site!);
      if (!signedIn) {
        // A form posted after the session expired goes back to the store's orders after sign-in.
        return startSignIn(env, site!, request.method === "GET" ? url.pathname : `${storePath(site!)}/orders`);
      }
      const fields = request.method === "POST" ? (requireSameOrigin(request), await readForm(request)) : {};
      const response = await route.handle({ site: site!, session: signedIn.session, store: env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site!)), params, fields });
      if (signedIn.setCookie) response.headers.append("set-cookie", signedIn.setCookie);
      return response;
    }
    return messagePage("Not found", "There is no such page.", undefined, 404);
  } catch (error) {
    if (error instanceof ServiceError) return messagePage("Something went wrong", error.message, undefined, error.status);
    console.error("ship page error", error);
    return messagePage("Something went wrong", "Ship could not finish that. Try again.", undefined, 500);
  }
}
