# Ship plugin in the store admin

GrillTrack: `ship-registry-plugin-001`, locked 19 Oct 2026 on Ronald's approval. Build waits until after go-live.

Ronald answered the design questions on 19 Oct 2026.

## What is locked

1. **Ship gets a Registry plugin.** Owners who install from the Registry see Ship next to Commerce ("spot on").
2. **It is a mirror of Ship, not a second Ship.** The plugin keeps no label data of its own. On every click it reads from, or buys through, the hosted Ship service at ship.dinkuskit.com, so the two can never disagree. Pitney Bowes keys stay Ship secrets; the plugin never holds them and never buys postage itself.
3. **It covers the everyday steps:** see rates, "Buy label", "Print label", and the label and tracking state on each order. Everything rarer links to Ship's page: refunds, Settings, label history, and connecting the owner's own Pitney Bowes postage account.
4. **"Print label" opens the label PDF in a new tab.** That needs one small Ship change: Ship hands the plugin a short-lived private link that opens only that one label, without a Ship sign-in. Today `ship.dinkuskit.com/stores/<store>/labels/<id>.pdf` opens only for someone signed in to Ship. With the new tab, printing no longer waits on emdash#4049.
5. **ship.dinkuskit.com stays** as the full path and the fallback: it works when the plugin is not installed, is mid-update, or the store admin is down, and it is the only place the owner's PB sign-in happens.
6. **Staff permissions come from EmDash's own roles** in the store admin.
7. **The old test plugin in the dinkuskit/ship repo root is stripped out** when this work starts, so nobody installs its dead Orders page.
8. **Timing:** after go-live, not before.

## Why v1 went to Ship's own page instead

