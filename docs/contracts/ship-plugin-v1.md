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

- The store key `dk_store_…` goes only to DinkusKit.com, never to Ship: to
  `https://dinkuskit.com/api/store-passes` for passes, and once, from the
  `plugin:uninstall` hook, to `https://dinkuskit.com/api/store-keys/cancel`
  (connect-uninstall-cancels-key-134). The cancel sends `{ site_id }` with the key as
  Bearer and deletes only Ship's own key; the store, the other plugins' keys and the
  Ship grant stay, so installing Ship again shows Finish setup. The plugin trades it for a 5-minute pass with
  `scope: "ship:admin"`, `audience: "dinkus-ship"`, keeps the pass in its own
  plugin KV beside a SHA-256 fingerprint of the key, and reuses it for later
  clicks only while the pass is under a minute old (its `iat`), has at least
  30 seconds left, and the plugin still has the same key. So a burst of
  clicks shares one trade, and a Disconnect or a Ship turned off at
  DinkusKit.com stops clicks within a minute (ship-pass-reuse-001). It uses a
  pass only when its `iss`, `aud`, `site_id`, `scope` and `exp` are what it
  asked for; a kept pass Ship answers 401 to is dropped and the call retried
  once on a fresh one.
- The plugin gets its Store ID and its own store key from **Connect to DinkusKit**
  (store-connect-per-plugin-key-080, store-connect-flow-081), never from a paste.
  An Administrator presses Connect on the Shipping page; the plugin starts a
  protocol-2 connection (`client_id: "dinkus-ship-emdash"`, `service: "ship"`,
  PKCE S256, callback `/_emdash/admin/plugins/<installed id>/shipping`), serves the
  receipt on its one public route, `store-proof`, while that Connect waits, and
  polls `/api/store-connections/token` on Check or page load. The business owner
  approves at DinkusKit.com; the answer is `{ store_key, site_id }`, saved in
  the encrypted `connection` setting in place of the verifier. DinkusKit.com
  refuses with `connect_commerce_first` until Commerce has connected the store.
  A key DinkusKit.com no longer knows (`invalid_store_key`, `site_mismatch`), or a
  store where Ship is off (`service_not_enabled`), shows **Connect again**.
- Connecting turns Ship on for the store (store-connect-ship-on-at-setup-126); the
  owner's **Disconnect Ship** under Your stores turns it off. There is no separate
  Ship switch.
- **Finish setup** (store-connect-approve-once-125): before Connect, the page asks
  `POST /api/store-connections/lookup` (`{ protocol_version: 2, client_id, service,
  site_origin, callback_uri }`). When it answers `{ finish_setup: true }` (the
  business already connected this store and the owner has not disconnected Ship),
  an Administrator sees **Finish setup** instead of Connect; Editors see no button.
  The press starts the same protocol-2 Connect, then sends
  `POST /api/store-connections/finish` with `{ client_id, connection_id,
  code_verifier }`. DinkusKit.com reads the receipt on `store-proof` as for Approve
  and answers `{ store_key, site_id }` with no second Approve, turns Ship on and
  emails the owner. `owner_approval_required` falls back to the Approve link and
  **Check**; any other refusal saves nothing.
- **Connected-to line** (connect-shows-siblings-133): the orders list trades the key
  for a pass with `scope: "store:connection"`, `audience: "dinkuskit"` and reads
  `GET https://dinkuskit.com/api/store-connection` with it, which answers
  `{ business, site_origin, plugins }`. The page names the business and the
  plugins; on any failure the line is left off.
- Upgrading from 0.2.1 (store-connect-no-paste-082): pasted keys retire, so the
  old `siteId` and `storeKey` settings are never used or sent. A store that
  still has the old Store ID shows why it must Connect once; the plugin reads only
  that plain Store ID, never the old key. When Connect finishes both old settings
  are deleted.
- Ship verifies the pass as it verifies Commerce's (`service/src/auth.ts`); the
  store is the pass's `site_id` and nothing in the request can name another.

## The scope DinkusKit.com must issue

