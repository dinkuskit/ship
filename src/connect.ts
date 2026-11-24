import { pluginResponse, type PluginContext, type PluginResponse } from "emdash/plugin";

/**
 * Connect to DinkusKit (store-connect-per-plugin-key-080, store-connect-flow-081): an Administrator
 * presses Connect, the business owner approves at DinkusKit.com, and DinkusKit.com hands this plugin
 * its own store key, limited to ship:admin passes. Commerce connects first and makes the store;
 * Ship only joins it. The key and the Store ID are kept in the encrypted "connection" setting; the
 * owner never pastes either.
 */
export const CONNECT_URL = "https://dinkuskit.com/api/store-connections";
/** Finish setup (store-connect-approve-once-125): whether this store is already connected, and joining it without a second Approve. */
export const LOOKUP_URL = `${CONNECT_URL}/lookup`;
export const FINISH_URL = `${CONNECT_URL}/finish`;
/** Which business and DinkusKit plugins share this store (connect-shows-siblings-133), read with a store:connection pass. */
export const STORE_CONNECTION_URL = "https://dinkuskit.com/api/store-connection";
/** Uninstall cancels only this plugin's key (connect-uninstall-cancels-key-134). */
export const KEY_CANCEL_URL = "https://dinkuskit.com/api/store-keys/cancel";
const PASSES_URL = "https://dinkuskit.com/api/store-passes";
export const CLIENT_ID = "dinkus-ship-emdash";
export const SERVICE = "ship";
/** The Registry installations DinkusKit.com knows, by slug and by installed ID. */
const INSTALLED: Record<string, string> = { "dinkus-ship": "r_ehdlg5cxkb3ffqvr", "dinkus-ship-beta": "r_nhb4yqdnowdmkxyu" };
export const CONNECTION_SETTING = "connection";
/** Each Connect keeps its waiting record under its own flow, so a slow Check of an old Connect never touches a newer one. */
export const controlKey = (flowId: string) => `state:connect:${flowId}`;
export const STORE_KEY_RE = /^dk_store_[A-Za-z0-9_-]{43}$/;
const SITE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_CONNECT_MS = 600_000;

/** What the encrypted setting holds: this store's key once connected, and a Connect's verifier while one waits. */
interface Saved { siteId?: string; storeKey?: string; flow?: { id: string; verifier: string; finishing?: true } }
/** A waiting Connect, in the plugin's KV. Nothing here is secret: DinkusKit.com reads the receipt from the store-proof route. */
interface Control { flowId: string; expiresAt: number; nextPollAt: number; interval: number; verificationUri: string; receipt: Receipt }
export interface Receipt {
  version: 2; site_id: string; connection_id: string; challenge: string; client_id: typeof CLIENT_ID; service: typeof SERVICE;
  site_origin: string; callback_uri: string; code_challenge: string; expires_at: number;
}
export type ConnectView =
  | { state: "connected"; siteId: string; key: string }
  | { state: "pending"; verificationUri: string; checked?: true }
  | { state: "finish_unconfirmed"; checked?: true }
  | { state: "disconnected"; failure?: string }
  | { state: "finish_setup"; retry?: true };
/** What DinkusKit.com says this store is connected to; shown on the page, never used to buy a label. */
export interface ConnectedTo { business: string; plugins: ("commerce" | "payments" | "ship")[] }
const PLUGINS = ["commerce", "payments", "ship"];

const COMMERCE_FIRST = "Connect Commerce first. Press Connect in the Commerce plugin, then come back here and press Connect.";
const RESTART = "Connect did not finish. Press Connect to start again.";
const UNCONFIRMED = "Ship setup could not be confirmed. Start a new connection to try again.";
/**
 * Ship 0.2.1's pasted Store ID and store key. Pasted keys retire (store-connect-no-paste-082): an
 * upgraded store never uses or sends one, asks for Connect once, and forgets it when Connect finishes.
 */
