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
  never to Ship. The plugin trades it for a 5-minute pass with
  `scope: "ship:admin"`, `audience: "dinkus-ship"`, keeps the pass in its own
  plugin KV and reuses it across clicks while it has at least 30 seconds left,
  so the key is traded about once per five minutes rather than once per click.
  It uses a pass only when its `iss`, `aud`, `site_id`, `scope` and `exp` are
  what it asked for; a kept pass Ship answers 401 to is dropped and the call
  retried once on a fresh one.
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

Every call also carries `x-ship-admin-page: https://<store>/_emdash/admin/plugins/<pluginId>/shipping`,
the store admin's Shipping page, which the plugin derives from the admin API URL
EmDash calls it on. Ship keeps it only when the page is on the origin DinkusKit.com
signed into the pass (`site_origin`) and has that exact path, with no query string.
It is what the forward below lands on. Every call also carries
`x-ship-admin-user: <email>`, the store admin whose page load it is, as EmDash
attests them (`routeCtx.user.email`, lower-cased). Ship keeps the emails it has
seen for a week (at most 50) and compares them without case: they decide whom
the forward below is for.

| Call | Answer |
| --- | --- |
| `GET /v1/admin/orders` | `200 { orders: Row[], settings: Settings, open: string \| null }`: every order Ship has for the store, Processing first, newest first, at most 200, as short rows (below) so the answer stays small whatever the orders hold. `open` is the `orderId` Ship just forwarded this same admin here for (below), given once to a call naming that admin's email and then forgotten, and `null` for anyone else; the plugin opens that order instead of the list. |
| `GET /v1/admin/orders/{orderId}` | `200 { order: Order, settings: Settings }`; `404 NOT_FOUND` when Commerce has not sent the order. |
| `POST /v1/admin/orders/{orderId}/prices` with `{ version, boxId, weightOz }` | `200 { prices: { GA, PM, EM } }` in cents, `null` for a service Pitney Bowes refused for this package. Refusals as on Ship's page: `409 ORDER_CHANGED`, `ALREADY_COMPLETED`, `ALREADY_LABELED`, `ADDRESS_PROBLEM`, `NO_SHIP_FROM`, `TEST_ORDER`; `503 POSTAGE_NOT_CONNECTED`. |
| `POST /v1/admin/orders/{orderId}/labels` with `{ version, boxId, weightOz, service, by, kind?: "practice", buyAgain?: true }` | `201 { label: Label }`. `by` is who pressed the button (the admin's email, kept as `admin:<email>` in `createdBy`). The same refusals as prices, plus `409 LABEL_IN_PROGRESS`, `409 CHECK_PITNEY_BOWES` (send `buyAgain: true` after the owner ticks the box), `502 PITNEY_BOWES_NO_ANSWER`. |
| `POST /v1/admin/labels/{labelId}/cancel` | `200 { labelId, refund }`; `404 NOT_FOUND` for no live label; `503 POSTAGE_NOT_CONNECTED`. Cancelling never changes the Commerce order. |
| `POST /v1/admin/labels/{labelId}/print-link` | `200 { url, expiresAt }`: `https://ship.dinkuskit.com/print/{token}` opens this one label's PDF for 5 minutes with no sign-in. `404 NOT_FOUND` for a label the store does not have. |
| `GET /print/{token}` (no pass) | The PDF inline (`application/pdf`, `private, no-store`, `referrer-policy: no-referrer`); `410` for an expired, foreign or altered link; `503` while Pitney Bowes's copy cannot be fetched. |

`Row`: `orderId`, `number`, `version`, `status`, `test`, `shipTo`, `addressProblem`,
`items` (one short line, "2 × Demo Mug, 1 × Hat, +3 more") , `itemCount`, `labelStatus`
(`bought` for a live label on this version, `cancelled` when the last one was, else null)
and `delivery` (the bought label's, below, or null).
`Order`: `orderId`, `number`, `version`, `status` (`processing` or `completed`),
`test`, `shipTo { name, lines[], city, region, postalCode }`, `addressProblem`
(text to show, or null), `lines[] { name, quantity, weightOz }`, `itemsWeightOz`,
`label` (the bought label for this version; once Commerce has completed the order,
which bumps its version, the bought label it completed with, so Print and Cancel
stay available; else null) and `labels[]` (every label, oldest first). `Label` is Ship's label record without the PDF: `labelId`,
`orderId`, `version`, `test`, `service` (`GA`, `PM`, `EM`), `box`, `weightOz`,
`carrier`, `tracking`, `status` (`bought` or `cancelled`), `createdBy`,
`createdAt`, `cancelledAt`, `practice`, `priceCents`, `refund` and `delivery`
(ship-tracking-001): `null` until the carrier's first scan, and always for sandbox
and practice labels, which never move; else `{ state, at, note }` with `state` one of
`in_transit`, `out_for_delivery`, `delivered`, `problem` (delivery attempted,
exception, return to sender, ready for pickup, pickup missed, delayed), `at` the
scan's time as UTC ISO and `note` the carrier's one line on it or null. The plugin
shows `state` as "In transit", "Out for delivery", "Delivered" or "Problem", with the
note on the order's page.
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

## The forward from Commerce's "Create shipping label"

Commerce's button opens `https://ship.dinkuskit.com/stores/{site}/orders/{orderId}`.
Once the store's Ship plugin has called with `x-ship-admin-page` in the last 7 days,
that page answers `303` to the store admin's Shipping page for a signed-in Ship
owner arriving from outside Ship (`Sec-Fetch-Site` cross-site, same-site or none:
Commerce's button, or the way back from sign-in) whose DinkusKit.com email the
plugin has sent in `x-ship-admin-user` in the last 7 days, and queues the order for
that person: the next `GET /v1/admin/orders` naming the same email gets it as
`open` (kept for one minute and only for an order Ship has); a call naming anyone
else, or nobody, gets `null` and leaves it waiting. Each admin has their own
waiting order, so two people forwarding at once never erase each other's; a
second order for the same person while one still waits is not forwarded (Ship's
own page shows it), so neither is lost. Signing in on the way to a `?view=full`
page comes back to it in full. Anyone not signed in to Ship
signs in first, as for any of Ship's pages, and queues nothing. An owner the
plugin has not named (a different email on DinkusKit.com than in EmDash, or
someone who has not opened the Shipping page in a week) gets Ship's own order
page, as do Ship's own links and redirects (same-origin), browsers that do not
say where they came from, `?view=full` (the plugin's "Open in Ship" links) and
stores whose plugin has not called in a week, so the two never bounce, nobody
is sent to a page that will not open their order, and a removed plugin falls
back within a week. The list and settings pages are never forwarded
(ship-registry-plugin-001, question 4).

## Tracking updates (no pass)

`POST /v1/tracking/pitney` is where Pitney Bowes sends its tracking updates for
every label bought under DinkusKit's developer account (one address per account),
signed in with Basic username and password (Worker secrets `PB_TRACKING_USER` and
`PB_TRACKING_PASSWORD`; 503 until both are set, 401 otherwise). The body is PB's
`{ trackingEvents: [...] }`; Ship answers `200 { responses: [{ statusCode, errors }] }`
per event, echoing `X-PB-ReferenceId`, so PB resends nothing (it retries other
statuses for 16 hours). Each event's tracking number is looked up in Ship's one
index from tracking number to store and label, written when a live label is bought
and dropped when it is cancelled; unknown numbers answer 404 in their row. A daily
cron (14:00 UTC) asks PB's Track a Parcel about every live label not yet delivered,
for 60 days, to catch a missed update. Neither the plugin nor Commerce calls this.

## What stays on ship.dinkuskit.com

Settings (ship-from address, boxes, reply-to), the owner's Pitney Bowes account
(its sign-in never passes through the store admin), refunds questions and
label history. The plugin links there from every page; it is the full path and
the fallback when the plugin is not installed or the store admin is down.
