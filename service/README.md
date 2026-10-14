# DinkusKit Ship service

The hosted Ship service for ship.dinkuskit.com. It runs as a Cloudflare Worker with one SQLite Durable Object per store, like the Payments and Coupons services. GrillTrack decisions: `ship-hosted-service-001`, `ship-order-intake-001` `ship-test-sandbox-labels-001` and `ship-owner-pb-account-001` (approved by Ronald; their ledger records land in a follow-up PR).

Status: order intake for Commerce, the owner's label page, Pitney Bowes sandbox labels (prices, buy, cancel for a refund, for real orders and TEST orders alike), owners connecting their own PB postage accounts, and the shipped email are built. Not built yet:

- live Pitney Bowes postage: Ship talks only to PB's sandbox, and its sign-up link opens PB's sandbox Merchant Portal. Going live switches both to production.

ship.dinkuskit.com runs this service on the Pitney Bowes sandbox. TEST orders get sandbox labels there once a version with them is deployed.

## What Commerce calls

Every call carries `Authorization: Bearer <pass>`. The pass is a store pass from DinkusKit.com:

- ES256, checked against `ACCOUNT_JWKS_URL`;
- issuer `ACCOUNT_ISSUER`, audience `ACCOUNT_AUDIENCE` (`dinkus-ship`);
- scope `ship:orders`;
- at most an hour old.

The store is the pass's `site_id`, never anything in the request.

| Call | Answer |
| --- | --- |
| `POST /v1/orders` with one `dinkuskit.commerce.ship-order/v1` record | `200 { orderId, version }` once Ship has this version or a newer one. `422` when Ship can never label this version: a country other than US, or a record that doesn't match the schema. |
| `GET /v1/labels` | `200` with labels Commerce has not acknowledged, oldest first, at most 100: `[{ eventId, orderId, version, carrier, tracking }]` |
| `POST /v1/labels/ack` with `{ eventId }` | `200`. A repeat, or an id Ship never issued, is still a success. |
| `GET /` | The service name as plain text |

Other failures:

- `401` for a missing or invalid pass;
- `403` for a pass without `ship:orders` or a usable `site_id`;
- `413` for a body over 256 KiB;
- `503` until the three `ACCOUNT_*` settings are set.

### What Ship keeps from an order

- `orderId`, `number`, `version`, `status` (`processing` or `completed`), `test` and `completed`.
- `shipTo`: name, line1, optional line2, city, optional region, postalCode, and country `US`.
- `email`.
- `storeName`, optional: the store's EmDash Site title (`ctx.site.name`), used as the shipped email's sender name. A missing or unusable one is dropped and never refuses the order.
- `lines`: catalogItemId, name, quantity, optional `weightOz`, and optional `unitPrice` (`{ currency: "USD", minor }`, the whole cents paid per unit before any order-level discount). Commerce starts sending `unitPrice` in the PR after commerce#98.

Ship drops every other field. Billing address, payment details, totals, tax and phone are never kept.

The latest version of each order wins. An older version arriving late is answered `200` and changes nothing.

Ship keeps an address that a label can't use yet, such as one with no state, and the label page will ask the owner to fix it in Commerce. Fixing it sends Ship a new version.

## Run it

Node 22.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test        # Workers runtime tests (vitest with @cloudflare/vitest-plugin)
npm run build   # wrangler deploy --dry-run
```

## The owner's label page

Commerce's "Create shipping label" opens `https://ship.dinkuskit.com/stores/{site_id}/orders/{orderId}`.