const LEGACY_SETTINGS = ["siteId", "storeKey"];
const UPGRADED = "Ship now connects to DinkusKit.com itself, so the store key pasted into an older Ship is no longer used. An Administrator presses Connect once and the business owner approves at DinkusKit.com.";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
const sha256 = async (value: string) => base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const safe = (value: unknown, max = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

/** The store's https origin, or null when the site address is not one DinkusKit.com accepts. */
function siteOrigin(ctx: PluginContext): string | null {
  try {
    const url = new URL(ctx.site.url);
    return url.protocol === "https:" && !url.port && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}
const installedId = (ctx: PluginContext) => INSTALLED[ctx.plugin.id] ?? (Object.values(INSTALLED).includes(ctx.plugin.id) ? ctx.plugin.id : null);
const callbackUri = (origin: string, id: string) => `${origin}/_emdash/admin/plugins/${id}/shipping`;

async function saved(ctx: PluginContext): Promise<{ value: Saved; revision: string | null }> {
  const entry = await ctx.settings.getVersioned<unknown>(CONNECTION_SETTING);
  try {
    const value = typeof entry?.value === "string" ? JSON.parse(entry.value) as Saved : {};
    return { value: typeof value === "object" && value !== null ? value : {}, revision: entry?.revision ?? null };
  } catch {
    return { value: {}, revision: entry?.revision ?? null };
  }
}
const connectedIn = (value: Saved): ConnectView | null =>
  safe(value.siteId, 200) && SITE_ID_RE.test(value.siteId) && typeof value.storeKey === "string" && STORE_KEY_RE.test(value.storeKey)
    ? { state: "connected", siteId: value.siteId, key: value.storeKey } : null;
/**
 * Not connected: a store upgraded from 0.2.1 is told why it must Connect. Only the plain Store ID is
 * looked at; the old key, encrypted under a setting this version no longer declares, is never read.
 */
async function notConnected(ctx: PluginContext, retry = false): Promise<ConnectView> {
  // DinkusKit.com already knows this store for the owner's business: Finish setup, no second Approve.
  if (await joinable(ctx)) return { state: "finish_setup", ...(retry ? { retry: true as const } : {}) };
  if (retry) return { state: "disconnected", failure: UNCONFIRMED };
  const pasted = await ctx.settings.get<unknown>("siteId").then(value => typeof value === "string" && value.length > 0, () => false);
  return pasted ? { state: "disconnected", failure: UPGRADED } : { state: "disconnected" };
}
const write = (ctx: PluginContext, revision: string | null, value: Saved) => ctx.settings.compareAndSet(CONNECTION_SETTING, revision, JSON.stringify(value));
/** The setting without a Connect's verifier: a cancelled or failed Connect keeps the key it had. */
const withoutFlow = ({ flow: _flow, ...rest }: Saved): Saved => rest;

/**
 * This store's connection as the page needs it. A waiting Connect is checked here, so the owner's
 * return from DinkusKit.com's Approve lands on a connected page; `wait` presses Check now.
 */
export async function connectionState(ctx: PluginContext, press = false): Promise<ConnectView> {
  const { value, revision } = await saved(ctx);
  if (!value.flow) return connectedIn(value) ?? await notConnected(ctx);
  const flowId = value.flow.id;
  const control = await ctx.kv.get<Control>(controlKey(flowId));
  const restart = async (failure = RESTART, retry = false): Promise<ConnectView> => {
    if ((await write(ctx, revision, withoutFlow(value))).applied) {
      await ctx.kv.delete(controlKey(flowId));
      return connectedIn(value) ?? (retry ? await notConnected(ctx, true) : { state: "disconnected", failure });
    }
    return connectedIn((await saved(ctx)).value) ?? { state: "disconnected", failure };
  };
  if (!control || control.flowId !== flowId || control.expiresAt <= Date.now()) return restart(RESTART, value.flow.finishing === true);
  const waiting = (checked = false): ConnectView => {
    const detail = checked ? { checked: true as const } : {};
    return value.flow?.finishing
      ? { state: "finish_unconfirmed", ...detail }
      : { state: "pending", verificationUri: control.verificationUri, ...detail };
  };
  if (!press && Date.now() < control.nextPollAt) return waiting();
  let response: Response, body: Record<string, unknown>;
  try {
    response = await ctx.http!.fetch(`${CONNECT_URL}/token`, { method: "POST", cache: "no-store", redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, connection_id: control.receipt.connection_id, code_verifier: value.flow.verifier }) });
    body = await response.json() as Record<string, unknown>;
  } catch {
    return waiting(press && value.flow.finishing === true);
  }
  if (!response.ok) {
    if (body?.error === "authorization_pending") {
      await ctx.kv.set(controlKey(flowId), { ...control, nextPollAt: Date.now() + control.interval * 1000 } satisfies Control);
      // Cancelled or replaced while DinkusKit.com answered: leave nothing behind for it.
      if ((await saved(ctx)).value.flow?.id !== flowId) await ctx.kv.delete(controlKey(flowId));
      return waiting(press);
    }
    if (body?.error === "access_denied") return restart("The business owner did not approve Ship at DinkusKit.com. Press Connect to ask again.");
    if (value.flow.finishing && response.status >= 500) return waiting(press);
    return restart(RESTART, value.flow.finishing === true && body?.error === "already_redeemed");
  }
  if (body.site_id !== control.receipt.site_id || typeof body.store_key !== "string" || !STORE_KEY_RE.test(body.store_key)) return restart();
  const next: Saved = { siteId: control.receipt.site_id, storeKey: body.store_key };
  if (!(await write(ctx, revision, next)).applied) return restart();
  // A finished Connect vouches for nothing on the store-proof route, and a key pasted into 0.2.1 is no longer kept.
  await ctx.kv.delete(controlKey(flowId));
  await Promise.all(LEGACY_SETTINGS.map(name => ctx.settings.delete(name).catch(() => false)));
  return { state: "connected", siteId: next.siteId!, key: next.storeKey! };
}

