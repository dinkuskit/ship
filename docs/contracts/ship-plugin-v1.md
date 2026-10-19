# What the Ship plugin calls (v1)

GrillTrack `ship-registry-plugin-001` (locked 19 Oct 2026, [the decision](../decisions/ship-registry-plugin.md)).
This is the wire contract between the Registry plugin `dinkus-ship` (built from
this repository's root) and the hosted Ship service at `https://ship.dinkuskit.com`
(`service/`). The plugin keeps no label data: every click reads from, or buys
through, Ship.

## Who talks to whom

```
 Store admin (EmDash)                    DinkusKit.com                      Ship (ship.dinkuskit.com)
 ┌──────────────────────┐  store key     ┌──────────────────┐              ┌──────────────────────────┐
 │ Ship plugin          │──────────────▶ │ POST /api/       │              │ /v1/admin/...            │
 │ Shipping page        │ ◀─ 5-min pass ─│   store-passes   │              │ orders, prices, labels,  │
 │                      │──── ship:admin pass ───────────────────────────▶ │ cancel, print-link       │
 │ "Print label"        │ ◀── label + print link (5 minutes) ─────────────│                          │
 └──────────────────────┘                                                  └──────────────────────────┘
          │ new browser tab                                                           ▲
          └────────────── GET /print/{token}, no sign-in, this one label only ────────┘
```

- The store key `dk_store_…` goes only to `https://dinkuskit.com/api/store-passes`,
  never to Ship. The plugin trades it once per click for a pass with
  `scope: "ship:admin"`, `audience: "dinkus-ship"`, and uses the pass only when
  its `iss`, `aud`, `site_id`, `scope` and `exp` are what it asked for.
- The plugin's settings are the **Store ID** (`siteId`) and the **store key**,
  both from the Set up Commerce box on DinkusKit.com, the same ones Commerce uses.
- Ship verifies the pass as it verifies Commerce's (`service/src/auth.ts`); the
  store is the pass's `site_id` and nothing in the request can name another.

## The scope DinkusKit.com must issue

`POST /api/store-passes` with body `{ site_id, scope: "ship:admin", audience: "dinkus-ship" }`
must sign a pass exactly like the `ship:orders` one, under the store's existing
**Ship** grant (the owner's Ship on/off switch): same issuer, audience, `site_id`,
`site_origin`, 5-minute life. This is a `dinkuskit/dinkuskit` change
(`STORE_PASS_SERVICES` in `src/account/config.ts`, plus the lookup in
`src/account/store-passes.ts`, which today finds a service by scope and audience).
Until it lands, the plugin's every click answers "DinkusKit.com refused to sign a
pass (400)".

## Routes (scope `ship:admin`)

Every call carries `Authorization: Bearer <pass>`, JSON in and out, `cache-control: no-store`.
Errors are `{ error: { code, message } }` with the status Ship's own page would
give; the plugin shows `message` as it is.

| Call | Answer |
| --- | --- |
| `GET /v1/admin/orders` | `200 { orders: Row[], settings: Settings }`: every order Ship has for the store, Processing first, newest first, at most 200, as short rows (below) so the answer stays small whatever the orders hold. |
| `GET /v1/admin/orders/{orderId}` | `200 { order: Order, settings: Settings }`; `404 NOT_FOUND` when Commerce has not sent the order. |
| `POST /v1/admin/orders/{orderId}/prices` with `{ version, boxId, weightOz }` | `200 { prices: { GA, PM, EM } }` in cents, `null` for a service Pitney Bowes refused for this package. Refusals as on Ship's page: `409 ORDER_CHANGED`, `ALREADY_COMPLETED`, `ALREADY_LABELED`, `ADDRESS_PROBLEM`, `NO_SHIP_FROM`, `TEST_ORDER`; `503 POSTAGE_NOT_CONNECTED`. |
| `POST /v1/admin/orders/{orderId}/labels` with `{ version, boxId, weightOz, service, by, kind?: "practice", buyAgain?: true }` | `201 { label: Label }`. `by` is who pressed the button (the admin's email, kept as `admin:<email>` in `createdBy`). The same refusals as prices, plus `409 LABEL_IN_PROGRESS`, `409 CHECK_PITNEY_BOWES` (send `buyAgain: true` after the owner ticks the box), `502 PITNEY_BOWES_NO_ANSWER`. |
| `POST /v1/admin/labels/{labelId}/cancel` | `200 { labelId, refund }`; `404 NOT_FOUND` for no live label; `503 POSTAGE_NOT_CONNECTED`. Cancelling never changes the Commerce order. |
| `POST /v1/admin/labels/{labelId}/print-link` | `200 { url, expiresAt }`: `https://ship.dinkuskit.com/print/{token}` opens this one label's PDF for 5 minutes with no sign-in. `404 NOT_FOUND` for a label the store does not have. |
| `GET /print/{token}` (no pass) | The PDF inline (`application/pdf`, `private, no-store`, `referrer-policy: no-referrer`); `410` for an expired, foreign or altered link; `503` while Pitney Bowes's copy cannot be fetched. |

`Row`: `orderId`, `number`, `version`, `status`, `test`, `shipTo`, `addressProblem`,
`items` (one short line, "2 × Demo Mug, 1 × Hat, +3 more") , `itemCount` and `labelStatus`
(`bought` for a live label on this version, `cancelled` when the last one was, else null).
`Order`: `orderId`, `number`, `version`, `status` (`processing` or `completed`),
`test`, `shipTo { name, lines[], city, region, postalCode }`, `addressProblem`
(text to show, or null), `lines[] { name, quantity, weightOz }`, `itemsWeightOz`,
`label` (the live label for this version, or null) and `labels[]` (every label,
oldest first). `Label` is Ship's label record without the PDF: `labelId`,
`orderId`, `version`, `test`, `service` (`GA`, `PM`, `EM`), `box`, `weightOz`,
`carrier`, `tracking`, `status` (`bought` or `cancelled`), `createdBy`,
`createdAt`, `cancelledAt`, `practice`, `priceCents`, `refund`.
`Settings`: `shipFrom` (boolean), `boxes[]`, `postageConnected`, `testSandbox`.
Nothing about the owner's Pitney Bowes account crosses to the plugin.

The `ship:orders` routes (`/v1/orders`, `/v1/labels`, `/v1/labels/ack`) are
unchanged and refuse a `ship:admin` pass, as the admin routes refuse a
`ship:orders` one.

## The print link

The token is Ship's session seal (`SHIP_SESSION_SECRET`, HMAC-SHA-256) over
`{ kind: "print", site, labelId, exp }`, so a session cookie's payload can never
open a label and a print link can never act as a session. Ship mints one per
"open the order" in the plugin; the admin's "Print label" is an ordinary link
that opens it in a new tab. After five minutes the page says to open the order
again, which mints a fresh one.

## What stays on ship.dinkuskit.com

Settings (ship-from address, boxes, reply-to), the owner's Pitney Bowes account
(its sign-in never passes through the store admin), refunds questions and
label history. The plugin links there from every page; it is the full path and
the fallback when the plugin is not installed or the store admin is down.
