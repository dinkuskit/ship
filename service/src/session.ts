import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ServiceError } from "./errors.js";
import { NOT_ONE_LINE } from "./order.js";

/**
 * Ship stays signed in for as long as the person stays signed in to DinkusKit.com
 * (ship-owner-signin-001, Ronald 2026-10-11): the cookie only names a session kept in
 * the store's Durable Object, and Ship asks DinkusKit.com again at least every
 * REFRESH_SECONDS. The cookie is renewed on each check, so it lapses only after
 * COOKIE_SECONDS without a visit.
 */
export const REFRESH_SECONDS = 5 * 60;
/** How long a session may go unchecked while DinkusKit.com is busy or down. */
export const GRACE_SECONDS = 20 * 60;
const COOKIE_SECONDS = 30 * 24 * 60 * 60;
/** How long a started sign-in may take to come back. */
const SIGNIN_SECONDS = 10 * 60;
const SESSION_COOKIE = "__Host-ship-session";
const SIGNIN_COOKIE = "__Host-ship-signin";

/** Who is signed in to Ship's pages, and for which one store. */
export interface OwnerSession { site: string; sessionId: string; uid: string; email: string }
interface SessionCookie { site: string; sessionId: string; exp: number }
interface PendingSignIn { site: string; state: string; verifier: string; next: string; exp: number }

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const text = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(text, char => char.charCodeAt(0));
}

function random(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function signInConfigured(env: Env): boolean {
  return Boolean(env.ACCOUNT_ISSUER && env.ACCOUNT_AUDIENCE && env.ACCOUNT_JWKS_URL &&
    env.ACCOUNT_SIGNIN_URL && env.ACCOUNT_TOKEN_URL && env.SHIP_SESSION_SECRET && env.SHIP_SESSION_SECRET.length >= 32);
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(env.SHIP_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function seal(env: Env, value: object): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(value)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(payload)));
  return `${payload}.${base64url(signature)}`;
}

async function open<T extends { exp: number }>(env: Env, sealed: string | undefined): Promise<T | null> {
  const [payload, signature, extra] = sealed?.split(".") ?? [];
  if (!payload || !signature || extra !== undefined) return null;
  try {
    if (!await crypto.subtle.verify("HMAC", await hmacKey(env), fromBase64url(signature), encoder.encode(payload))) return null;
    const value = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as T;
    return typeof value.exp === "number" && value.exp > Date.now() / 1000 ? value : null;
  } catch {
    return null;
  }
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

const storeOf = (env: Env, site: string) => env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site));

async function sessionCookie(env: Env, site: string, sessionId: string): Promise<string> {
  const value: SessionCookie = { site, sessionId, exp: Math.floor(Date.now() / 1000) + COOKIE_SECONDS };
  return setCookie(SESSION_COOKIE, await seal(env, value), COOKIE_SECONDS);
}

type TokenAnswer = { kind: "pass"; pass: OwnerPass; refreshToken: string } | { kind: "refused" } | { kind: "unavailable" };

/** DinkusKit.com answered, and its pass is not good for this store and person. */
class PassRefused extends Error {}

/**
 * Pass problems that mean "no" rather than "DinkusKit.com is having trouble". Anything
 * else (a key set that would not load, a timeout, a garbled answer) is treated as an
 * outage: the session keeps its grace window, which never extends a session.
 */
const REFUSED_PASS_ERRORS = [errors.JWTExpired, errors.JWTClaimValidationFailed, errors.JWTInvalid, errors.JWSInvalid, errors.JWSSignatureVerificationFailed];

/**
 * Asks DinkusKit.com's token route (signin-contract steps 4 and "Staying signed in"); never throws.
 * Only a 4xx answer or a pass that fails its checks is "refused", which ends the session.
 */