/** Asks DinkusKit.com whether this store may use Finish setup. Any failure shows Connect, as before. */
async function joinable(ctx: PluginContext): Promise<boolean> {
  const origin = siteOrigin(ctx), id = installedId(ctx);
  if (!origin || !id || !ctx.http) return false;
  try {
    const response = await ctx.http.fetch(LOOKUP_URL, { method: "POST", cache: "no-store", redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ protocol_version: 2, client_id: CLIENT_ID, service: SERVICE, site_origin: origin, callback_uri: callbackUri(origin, id) }) });
    return response.ok && (await response.json() as { finish_setup?: unknown })?.finish_setup === true;
  } catch {
    return false;
  }
}

/** Connect, or Connect again: asks DinkusKit.com for an approval link for this store. The current key keeps working until the new one arrives. */
export async function startConnect(ctx: PluginContext): Promise<ConnectView> {
  const begun = await begin(ctx);
  return "state" in begun ? begun : { state: "pending", verificationUri: begun.verificationUri };
}

/**
 * Finish setup (store-connect-approve-once-125, store-connect-ship-on-at-setup-126): starts a Connect, then asks
 * DinkusKit.com to approve it for the business that already connected this store. DinkusKit.com reads the
 * receipt from the store-proof route as for Approve, hands this plugin its own key and turns Ship on. When
 * DinkusKit.com wants the owner's Approve after all, the page shows the usual Approve link.
 */
