# DinkusKit Ship service

The hosted Ship service for ship.dinkuskit.com. It runs as a Cloudflare Worker with one SQLite Durable Object per store, like the Payments and Coupons services. GrillTrack decisions: `ship-hosted-service-001` and `ship-order-intake-001`.

Status: order intake for Commerce is built. Not built yet:

- the owner's label page, with Sign in with DinkusKit.com (`ship-owner-signin-001`);
- Pitney Bowes label purchase;
- the shipped email.

Nothing here is deployed.

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

## Deploy settings (for Ronald's deploy agents, on his go)

- **Vars:**
  - `ACCOUNT_ISSUER=https://dinkuskit.com/account`
  - `ACCOUNT_AUDIENCE=dinkus-ship`
  - `ACCOUNT_JWKS_URL=https://dinkuskit.com/account/.well-known/jwks.json`
- **Route:** `ship.dinkuskit.com`.
- **Pitney Bowes keys:** these will be Worker secrets that Ronald sets. They never go in this repository.
