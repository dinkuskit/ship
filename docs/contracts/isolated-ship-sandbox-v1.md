# Isolated Ship sandbox v1

This is source preparation. Creating resources, deploying, setting secrets or
activation configuration, changing grants, and creating an order or label all
require separate owner authorization. The shared Ship Worker and historical
paid order #1001 remain unchanged.

## Recipient and wire

The only isolated recipient is `ship-sandbox`, origin
`https://ship.sm0ky.dev`, audience `dinkus-ship-sandbox`, mode `test`.
The deployment owns `SHIP_SITE_ID`, `SHIP_GENERATION`, one
`SHIP_ALLOWED_ORDER_ID`, and the historical canonical `SHIP_EXCLUDED_ORDER_ID`.
Generation matches `^[A-Za-z0-9_-]{1,128}$`; canonical IDs are nonempty,
single-line, at most 200 characters. Empty allowed ID admits no orders.
Partial isolated configuration, production PB mode, wrong origin/site, or
allowed/excluded equality fail closed.

All isolated machine calls (`POST /v1/orders`, `GET /v1/labels`,
`POST /v1/labels/ack`) require these headers:

```text
X-Ship-Recipient: ship-sandbox
X-Ship-Generation: <deployment generation>
X-Ship-Mode: test
```

The signed ES256 pass must carry matching `ship_recipient`,
`ship_generation`, `ship_mode` as well as the existing issuer, audience,
site, scope and time claims. There are no order-ID or cohort claims.
Bodies and arrays retain their legacy shapes. Body/query tuple duplication
is refused. Isolated intake/ack receipts and label event elements add
`recipient`, `generation`, `mode`. Commerce must match those receipts before
acknowledging; an unqualified 422 is not an isolated success. Legacy Ship
continues to serve legacy requests and explicitly refuses additive tuples.

## Receiver authority and sessions

Before admitting an order, Ship requires the exact allowed canonical ID,
excludes the protected canonical ID, and requires `test === true`. Stored
orders, owner quotes/buys, PDFs, cancellation, events and acknowledgements
remain scoped to that admission. Unknown isolated event IDs are refused;
legacy idempotent acknowledgement behavior remains unchanged.

Each fresh isolated Durable Object records its site/generation tuple and
refuses adoption of populated legacy storage or another generation. Use a
separate Worker and SQLite namespace, separate session secret, and separate
PB sandbox credentials. A deployment change is not a cross-DO deduplication
mechanism. Draining cached sessions/provider work is part of activation.

Owner sign-in requests and code/refresh exchanges retain the existing issuer
wire shape; the issuer derives recipient/generation/mode from its exact site
registration. Signed owner passes, sealed pending sign-in and
session cookies must match that tuple. HTML forms use the verified session
and deployment configuration; caller headers/form fields do not choose an
admission. Existing session TTL and issuer-outage grace remain; this is not
instant grant revocation.

Isolated mode never queues or sends shipped email, even if an EMAIL binding
and sender are accidentally configured. Owner postage-account connection is
unavailable; only the isolated PB sandbox test merchant is usable.

## Future activation and rollback gates

`service/wrangler.sandbox.jsonc` prepares a separate Worker with no email
binding. Site, generation and excluded ID are intentionally blank and fail
closed; allowed ID remains empty. A later approved activation must provide
the exact nonsecret registration values and isolated secret consumer, then
prove readiness without creating an order. Only after a separately approved
fresh paid TEST order is proved may its canonical ID become the one allowed
ID. Never admit or migrate historical #1001.

Commerce owns private role50 `ship.admit` and cohort disable CAS alongside the
immutable paid order. The pin survives disable and never falls back to legacy.
Its completion and acknowledgement CAS check the enabled pin and storage
revision. Rollback must use that supported disable first, then change
configuration and drain in-flight work; editing configuration alone does not
provide atomic disable. Ship's deployment admission is an additional receiver
check, not the issuer's claim of order freshness.

## Verification boundary

`service/spec/isolation.spec.ts` runs in workerd with real SQLite Durable
Objects and locally signed ES256 passes/JWKS. Transport, owner cookie/refresh,
legacy denial, fresh-ID/TEST guards and email suppression use synthetic data.
Existing intake, owner and email tests preserve legacy compatibility. Both
Wrangler builds are dry runs. Cross-repository compiled Commerce/issuer proof
is coordinated separately using the same frozen wire; no provider-ledger or
live deployment claim follows from these tests.
