import type { PluginContext } from "emdash/plugin";

/**
 * The plugin's side of the Ship contract (docs/contracts/ship-plugin-v1.md).
 * The store key goes only to DinkusKit.com's fixed store-passes address, never to
 * Ship or anywhere named in settings (ship-registry-plugin-001, store-key rules).
 * Each click trades the key for a 5-minute ship:admin pass and calls hosted Ship.
 */
export const STORE_PASSES_URL = "https://dinkuskit.com/api/store-passes";
export const ISSUER = "https://dinkuskit.com/account";
export const SHIP_ORIGIN = "https://ship.dinkuskit.com";
export const AUDIENCE = "dinkus-ship";
export const SCOPE = "ship:admin";
const MAX_ANSWER_BYTES = 256 * 1024;
const SITE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export type ServiceCode = "GA" | "PM" | "EM";
export interface Box { boxId: string; name: string; lengthIn: number; widthIn: number; heightIn: number; weightOz: number }
export interface Label {
  labelId: string; orderId: string; version: number; test: boolean; service: ServiceCode; box: Box; weightOz: number;
  carrier: string; tracking: string; status: "bought" | "cancelled"; createdAt: string; cancelledAt: string | null;
  practice: boolean; priceCents: number | null; refund: string | null;
}
export interface ShipOrder {
  orderId: string; number: number | null; version: number; status: "processing" | "completed"; test: boolean;
  shipTo: { name: string; lines: string[]; city: string; region: string; postalCode: string };
  addressProblem: string | null;
  lines: { name: string; quantity: number; weightOz: number | null }[];
  itemsWeightOz: number;
  label: Label | null;
  labels: Label[];
}
export interface ShipSettings { shipFrom: boolean; boxes: Box[]; postageConnected: boolean; testSandbox: boolean }
export type Prices = Partial<Record<ServiceCode, number | null>>;
export interface LabelRequest { version: number; boxId: string; weightOz: number; service?: ServiceCode; kind?: "practice"; buyAgain?: true; by?: string }

/** A refusal with a message the page can show as it is. */
export class ShipError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) {
    super(message);
    this.name = "ShipError";
  }
}

/** The plugin's settings as the owner pasted them, or null until both are there. */
export async function connection(ctx: PluginContext): Promise<{ siteId: string; key: string } | null> {
  const [siteId, key] = await Promise.all([ctx.settings.get<unknown>("siteId"), ctx.settings.get<unknown>("storeKey")]);
  const site = typeof siteId === "string" ? siteId.trim() : "", secret = typeof key === "string" ? key.trim() : "";
  if (!site || !secret) return null;
  if (!SITE_ID.test(site)) throw new ShipError("SETTINGS", "The Store ID is not one DinkusKit.com gives. Paste the siteId line from the Set up Commerce box.");
  if (secret.length > 512 || !/^dk_store_[A-Za-z0-9_-]+$/.test(secret)) throw new ShipError("SETTINGS", "The store key is not one DinkusKit.com gives. Paste it again from the Set up Commerce box.");
  return { siteId: site, key: secret };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_ANSWER_BYTES) throw new ShipError("ANSWER", "Ship sent an answer too large to read.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ShipError("ANSWER", `Ship answered ${response.status} without a readable body.`, response.status);
  }
}

function jwtPart(encoded: string): Record<string, unknown> | null {
  try {
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** A pass is used only when it is plainly DinkusKit.com's pass for this store, this scope and Ship. */
export function admitPass(token: unknown, siteId: string): string {
  const parts = typeof token === "string" && token.length <= 16384 ? token.split(".") : [];
  const payload = parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part)) ? jwtPart(parts[1]!) : null;
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.iss !== ISSUER || !(payload.aud === AUDIENCE || Array.isArray(payload.aud) && payload.aud.includes(AUDIENCE)) ||
      payload.site_id !== siteId || typeof payload.scope !== "string" || !payload.scope.split(" ").includes(SCOPE) ||
      !Number.isSafeInteger(payload.exp) || (payload.exp as number) <= now) {
    throw new ShipError("PASS", "DinkusKit.com sent a pass Ship cannot use. Try again in a moment.");
  }
  return token as string;
}

