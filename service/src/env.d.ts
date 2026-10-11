declare namespace Cloudflare {
  interface Env {
    ACCOUNT_ISSUER: string;
    ACCOUNT_AUDIENCE: string;
    ACCOUNT_JWKS_URL: string;
    /** DinkusKit.com's sign-in page for Ship (signin-contract step 1). */
    ACCOUNT_SIGNIN_URL: string;
    /** DinkusKit.com's code-for-pass route (signin-contract step 4). */
    ACCOUNT_TOKEN_URL: string;
    /** Secret: signs Ship's own session cookies. At least 32 characters. */
    SHIP_SESSION_SECRET: string;
    SHIP_STORES: DurableObjectNamespace<import("./store").StoreShipping>;
  }
}
interface Env extends Cloudflare.Env {}