He said he wishes it had been built this way from the start. It wasn't, for three reasons that were real on 12 Oct:
- A Registry plugin can only draw Block Kit screens, so the label pop-up (boxes, weights, preview) could not be the custom page Ship has.
- Printing a PDF from inside the EmDash admin was blocked upstream (emdash#4049). Opening the PDF in a new tab, which is now the plan, needed the short-lived link above, and Ship did not exist yet to make one.
- Folding labels into Commerce would have overflowed Commerce's backend.js, which sits near the 128 KiB per-file cap.
None of the hosted work is wasted: the plugin is a thin Block Kit front end on the Ship service that is already live.

## Who talks to whom

```
 Store admin (EmDash)                    DinkusKit.com                Ship (ship.dinkuskit.com)           Pitney Bowes
 ┌──────────────────────┐   store key    ┌──────────────┐            ┌──────────────────────────┐       ┌─────────────┐
 │ Ship plugin          │──────────────▶ │ /api/store-  │            │ hosted Ship service      │       │ owner's own │
 │ (Block Kit screens)  │ ◀── 5-min pass │  passes      │            │ orders, labels, tracking │ ────▶ │ postage acct│
 │                      │──── pass ─────────────────────────────────▶│ rates / buy / status     │ ◀──── │ (DinkusKit  │
 │ "Buy label"          │ ◀─── label + private PDF link (minutes) ───│                          │       │  dev keys)  │
 └──────────────────────┘                                            └──────────────────────────┘       └─────────────┘
          │ "Print label"                                                         ▲
          └──────── new browser tab opens the private PDF link ───────────────────┘
 Commerce (unchanged): sends each paid order to Ship, reads labels back, marks the order Completed with tracking.
 Owner's browser: ship.dinkuskit.com for Settings, refunds, history, PB account (Sign in with DinkusKit.com).
```

## Rules this design must keep

- Pitney Bowes 2a: one DinkusKit PB developer account (keys only as Ship secrets); each owner their own PB postage account; the owner's PB sign-in never passes through the store admin.
- The store key `dk_store_` goes only to https://dinkuskit.com/api/store-passes for 5-minute ES256 passes carrying site_origin; it is never sent to Ship or a store page.
- Registry caps (RFC 0001): 128 KiB per file, 256 KiB total, only backend.js runs, no plugin-to-plugin calls, the manifest lists every host the plugin calls.
- Hosted Workers calling fetch use `redirect: "manual"` and refuse anything but the expected 2xx.

## How other shipping apps do it (checked 19 Oct)

Pirate Ship, ShipStation, Shiptheory and Shippo keep labels on their own site and only push tracking and "fulfilled" back to the store. Only Shopify's built-in Shipping buys labels on the order page. The mirror gives owners Shopify's experience while Ship stays the only place labels live. Sources: [Shopify Shipping](https://help.shopify.com/manual/shipping/labels/buy-and-print), Pirate Ship (support.pirateship.com, Shopify integration article), [ShipStation for Woo](https://fair.pm/packages/plugins/woocommerce-shipstation-integration), Shiptheory (support.shiptheory.com, on-demand label printing article), [Shippo](https://apps.shopify.com/shippo).

## Answers (19 Oct 2026)

All eight questions answered yes: 1 to 7 below, 4 with the addition that follows, and 8 (live tracking) in the tracking section.

## Question 4, Ronald's addition

He wants Commerce's "Create shipping label" to lead to the plugin once the plugin is proved working. Agreed: no Commerce change. Ship already builds that button's address; once a store's Ship plugin has signed in, Ship sends that address on to the store admin's Shipping page for the order. Stores without the plugin keep landing on ship.dinkuskit.com, and Ship's page keeps a link to its full version. Turned on only after the plugin's journey passes on the beta store.

## Live tracking: Pitney Bowes or USPS directly (checked 19 Oct)

- **Pitney Bowes** pushes scan updates (In transit, Out for delivery, Delivered, Exception, Return to sender and others) to one web address per *developer account* ([webhook docs](https://docs.shippingapi.pitneybowes.com/tracking/webhook.html)). Under PB 2a every store's labels are bought through DinkusKit's one developer account, so one Ship address would get updates for every store. It is switched on by contacting PB with the address and a username and password (or OAuth) that PB sends with each update; PB retries failures for 16 hours. There's also a "Track a Parcel" lookup to ask for one label's status ([overview](https://docs.shippingapi.pitneybowes.com/tracking/overview.html)). Catch: tracking only works for live labels, not sandbox ones, so TEST orders never get scan updates. No price is listed.
- **USPS directly** has tracking subscriptions in its new APIs ([guide](https://hookdeck.com/webhooks/platforms/guide-to-usps-webhooks-features-and-best-practices)): DinkusKit would need its own USPS business account (a CRID), subscribe per mailer or per tracking number, verify each update by its signature, and keep subscriptions alive (they stop after 30 days quiet, and USPS doesn't retry a missed update). It's USPS only and adds a second outside account.
- **Recommendation (inference):** use Pitney Bowes' updates, since they come with the account we already have and cover every store at once, plus a daily "Track a Parcel" check for labels still not delivered, to catch a missed update. Build it as its own small Ship change after the plugin, so the plugin's states grow from 3 to include In transit and Delivered when it lands. Ask PB about the webhook and any fee in the same thread as the pending fee question.

## Questions answered (19 Oct 2026; all yes)

1. **Sign-in:** the plugin uses the same store key the owner already pasted into Commerce (pasted once more in the Ship plugin's settings) and trades it at DinkusKit.com for a 5-minute Ship pass. **Yes.** (Other choice: a separate Ship-only key.)
2. **Who can buy and print in the admin:** Administrators and Editors; lower roles don't see Shipping. DinkusKit.com's "Print shipping labels in Ship" tick keeps covering Ship's own page only. **Yes.**
3. **What each order shows:** No label; Label bought, with its tracking number linked to USPS tracking; Label cancelled. In transit and Delivered wait until Ship gets carrier scan updates (not built yet). **Yes.**
4. **Where it lives:** the plugin adds a "Shipping" page listing orders waiting to ship, with "Buy label" and "Print label" on each. Commerce's "Create shipping label" keeps opening ship.dinkuskit.com for now. **Yes.**
5. **Print link:** opens that one label for 5 minutes and can be reopened in that time; after that, pressing "Print label" again makes a fresh link. **Yes.**
6. **"Cancel label" in the plugin too**, because a wrong label is an everyday mistake; refunds questions and label history stay on Ship's page. **Yes.**
7. **Release:** Registry names dinkus-ship and dinkus-ship-beta, built from the Ship repo root; a new journey "Buy a label in the store admin" must pass on the beta store before the final release; TEST orders get sandbox labels and a TEST banner exactly as on Ship's page. **Yes.**
