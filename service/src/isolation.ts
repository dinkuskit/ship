import { ServiceError } from "./errors.js";

export const SANDBOX_RECIPIENT = "ship-sandbox";
export const SANDBOX_ORIGIN = "https://ship.sm0ky.dev";
export const SANDBOX_AUDIENCE = "dinkus-ship-sandbox";
export interface ShipTuple { recipient: typeof SANDBOX_RECIPIENT; generation: string; mode: "test" }
export interface Isolation extends ShipTuple { site: string; allowedOrderId: string; excludedOrderId: string }
const bounded = (value: unknown, max = 200): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
const denied = () => new ServiceError(403, "FORBIDDEN", "this Ship recipient does not admit the request");

/** Any partial isolated configuration fails closed; empty admission is intentional. */
export function isolation(env: Env): Isolation | null {
  const values = [env.SHIP_RECIPIENT, env.SHIP_GENERATION, env.SHIP_SITE_ID, env.SHIP_ALLOWED_ORDER_ID, env.SHIP_EXCLUDED_ORDER_ID];
  if (values.every(value => value === undefined || value === "")) {
    if (env.ACCOUNT_AUDIENCE === SANDBOX_AUDIENCE) throw denied();
    return null;
  }
  if (env.SHIP_RECIPIENT !== SANDBOX_RECIPIENT || env.ACCOUNT_AUDIENCE !== SANDBOX_AUDIENCE || env.PB_ENVIRONMENT !== "sandbox" ||
      !bounded(env.SHIP_SITE_ID) || !/^[A-Za-z0-9_-]{1,128}$/.test(env.SHIP_GENERATION ?? "") ||
      !bounded(env.SHIP_EXCLUDED_ORDER_ID) || typeof env.SHIP_ALLOWED_ORDER_ID !== "string" ||
      (env.SHIP_ALLOWED_ORDER_ID !== "" && (!bounded(env.SHIP_ALLOWED_ORDER_ID) || env.SHIP_ALLOWED_ORDER_ID === env.SHIP_EXCLUDED_ORDER_ID))) throw denied();
  return { recipient: SANDBOX_RECIPIENT, mode: "test", generation: env.SHIP_GENERATION!, site: env.SHIP_SITE_ID,
    allowedOrderId: env.SHIP_ALLOWED_ORDER_ID, excludedOrderId: env.SHIP_EXCLUDED_ORDER_ID };
}
export function tuple(env: Env): ShipTuple | undefined {
  const config = isolation(env);
  return config ? { recipient: config.recipient, generation: config.generation, mode: config.mode } : undefined;
}
export function assertTuple(env: Env, value: Record<string, unknown>, claims = false): void {
  const config = isolation(env);
  const keys = claims ? ["ship_recipient", "ship_generation", "ship_mode"] : ["recipient", "generation", "mode"];
  const [recipient, generation, mode] = keys.map(key => value[key]);
  if (!config) { if (keys.some(key => Object.hasOwn(value, key))) throw denied(); return; }
  if (recipient !== config.recipient || generation !== config.generation || mode !== "test") throw denied();
}
export function assertSite(env: Env, site: string): void { const config = isolation(env); if (config && config.site !== site) throw denied(); }
export function assertOrder(env: Env, orderId: string, test: boolean): void {
  const config = isolation(env);
  if (config && (!config.allowedOrderId || orderId !== config.allowedOrderId || orderId === config.excludedOrderId || test !== true)) throw denied();
}
export function assertRequestOrigin(env: Env, request: Request): void {
  if (isolation(env) && new URL(request.url).origin !== SANDBOX_ORIGIN) throw denied();
}

export function requestTuple(request: Request): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const key of ["recipient", "generation", "mode"]) {
    const field = request.headers.get(`X-Ship-${key}`);
    if (field !== null) value[key] = field;
  }
  return value;
}