const PASS_REFUSALS: Record<string, string> = {
  invalid_store_key: "DinkusKit.com does not know this store key. Paste the current one from the Set up Commerce box, or make a new key there.",
  site_mismatch: "This store key belongs to another store. Check the Store ID and store key against the Set up Commerce box.",
  service_not_enabled: "Ship is turned off for this store. Turn it on at DinkusKit.com, then try again.",
  service_cut_off: "DinkusKit.com has cut Ship off for this store. Contact DinkusKit.",
  store_suspended: "This store is suspended at DinkusKit.com.",
  rate_limited: "DinkusKit.com is busy with this store's passes. Try again in a minute.",
};

/** Trades the store key for a fresh ship:admin pass at DinkusKit.com's one fixed address. */
export async function tradeStoreKey(ctx: PluginContext, siteId: string, key: string): Promise<string> {
  if (!ctx.http) throw new ShipError("NETWORK", "This plugin was installed without network access, so it cannot reach DinkusKit.com.");
  let response: Response;
  try {
    response = await ctx.http.fetch(STORE_PASSES_URL, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { accept: "application/json", authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ site_id: siteId, scope: SCOPE, audience: AUDIENCE }),
    });
  } catch {
    throw new ShipError("NETWORK", "DinkusKit.com could not be reached. Try again in a moment.");
  }
  const body = await readJson(response);
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  if (!response.ok) {
    const reason = typeof error === "string" ? PASS_REFUSALS[error] : undefined;
    throw new ShipError("PASS", reason ?? `DinkusKit.com refused to sign a pass (${response.status}). Try again in a moment.`, response.status);
  }
  return admitPass((body as { access_token?: unknown }).access_token, siteId);
}

export interface Ship {
  siteId: string;
  orders(): Promise<{ orders: ShipOrder[]; settings: ShipSettings }>;
  order(orderId: string): Promise<{ order: ShipOrder; settings: ShipSettings }>;
  prices(orderId: string, request: LabelRequest): Promise<Prices>;
  buy(orderId: string, request: LabelRequest): Promise<Label>;
  cancel(labelId: string): Promise<{ labelId: string; refund: string | null }>;
  printLink(labelId: string): Promise<{ url: string; expiresAt: string }>;
}

/** Hosted Ship for this store, trading one pass per invocation and reusing it while it lasts. */
export function ship(ctx: PluginContext, siteId: string, key: string): Ship {
  let pass: Promise<string> | undefined;
  const credential = () => pass ??= tradeStoreKey(ctx, siteId, key);
  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const token = admitPass(await credential(), siteId);
    let response: Response;
    try {
      response = await ctx.http!.fetch(`${SHIP_ORIGIN}${path}`, {
        method, cache: "no-store", redirect: "error",
        headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ShipError("NETWORK", "Ship could not be reached. Try again in a moment, or open Ship's own page.");
    }
    const answer = await readJson(response);
    if (response.ok) return answer;
    const error = typeof answer === "object" && answer !== null ? (answer as { error?: { code?: unknown; message?: unknown } }).error : undefined;
    const code = typeof error?.code === "string" ? error.code : "SHIP", message = typeof error?.message === "string" ? error.message : `Ship answered ${response.status}.`;
    throw new ShipError(code, code === "INTERNAL" ? "Ship could not finish that. Try again." : message, response.status);
  }
  const segment = (id: string) => encodeURIComponent(id);
  return {
    siteId,
    orders: () => call("GET", "/v1/admin/orders") as Promise<{ orders: ShipOrder[]; settings: ShipSettings }>,
    order: id => call("GET", `/v1/admin/orders/${segment(id)}`) as Promise<{ order: ShipOrder; settings: ShipSettings }>,
    prices: async (id, request) => ((await call("POST", `/v1/admin/orders/${segment(id)}/prices`, request)) as { prices: Prices }).prices,
    buy: async (id, request) => ((await call("POST", `/v1/admin/orders/${segment(id)}/labels`, request)) as { label: Label }).label,
    cancel: id => call("POST", `/v1/admin/labels/${segment(id)}/cancel`) as Promise<{ labelId: string; refund: string | null }>,
    printLink: id => call("POST", `/v1/admin/labels/${segment(id)}/print-link`) as Promise<{ url: string; expiresAt: string }>,
  };
}

/** Ship's own pages for this store: the full path and the fallback. */
export const shipPages = (siteId: string) => ({
  orders: `${SHIP_ORIGIN}/stores/${encodeURIComponent(siteId)}/orders`,
  order: (orderId: string) => `${SHIP_ORIGIN}/stores/${encodeURIComponent(siteId)}/orders/${encodeURIComponent(orderId)}`,
  settings: `${SHIP_ORIGIN}/stores/${encodeURIComponent(siteId)}/settings`,
});
