declare namespace Cloudflare {
  interface Env {
    ACCOUNT_ISSUER: string;
    ACCOUNT_AUDIENCE: string;
    ACCOUNT_JWKS_URL: string;
    SHIP_STORES: DurableObjectNamespace<import("./store").StoreShipping>;
  }
}
interface Env extends Cloudflare.Env {}