- **Sign-in:** Sign in with DinkusKit.com. DinkusKit.com's side is merged in dinkuskit/dinkuskit#31 (`src/account/ship-sign-in.ts`); the shared contract is the project's `ship-hosted/signin-contract.md`. Owners and employees with label permission get in.
  - Ship sends the browser to `ACCOUNT_SIGNIN_URL?site_id&state&code_challenge&code_challenge_method=S256`; DinkusKit.com returns to the fixed `https://ship.dinkuskit.com/auth/callback` with `code` and `state`, or `error` (`access_denied`, `store_unavailable`, `ship_not_enabled`, `invalid_request`).
  - Ship posts `{ code, code_verifier }`, later `{ grant_type: "refresh_token", refresh_token }`, to `ACCOUNT_TOKEN_URL` and gets `{ access_token, token_type, expires_in: 300, refresh_token }`. The access token is an ES256 pass: audience `dinkus-ship`, scope `ship:labels`, `site_id`, `sub`, `uid`, `email`. Every refusal is `400 invalid_grant`; `503` means DinkusKit.com cannot sign right now.
  - Ship stays signed in for as long as the person stays signed in to DinkusKit.com: the browser cookie names a session kept in the store's Durable Object with the rotating refresh token, and Ship checks again at least every 5 minutes. A `4xx`, or a pass that fails its signature or claim checks, signs Ship out. Anything else (a `5xx`, a key set that won't load, a timeout) is treated as DinkusKit.com being down: Ship keeps the session for at most 20 minutes after the last good check and never extends it.
- **Pages:** orders waiting to ship; one order with box, weight (items plus box, editable) and service (USPS Ground Advantage by default, Priority Mail, Priority Mail Express); Buy label, Print (PDF), Cancel label.
- **Real orders** get a USPS label from Pitney Bowes, paid from the store's own PB postage account (decision 2a: DinkusKit holds one PB developer account; each store owner has an Individual Postage Account under it). Sandbox only for now.
  - **Connecting the owner's account** (Settings, Postage): the box says up front that real labels need the owner's own PB postage account, charged to their own card by PB. "Create your Pitney Bowes account" opens PB's sign-up under DinkusKit's developer id (`/create/accountInfo?developerID=`), filled in from the owner's DinkusKit.com email and the ship-from address. PB has no link back, so the owner returns and enters their PB username and password once; Ship sends them to PB (`POST /shippingservices/v1/developers/{developerId}/merchants/credentials`) and keeps only the account's Shipper ID, company, email and the last four characters of the postage account number, never the password. An account that is not active, or has no working payment method, is not connected. "Disconnect" removes it; labels already bought stay and can still be cancelled.
  - Until an account is connected, a real order's page asks the owner to connect one, and prices and labels are refused without calling PB. TEST orders never need an owner account: their sandbox labels are paid by PB's sandbox test merchant (`PB_SHIPPER_ID`).
  - "See prices" asks PB what each service costs for the chosen box and weight (`POST /shippingservices/v1/rates`). PB service ids: Ground Advantage `UGA`, Priority Mail `PM` (with free Delivery Confirmation so it is tracked), Priority Mail Express `EM`; parcel type `PKG`; letter-size PDF.
  - "Buy label" sends `POST /shippingservices/v1/shipments` with a new `X-PB-TransactionId` and the store's `SHIPPER_ID`. Ship keeps a copy of the PDF, because PB's link lasts about a day, and queues the tracking number for Commerce.
  - PB answering with a refusal (for example, not enough postage) buys nothing; the owner sees PB's reason. If PB's answer is lost, Ship does not know whether it bought a label. The next press of "Buy label" looks the purchase up by its transaction id first (`GET /shippingservices/v1/shipments?originalTransactionId=`). If PB has no record, Ship asks the owner before buying a new one.
  - "Cancel label" voids it with PB (`DELETE /shippingservices/v1/shipments/{id}?cancelInitiator=SHIPPER`). USPS refunds the postage account within about 14 days. Cancelling never changes the Commerce order.
- **TEST orders** stay TEST everywhere and never get live postage.
  - While Ship runs on the Pitney Bowes sandbox (`PB_ENVIRONMENT=sandbox` with every PB setting below), a TEST order gets a free PB sandbox label: real sandbox prices, a PB shipment, PB's own PDF and tracking number, and a void with PB when cancelled. Nothing is charged. The page tags it "TEST SANDBOX".
  - The owner can press "Make practice label instead", and with PB off or set to anything but the sandbox every TEST order gets one: a PDF marked "TEST - NOT POSTAGE" with a TEST tracking number, made without calling Pitney Bowes.
  - Either way the label goes to Commerce through `GET /v1/labels`, so the TEST order becomes Completed with that tracking number.
