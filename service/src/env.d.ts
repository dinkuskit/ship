declare namespace Cloudflare {
  interface Env {
    /** Deployment-owned isolated sandbox admission. Empty allowed ID admits no orders. */
    SHIP_RECIPIENT?: string;
    SHIP_GENERATION?: string;
    SHIP_SITE_ID?: string;
    SHIP_ALLOWED_ORDER_ID?: string;
    SHIP_EXCLUDED_ORDER_ID?: string;
    ACCOUNT_ISSUER: string;
    ACCOUNT_AUDIENCE: string;
    ACCOUNT_JWKS_URL: string;
    /** DinkusKit.com's sign-in page for Ship (signin-contract step 1). */
    ACCOUNT_SIGNIN_URL: string;
    /** DinkusKit.com's code-for-pass route (signin-contract step 4). */
    ACCOUNT_TOKEN_URL: string;
    /** Secret: signs Ship's own session cookies. At least 32 characters. */
    SHIP_SESSION_SECRET: string;
    /** "sandbox" turns on Pitney Bowes's sandbox; any other value leaves postage off. Live postage is not built yet. */
    PB_ENVIRONMENT: string;
    /** Secrets: DinkusKit's PB developer API key and secret. */
    PB_API_KEY?: string;
    PB_API_SECRET?: string;
    /** Secret: PB's sandbox test merchant (shipper) id, which pays for TEST orders' sandbox labels. Real orders use each store's own connected account. */
    PB_SHIPPER_ID?: string;
    /** DinkusKit's PB developer id: puts owners' new postage accounts under DinkusKit's developer account and connects them. */
    PB_DEVELOPER_ID?: string;
    /** The shipped email's sender address (orders@dinkuskit.com). Emails wait until it is set. */
    SHIP_EMAIL_FROM?: string;
    /** Cloudflare Email Service binding that sends the shipped email. */
    EMAIL?: SendEmail;
    /** Secrets: the username and password Pitney Bowes sends with each tracking update (ship-tracking-001). Updates answer 503 until both are set. */
    PB_TRACKING_USER?: string;
    PB_TRACKING_PASSWORD?: string;
    SHIP_STORES: DurableObjectNamespace<import("./store").StoreShipping>;
    /** One index from tracking number to store and label, for Pitney Bowes's updates and the daily check. */
    SHIP_TRACKING: DurableObjectNamespace<import("./tracking").TrackingIndex>;
  }
}
interface Env extends Cloudflare.Env {}