export async function finishSetup(ctx: PluginContext): Promise<ConnectView> {
  const begun = await begin(ctx, true);
  if ("state" in begun) return begun;
  const { flowId, verifier, receipt } = begun;
  let response: Response, body: Record<string, unknown>;
  try {
    response = await ctx.http!.fetch(FINISH_URL, { method: "POST", cache: "no-store", redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, connection_id: receipt.connection_id, code_verifier: verifier }) });
    body = await response.json() as Record<string, unknown>;
  } catch {
    // Keep the waiting attempt: a lost reply says nothing about whether the owner needs to approve.
    return { state: "finish_unconfirmed" };
  }
  if (response.status >= 500) return { state: "finish_unconfirmed" };
  const { value, revision } = await saved(ctx);
  if (value.flow?.id !== flowId) return connectedIn(value) ?? { state: "disconnected", failure: RESTART };
  if (!response.ok && body?.error === "owner_approval_required") {
    if ((await write(ctx, revision, { ...value, flow: { id: flowId, verifier } })).applied) {
      return { state: "pending", verificationUri: begun.verificationUri };
    }
    return connectedIn((await saved(ctx)).value) ?? { state: "disconnected", failure: RESTART };
  }
  const stop = async (failure: string): Promise<ConnectView> => {
    if ((await write(ctx, revision, withoutFlow(value))).applied) await ctx.kv.delete(controlKey(flowId));
    return connectedIn(value) ?? { state: "disconnected", failure };
  };
  if (!response.ok) return stop(body?.error === "connect_commerce_first" ? COMMERCE_FIRST : RESTART);
  if (body.site_id !== receipt.site_id || typeof body.store_key !== "string" || !STORE_KEY_RE.test(body.store_key)) return stop(RESTART);
  const next: Saved = { siteId: receipt.site_id, storeKey: body.store_key };
  if (!(await write(ctx, revision, next)).applied) return stop(RESTART);
  await ctx.kv.delete(controlKey(flowId));
  await Promise.all(LEGACY_SETTINGS.map(name => ctx.settings.delete(name).catch(() => false)));
  return { state: "connected", siteId: next.siteId!, key: next.storeKey! };
}

/** Starts a Connect at DinkusKit.com and saves it as waiting, or says why it could not. */
async function begin(ctx: PluginContext, finishing = false): Promise<ConnectView | { flowId: string; verifier: string; verificationUri: string; receipt: Receipt }> {
  const origin = siteOrigin(ctx), id = installedId(ctx);
  if (!origin || !id || !ctx.http) {
    return { state: "disconnected", failure: "Connect needs this store on its https web address, with Ship installed from the EmDash Registry." };
  }
  const { value, revision } = await saved(ctx);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32))), challenge = await sha256(verifier), callback = callbackUri(origin, id);
  let response: Response, body: Record<string, unknown>;
  try {
    response = await ctx.http.fetch(CONNECT_URL, { method: "POST", cache: "no-store", redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ protocol_version: 2, client_id: CLIENT_ID, service: SERVICE, site_origin: origin,
        callback_uri: callback, code_challenge: challenge, code_challenge_method: "S256" }) });
    body = await response.json() as Record<string, unknown>;
  } catch {
    return { state: "disconnected", failure: "DinkusKit.com could not be reached. Try again in a moment." };
  }
  if (!response.ok) return { state: "disconnected", failure: body?.error === "connect_commerce_first" ? COMMERCE_FIRST : RESTART };
  const { site_id: siteId, connection_id: connectionId, expires_at: expiresAt, interval } = body;
  if (body.protocol_version !== 2 || !safe(siteId, 200) || !SITE_ID_RE.test(siteId) || !safe(connectionId, 200) || !safe(body.challenge) ||
      !Number.isSafeInteger(expiresAt) || (expiresAt as number) <= Date.now() || (expiresAt as number) > Date.now() + MAX_CONNECT_MS ||
      !Number.isInteger(interval) || (interval as number) < 1 || (interval as number) > 60 ||
      body.verification_uri !== `https://dinkuskit.com/account/connect?connection_id=${encodeURIComponent(connectionId)}`) {
    return { state: "disconnected", failure: RESTART };
  }
  if (value.siteId && value.siteId !== siteId) return { state: "disconnected", failure: "DinkusKit.com named another store for this web address. Contact DinkusKit." };
  const flowId = base64url(crypto.getRandomValues(new Uint8Array(18)));
  const receipt: Receipt = { version: 2, site_id: siteId, connection_id: connectionId, challenge: body.challenge, client_id: CLIENT_ID, service: SERVICE,
    site_origin: origin, callback_uri: callback, code_challenge: challenge, expires_at: expiresAt as number };
  // The waiting record goes first, so the verifier is never saved without it; the store-proof route vouches for it only once the verifier is saved too.
  await ctx.kv.set(controlKey(flowId), {
    flowId, expiresAt: expiresAt as number, interval: interval as number, nextPollAt: Date.now() + (interval as number) * 1000,
    verificationUri: body.verification_uri, receipt,
  } satisfies Control);
  const flow = { id: flowId, verifier, ...(finishing ? { finishing: true as const } : {}) };
  if (!(await write(ctx, revision, { ...value, flow })).applied) {
    await ctx.kv.delete(controlKey(flowId));
    return { state: "disconnected", failure: RESTART };
  }
  if (value.flow) await ctx.kv.delete(controlKey(value.flow.id));
  return { flowId, verifier, verificationUri: body.verification_uri, receipt };
}