async function askToken(env: Env, body: object, site: string, fetcher: typeof fetch): Promise<TokenAnswer> {
  try {
    // Workers refuse redirect: "error", so a redirect comes back as a 3xx answer and is refused below.
    const answer = await fetcher(env.ACCOUNT_TOKEN_URL, {
      method: "POST", redirect: "manual", cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (answer.status === 400 || answer.status === 401 || answer.status === 403) return { kind: "refused" };
    if (!answer.ok) return { kind: "unavailable" };
    const token = await answer.json() as { access_token?: unknown; refresh_token?: unknown };
    if (typeof token.access_token !== "string" || typeof token.refresh_token !== "string" ||
        token.refresh_token.length < 32 || token.refresh_token.length > 512) return { kind: "unavailable" };
    return { kind: "pass", pass: await verifyOwnerPass(env, token.access_token, site), refreshToken: token.refresh_token };
  } catch (error) {
    return error instanceof PassRefused ? { kind: "refused" } : { kind: "unavailable" };
  }
}

/**
 * The signed-in person for this store, or null when they must sign in (again).
 * `setCookie` is set when the session was checked with DinkusKit.com and its cookie renewed.
 */
export async function readSession(request: Request, env: Env, site: string, fetcher: typeof fetch = fetch):
    Promise<{ session: OwnerSession; setCookie?: string } | null> {
  const cookieValue = await open<SessionCookie>(env, cookie(request, SESSION_COOKIE));
  if (cookieValue?.site !== site || typeof cookieValue.sessionId !== "string") return null;
  const store = storeOf(env, site);
  const found = await store.readSession(cookieValue.sessionId);
  if (!found) return null;
  const session: OwnerSession = { site, sessionId: cookieValue.sessionId, uid: found.uid, email: found.email };
  if (!found.refreshToken) return { session };
  const answer = await askToken(env, { grant_type: "refresh_token", refresh_token: found.refreshToken }, site, fetcher);
  if (answer.kind === "pass" && answer.pass.uid === found.uid) {
    await store.refreshedSession(session.sessionId, answer.refreshToken, answer.pass.email);
    return { session: { ...session, email: answer.pass.email }, setCookie: await sessionCookie(env, site, session.sessionId) };
  }
  if (answer.kind === "unavailable") {
    await store.refreshFailed(session.sessionId);
    return found.withinGrace ? { session } : null;
  }
  // Signed out of DinkusKit.com, removed, suspended, cut off, or the token was reused.
  await store.endSession(session.sessionId);
  return null;
}

/** Sends the browser to DinkusKit.com to prove the person may act for this store. */
export async function startSignIn(env: Env, site: string, next: string): Promise<Response> {
  const pending: PendingSignIn = { site, state: random(), verifier: random(), next, exp: Math.floor(Date.now() / 1000) + SIGNIN_SECONDS };
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(pending.verifier))));
  const target = new URL(env.ACCOUNT_SIGNIN_URL);
  target.search = new URLSearchParams({ site_id: site, state: pending.state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return new Response(null, {
    status: 303,
    headers: { location: target.href, "set-cookie": setCookie(SIGNIN_COOKIE, await seal(env, pending), SIGNIN_SECONDS), "cache-control": "no-store" },
  });
}

let keys: { url: string; get: JWTVerifyGetKey } | undefined;

/** Test seam: the key set the owner pass is checked against. */
export function ownerPassKeys(env: Env): JWTVerifyGetKey {
  if (keys?.url !== env.ACCOUNT_JWKS_URL) keys = { url: env.ACCOUNT_JWKS_URL, get: createRemoteJWKSet(new URL(env.ACCOUNT_JWKS_URL)) };
  return keys.get;
}

/** What DinkusKit.com vouches for in a ship:labels pass. */
export interface OwnerPass { site: string; uid: string; email: string }

async function verifyOwnerPass(env: Env, token: string, site: string): Promise<OwnerPass> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, ownerPassKeys(env), {
      issuer: env.ACCOUNT_ISSUER, audience: env.ACCOUNT_AUDIENCE, algorithms: ["ES256"], requiredClaims: ["exp", "iat", "sub"], maxTokenAge: "10m",
    }));
  } catch (error) {
    if (REFUSED_PASS_ERRORS.some(kind => error instanceof kind)) throw new PassRefused("owner pass refused", { cause: error });
    throw error;
  }
  const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && !NOT_ONE_LINE.test(value);
  if (payload.site_id !== site || typeof payload.scope !== "string" || !payload.scope.split(" ").includes("ship:labels") ||
      !text(payload.uid, 200) || !text(payload.email, 254)) {
    throw new PassRefused("owner pass does not match");
  }
  return { site, uid: payload.uid as string, email: payload.email as string };
}

const CALLBACK_ERRORS: Record<string, string> = {
  access_denied: "Your DinkusKit.com account is not a member of the business that owns this store, or it is suspended.",
  ship_not_enabled: "Ship is turned off for this store. Turn it on under Stores on DinkusKit.com.",
  store_unavailable: "This store is not active on DinkusKit.com.",
};

export type CallbackResult =
  | { ok: true; pass: OwnerPass; next: string; headers: Headers }
  | { ok: false; status: number; message: string; site?: string };

/** Finishes a sign-in: checks the returning state, trades the one-time code and checks the pass. */
export async function finishSignIn(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<CallbackResult> {
  const url = new URL(request.url);
  const pending = await open<PendingSignIn>(env, cookie(request, SIGNIN_COOKIE));
  if (!pending || url.searchParams.get("state") !== pending.state) {
    return { ok: false, status: 400, message: "This sign-in expired or was started in another browser. Open the store's label page again." };
  }
  const error = url.searchParams.get("error");
  if (error) return { ok: false, status: 403, message: CALLBACK_ERRORS[error] ?? "DinkusKit.com could not sign you in.", site: pending.site };
  const code = url.searchParams.get("code");
  if (!code || code.length > 512) return { ok: false, status: 400, message: "DinkusKit.com sent no sign-in code.", site: pending.site };
  const answer = await askToken(env, { code, code_verifier: pending.verifier }, pending.site, fetcher);
  if (answer.kind !== "pass") {
    return { ok: false, status: 502, message: "DinkusKit.com could not confirm the sign-in. Try again.", site: pending.site };
  }
  const sessionId = await storeOf(env, pending.site).startSession(answer.pass.uid, answer.pass.email, answer.refreshToken);
  const headers = new Headers({ "cache-control": "no-store" });
  headers.append("set-cookie", await sessionCookie(env, pending.site, sessionId));
  headers.append("set-cookie", setCookie(SIGNIN_COOKIE, "", 0));
  const next = pending.next.startsWith(`/stores/${encodeURIComponent(pending.site)}/`) ? pending.next : `/stores/${encodeURIComponent(pending.site)}/orders`;
  return { ok: true, pass: answer.pass, next, headers };
}

/** Ends Ship's session only; DinkusKit.com keeps its own sign-in. */
export async function signOut(request: Request, env: Env): Promise<Headers> {
  const cookieValue = await open<SessionCookie>(env, cookie(request, SESSION_COOKIE));
  if (cookieValue && typeof cookieValue.site === "string" && typeof cookieValue.sessionId === "string") {
    await storeOf(env, cookieValue.site).endSession(cookieValue.sessionId);
  }
  return signOutHeaders();
}

export function signOutHeaders(): Headers {
  return new Headers({ "set-cookie": setCookie(SESSION_COOKIE, "", 0), "cache-control": "no-store" });
}

/** Pages post forms back to Ship only; a post from anywhere else is refused. */
export function requireSameOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new ServiceError(403, "FORBIDDEN", "forms must be sent from Ship's own pages");
  }
}
