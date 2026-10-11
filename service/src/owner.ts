import { ServiceError, type Outcome } from "./errors.js";
import { html, messagePage, orderPage, ordersPage, settingsPage } from "./pages.js";
import { finishSignIn, readSession, requireSameOrigin, signInConfigured, signOut, startSignIn, type OwnerSession } from "./session.js";
import type { StoreShipping } from "./store.js";

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
      return html(orderPage(site, session.email, summary, await store.getSettings()));
    },
  },
  {
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/orders/${SEGMENT}/labels$`),
    handle: async ({ site, session, store, params, fields }) => {
      const outcome = await outcomeOf(store.buyLabel({ orderId: params[0]!, fields, uid: session.uid }));
      if (outcome.ok) return see(`${storePath(site)}/orders/${encodeURIComponent(params[0]!)}`);
      const summary = await store.orderSummary(params[0]!);
      if (!summary) return messagePage("Order not found", outcome.message, { href: `${storePath(site)}/orders`, text: "Back to orders" }, 404);
      return html(orderPage(site, session.email, summary, await store.getSettings(), outcome.message), errorStatus(outcome));
    },
  },
  {
    method: "GET", pattern: new RegExp(`^/stores/${SEGMENT}/labels/${SEGMENT}\\.pdf$`),
    handle: async ({ store, params }) => {
      const pdf = await store.labelPdf(params[0]!);
      if (!pdf) return messagePage("Label not found", "This store has no such label.", undefined, 404);
      return new Response(pdf, { headers: {
        "content-type": "application/pdf", "content-disposition": `inline; filename="label-${params[0]!.replace(/[^A-Za-z0-9_-]/g, "")}.pdf"`,
        "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      } });
    },
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
    method: "POST", pattern: new RegExp(`^/stores/${SEGMENT}/settings/boxes/${SEGMENT}/remove$`),
    handle: async ({ site, session, store, params }) => settingsResult(site, session, store, await outcomeOf(store.removeBox(params[0]!))),
  },
];

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