/**
 * The business DinkusKit.com has this store under and the DinkusKit plugins that share it
 * (connect-shows-siblings-133), read with a store:connection pass traded for this plugin's own key.
 * Null when either call fails: the page then leaves the line off.
 */
export async function connectedTo(ctx: PluginContext, siteId: string, key: string): Promise<ConnectedTo | null> {
  if (!ctx.http) return null;
  try {
    const traded = await ctx.http.fetch(PASSES_URL, { method: "POST", cache: "no-store", redirect: "error",
      headers: { accept: "application/json", authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ site_id: siteId, scope: "store:connection", audience: "dinkuskit" }) });
    const pass = traded.ok ? (await traded.json() as { access_token?: unknown })?.access_token : undefined;
    if (!safe(pass, 16384)) return null;
    const read = await ctx.http.fetch(STORE_CONNECTION_URL, { method: "GET", cache: "no-store", redirect: "error",
      headers: { accept: "application/json", authorization: `Bearer ${pass}` } });
    if (!read.ok) return null;
    const body = await read.json() as { business?: unknown; plugins?: unknown };
    if (!safe(body?.business, 200) || !Array.isArray(body.plugins) || body.plugins.some(name => !PLUGINS.includes(name))) return null;
    return { business: body.business, plugins: body.plugins as ConnectedTo["plugins"] };
  } catch {
    return null;
  }
}

/**
 * The plugin:uninstall hook (connect-uninstall-cancels-key-134): cancels only this plugin's key at
 * DinkusKit.com. Commerce's and Payments' keys and the store stay; a failure leaves Disconnect under
 * Your stores, which still works.
 */
export async function cancelKey(ctx: PluginContext): Promise<boolean> {
  const connected = connectedIn((await saved(ctx)).value);
  if (connected?.state !== "connected" || !ctx.http) return false;
  try {
    const response = await ctx.http.fetch(KEY_CANCEL_URL, { method: "POST", cache: "no-store", redirect: "error",
      headers: { accept: "application/json", authorization: `Bearer ${connected.key}`, "content-type": "application/json" },
      body: JSON.stringify({ site_id: connected.siteId }) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Cancel a waiting Connect; a key this store already had keeps working. */
export async function cancelConnect(ctx: PluginContext): Promise<ConnectView> {
  const { value, revision } = await saved(ctx);
  if (value.flow && (await write(ctx, revision, withoutFlow(value))).applied) {
    await ctx.kv.delete(controlKey(value.flow.id));
    if (value.flow.finishing) return connectedIn(value) ?? await notConnected(ctx, true);
  }
  return connectedIn(value) ?? { state: "disconnected" };
}

const proofResponse = (status: number, body: unknown) => pluginResponse({ status,
  headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Type": "application/json" },
  body: { kind: "text", value: JSON.stringify(body) } });

/**
 * The public store-proof route: DinkusKit.com reads it on this store's own web address before the owner
 * may approve, which proves the Connect started here. It answers only for the Connect waiting now.
 */
export async function storeProof(input: unknown, ctx: PluginContext): Promise<PluginResponse> {
  const query = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  if (Object.keys(query).length !== 1 || !safe(query.connection_id, 200)) return proofResponse(400, { error: "invalid_request" });
  try {
    // Only the Connect still waiting in the encrypted setting is vouched for: a cancelled or replaced one is not.
    const flow = (await saved(ctx)).value.flow, control = flow && await ctx.kv.get<Control>(controlKey(flow.id));
    return control && control.flowId === flow.id && control.receipt.connection_id === query.connection_id && control.expiresAt > Date.now() &&
      control.receipt.site_origin === siteOrigin(ctx) ? proofResponse(200, control.receipt) : proofResponse(404, { error: "not_found" });
  } catch {
    return proofResponse(503, { error: "connection_unavailable" });
  }
}
