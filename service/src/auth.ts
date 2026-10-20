import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { assertSite, assertTuple } from "./isolation.js";
import { ServiceError } from "./errors.js";

/** ship:orders is Commerce's; ship:admin is the Ship Registry plugin's (both store passes from DinkusKit.com). */
export type ShipScope = "ship:orders" | "ship:admin";

/** The longest store id Ship keeps; DinkusKit.com's ids are far shorter. */
const SITE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

/**
 * Verifies a store pass from DinkusKit.com the way Payments and Coupons do:
 * issuer, audience, ES256 from the issuer's JWKS, at most an hour old and the
 * requested scope. The store is the pass's site_id and nothing else, so a
 * request can never name another store. Returns that store id and, when the
 * pass carries one, the store's own https origin (DinkusKit.com signs
 * `site_origin` into every store pass), which the forward to the store admin
 * trusts over anything the request says.
 */
export interface StorePass { siteId: string; siteOrigin: string | null }

/** A bare https origin from a pass claim, or null for anything else. */
function siteOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

export function createAuthenticator(config: { issuer: string; audience: string; jwksUrl: string; env?: Env }, key?: JWTVerifyGetKey) {
  if (new URL(config.issuer).protocol !== "https:" || new URL(config.jwksUrl).protocol !== "https:" || !config.audience) {
    throw new Error("invalid_identity_configuration");
  }
  const resolveKey = key ?? createRemoteJWKSet(new URL(config.jwksUrl));
  return async (request: Request, scope: ShipScope): Promise<StorePass> => {
    const bearer = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!bearer) throw new ServiceError(401, "UNAUTHENTICATED", "a bearer token is required");
    let payload;
    try {
      ({ payload } = await jwtVerify(bearer, resolveKey, {
        issuer: config.issuer, audience: config.audience, algorithms: ["ES256"],
        requiredClaims: ["exp", "iat", "sub"], maxTokenAge: "1h",
      }));
    } catch {
      throw new ServiceError(401, "UNAUTHENTICATED", "the bearer token is not valid");
    }
    if (typeof payload.site_id !== "string" || !SITE_ID.test(payload.site_id) ||
        typeof payload.scope !== "string" || !payload.scope.split(" ").includes(scope)) {
      throw new ServiceError(403, "FORBIDDEN", "the token does not grant this scope for a store");
    }
    assertTuple(config.env ?? {} as Env, payload, true);
    if (config.env) assertSite(config.env, payload.site_id);
    return { siteId: payload.site_id, siteOrigin: siteOrigin(payload.site_origin) };
  };
}