`POST /api/store-passes` with body `{ site_id, scope: "ship:admin", audience: "dinkus-ship" }`
must sign a pass exactly like the `ship:orders` one, under the store's existing
**Ship** grant (on once Ship connects, off after the owner's Disconnect): same issuer, audience, `site_id`,
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
| `POST /v1/admin/orders/{orderId}/prices` with `{ version, boxId, weightOz }` | `200 { prices: { GA, PM, EM }, quoteId }` in cents, `null` for a service Pitney Bowes refused for this package. Refusals as on Ship's page: `409 ORDER_CHANGED`, `ALREADY_COMPLETED`, `ALREADY_LABELED`, `ADDRESS_PROBLEM`, `NO_SHIP_FROM`, `TEST_ORDER`; `503 POSTAGE_NOT_CONNECTED`. |
| `POST /v1/admin/orders/{orderId}/labels` with `{ version, boxId, weightOz, service, by, kind?: "practice", buyAgain?: true, quoteId?: string, reviewedDimensions?: string }` | `201 { label: Label }`. `by` is who pressed the button (the admin's email, kept as `admin:<email>` in `createdBy`). The same refusals as prices, plus `409 LABEL_IN_PROGRESS`, `409 CHECK_PITNEY_BOWES` (send `buyAgain: true` after the owner ticks the box), `502 PITNEY_BOWES_NO_ANSWER`. |
| `POST /v1/admin/orders/{orderId}/labels/check` with `{ version }` | `200 { label: Label }` for a recovered or already recorded purchase. Never asks for rates or buys a shipment. `409 LABEL_ATTEMPT_CHANGED` when nothing is pending, `409 LABEL_IN_PROGRESS` during a carrier operation, and `409 CHECK_PITNEY_BOWES` when the carrier has no record. The plugin links to **Open in Ship** if the Worker does not have this route. |
| `POST /v1/admin/labels/{labelId}/cancel` | `200 { labelId, refund }`; `404 NOT_FOUND` for no live label; `503 POSTAGE_NOT_CONNECTED`. Cancelling never changes the Commerce order. |
| `POST /v1/admin/labels/{labelId}/print-link` | `200 { url, expiresAt }`: `https://ship.dinkuskit.com/print/{token}` opens this one label's PDF for 5 minutes with no sign-in. `404 NOT_FOUND` for a label the store does not have. |
| `GET /print/{token}` (no pass) | The PDF inline (`application/pdf`, `private, no-store`, `referrer-policy: no-referrer`); `410` for an expired, foreign or altered link; `503` while Pitney Bowes's copy cannot be fetched. |
| `GET /v1/admin/labels?before=` | `200 { labels: HistoryLabel[], next: string \| null }`: every label the store bought or cancelled, newest first, 50 at a time (ship-settings-in-admin-129). `before` is the previous answer's `next`; anything else is `400 INVALID_INPUT`. `HistoryLabel` is a `Label` with the order's `number`. |
| `GET /v1/admin/settings` | `200 { settings: SettingsPage }` (below). |
| `POST /v1/admin/settings/ship-from` with `{ name, company?, line1, line2?, city, region, postalCode }` | `200 { settings: SettingsPage }`, or `400 INVALID_INPUT` with what is wrong, as on Ship's own Settings. |
| `POST /v1/admin/settings/reply-to` with `{ replyTo }` | The same. |
| `POST /v1/admin/settings/boxes` with `{ name, lengthIn, widthIn, heightIn, weightOz }` | `201 { settings: SettingsPage }`, or `400 INVALID_INPUT`. |
| `POST /v1/admin/settings/boxes/{boxId}/remove` | `200 { settings: SettingsPage }`. |
| `POST /v1/admin/settings/postage` with `{ username, password }` | `200 { settings: SettingsPage }` once Pitney Bowes finds the account (ship-pitney-connect-in-admin-138); `422` when it does not; `400 INVALID_INPUT` without `x-ship-admin-user`. The password goes to Pitney Bowes once and Ship keeps neither it nor the username; `connectedBy` is `admin:<email>`. |
| `POST /v1/admin/settings/postage/disconnect` | `200 { settings: SettingsPage }`. |

Shipments sends the `quoteId` for new or replacement postage. It is valid for 15 minutes for the same store, ship-from revision, order revision, postage account, box dimensions and package weight, and only the services the carrier returned. It does not approve a replacement or guarantee the carrier's final price. After an ambiguous purchase, **Check last label** uses the check-only route even if the quote expired or the package settings changed. It cannot approve a replacement. A retry first checks whether the carrier already bought the label. If Ship would need fresh postage, a stale or mismatched quote returns `409 QUOTE_CHANGED`; ask for new rates before confirming. For a practice label Shipments sends `reviewedDimensions` as `length:width:height` in inches instead, with no quote. Changed dimensions return `409 BOX_CHANGED`. Older plugins and Ship's own pages can still use their existing label requests; the updated plugin uses **Open in Ship** when the service has not issued a quote ID.

Ship records the postage account and carrier environment on each new pending purchase. A different account or environment returns `409 LABEL_ACCOUNT_CHANGED` rather than looking up or replacing that attempt. The service checks the account again after a carrier miss. For older purchases without an account binding, a positive lookup still recovers the label, but a miss returns `409 LABEL_ACCOUNT_UNVERIFIED`. In both cases the unresolved purchase is kept, and Ship does not offer or start a replacement.

Every settings route refuses a field the form does not have (`400 INVALID_INPUT`)
and takes each value as a string of at most 300 characters or a number.

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
`SettingsPage`: `shipFrom` (the address, or null), `boxes[]`, `replyTo`, `storeName`,
`postageConnected`, `testSandbox`, `postageAccount` (`{ company, email, accountEnding,
connectedAt }` or null) and `signupUrl` (Pitney Bowes' sign-up page with the ship-from
address and the calling admin's email filled in, or null while Ship cannot connect
owners' accounts). The Shipper ID, who connected the account and DinkusKit's developer
id never cross to the plugin.

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

Ship's own pages keep everything the plugin shows, including Settings and the
owner's Pitney Bowes account, as the full path and the fallback when the plugin is
not installed or the store admin is down. Signing up for Pitney Bowes stays on
Pitney Bowes' site, reached through Ship's prefilled link from either page. The
plugin's Shipping settings page and Label history fall back to links to Ship's
own pages while ship.dinkuskit.com answers `404` for the routes above.