- **Settings:** ship-from address, the owner's box sizes, and the shipped email's reply-to address (filled with the first signer-in's email). The sender name is the store's EmDash Site title, which Commerce sends as `storeName`.
- **Shipped email:** each time Commerce sends an order as Completed (by a Ship label or by the owner's Complete order), Ship emails the shopper once from `SHIP_EMAIL_FROM` (orders@dinkuskit.com). The sender name is the store's Site title and replies go to the reply-to address. The email holds the order number, carrier and tracking number, with a USPS tracking link for USPS. It never lists items and says "shipped", not "delivered".
  - Once per completion: the key is the order id plus `completed.at`. A repeat or newer version of the same completion sends nothing more. An order moved back to Processing and completed again sends a new email, and one moved back before the email went out gets none.
  - TEST orders email the owner's reply-to address, never the shopper. Orders completed before the store first sent Ship anything (allowing 15 minutes for clock differences) get no email.
  - Sending runs on the store's Durable Object alarm. When the email service fails, Ship tries again after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 12 hours, then gives up. A failed email never changes the order. The order page shows whether the email went out.
- Forms are accepted only from Ship's own pages (`Origin` check); pages send a strict Content-Security-Policy.

## Deploy settings (for Ronald's deploy agents, on his go)

- **Vars:**
  - `ACCOUNT_ISSUER=https://dinkuskit.com/account`
  - `ACCOUNT_AUDIENCE=dinkus-ship`
  - `ACCOUNT_JWKS_URL=https://dinkuskit.com/account/.well-known/jwks.json`
  - `ACCOUNT_SIGNIN_URL=https://dinkuskit.com/account/ship-sign-in`
  - `ACCOUNT_TOKEN_URL=https://dinkuskit.com/api/ship-sign-in/token`
- **Secret:** `SHIP_SESSION_SECRET`, 32 or more random characters, set with `wrangler secret put`. The label page answers 503 until it and the two sign-in URLs are set.
- **Shipped email:** var `SHIP_EMAIL_FROM=orders@dinkuskit.com` and the `EMAIL` send_email binding (already in `wrangler.jsonc`), with Cloudflare Email Service sending for dinkuskit.com as DinkusKit.com's own sign-in emails do. Until the var is set, completions wait and nothing is sent. Once it is set, waiting emails go out on Commerce's next call to Ship; anything waiting more than 3 days is dropped.
- **Route:** `ship.dinkuskit.com`. Keep `global_fetch_strictly_public` enabled so token and JWKS requests reach the DinkusKit.com Worker on the same zone. Token exchange uses manual redirect handling and rejects non-2xx replies without forwarding the sign-in code.
- **Pitney Bowes (sandbox):** var `PB_ENVIRONMENT=sandbox`, and secrets `PB_API_KEY`, `PB_API_SECRET` (DinkusKit's PB developer keys) and `PB_SHIPPER_ID` (the sandbox's test merchant), set by Ronald with `wrangler secret put`. They never go in this repository. Until all four are set, real orders cannot get labels and TEST orders get practice labels. Var `PB_DEVELOPER_ID` (DinkusKit's PB developer id, from PB Developer Hub > Profile) turns on owners' sign-up link and connect form. Live postage is not built: it needs Ronald's word and PB's live keys, and PB may charge owners a subscription fee (asked, not yet answered).

## Isolated TEST recipient preparation

See [the isolated sandbox contract](../docs/contracts/isolated-ship-sandbox-v1.md)
and `wrangler.sandbox.jsonc`. Its single allowed order ID starts empty. Resource,
secret, configuration and deployment activation remain separate owner gates.
The deployment entry is `src/entry.ts`; `src/worker.ts` also exports test helpers
and is not the deployment entry. After the two dry builds, `npm run verify:entry`
starts the actual `dist/entry.js` and `dist-sandbox/entry.js` bundles with local
SQLite Durable Objects, synthetic signed passes and blocked external network.
