---
article: reference/ship
title: "Ship"
summary: "Understand the Ship plugin, the hosted shipping service, and sandbox labels."
audience: "Store owners and developers"
product: "Ship"
version_scope: "Ship {{version}}"
---

Ship buys USPS shipping labels for Commerce orders. [Commerce](/docs/reference/commerce) owns checkout shipping charges and order records; Ship handles labels and reports tracking back. Ship does not own product stock or payment confirmation.

Shipping is outside the required first-test-order outcome. Start with [requirements](/docs/start-here) and [store setup](/docs/store-owners/setup); a test label cannot establish that checkout was paid or that Commerce saved the order.

This reference describes the Ship plugin `{{version}}`, released on the EmDash Registry as `dinkus-ship` on {{release_date}} (tag `v{{version}}`), and the hosted Ship service at ship.dinkuskit.com.

## The plugin and the hosted service

Ship has two parts that work together:

| Part | What it does |
| --- | --- |
| Ship plugin (`dinkus-ship`) | Adds two pages to the **Store** folder of the store admin. **Shipments**, for Editors and Administrators, lists the paid orders Commerce sent to Ship, newest first and 50 at a time with **Load more**, shows USPS prices, has **Buy label**, **Print label** and **Cancel label**, and has **Label history**. **Shipping settings**, for Administrators, holds the ship-from address, the Pitney Bowes postage account, the shipped email's reply-to address and box sizes. |
| Hosted Ship service | Takes Commerce's orders, buys, keeps and cancels labels, keeps the settings, sends the shopper the shipped email, and serves the owner's own pages at ship.dinkuskit.com (sign in with DinkusKit.com), which show the same settings, Pitney Bowes account and label history. |

The plugin keeps no label data and no settings. Every click reads from, saves to, or buys through the hosted service, so the plugin's pages and Ship's own pages always agree. Ship's own pages are the full path, and the fallback when the plugin is not installed.

## Set up the plugin

Install **DinkusKit Ship** from the plugin Registry. Connect [Commerce](/docs/reference/commerce) first, because Commerce's Connect makes the store at DinkusKit.com. Then an Administrator opens **Store > Shipments** in the store admin and presses **Connect**, and the business owner presses **Approve** at DinkusKit.com. Nothing is pasted: DinkusKit.com gives Ship its own store key, which the plugin keeps, with the Store ID, in its encrypted DinkusKit connection setting. Connect needs the store on its https web address with Ship installed from the Registry. Connecting also turns Ship on for the store; there is no separate switch at DinkusKit.com.

If the store is already connected to DinkusKit, for example through Commerce, the Shipments page says "Almost ready: this store is already connected to DinkusKit" and shows one **Finish setup** button instead. An Administrator presses it: there is no second approval, Ship gets its own store key, Ship turns on, and the page opens the orders. DinkusKit.com emails the business owner that Dinkus Ship joined the store. If the owner pressed Disconnect for Ship under Your stores, the page asks for the owner's Approve again instead. The orders page says which business the store is connected to and which DinkusKit plugins share it. Uninstalling Ship cancels only Ship's own key at DinkusKit.com.

If **Finish setup** says Ship could not confirm the attempt, press **Check setup**. If the attempt ended without a usable reply and the store is still eligible, **Finish setup** starts a fresh attempt without asking the owner to approve. If Ship is still waiting, you can press **Cancel setup** to end the attempt and see the setup option now available.

The plugin never sends the store key to Ship or to a store page. It trades the key at DinkusKit.com for a pass that lasts five minutes and reuses that pass for clicks in the next minute. A Disconnect at DinkusKit.com, which also turns Ship off, stops the Shipments page within a minute. A store connected before Ship turned on at Connect presses **Connect again** once. If DinkusKit.com no longer knows the key, the page shows **Connect again**.

A store upgraded from `0.2.1` does not use its old pasted key. The Shipments page asks for Connect once, and Connect removes the old Store ID and store key settings.

## Shipping settings

An Administrator opens **Store > Shipping settings**. Editors see a note to ask an Administrator. Each part saves to Ship straight away. If Ship rejects a save, look below the form you submitted for the reason:

- **Ship from**: the return address printed on every label.
- **Pitney Bowes postage**: real orders' labels are paid from your own Pitney Bowes postage account, and Pitney Bowes charges the card you add there, not DinkusKit. Press **Create your Pitney Bowes account** to sign up on Pitney Bowes' site with your ship-from address and email filled in, then come back and enter that account's username and password and press **Connect Pitney Bowes**. Ship sends them to Pitney Bowes once to find your account and keeps neither. Once connected, the page names the account and has **Disconnect Pitney Bowes**. TEST orders do not need an account.
- **Shipped email**: the reply-to address for the email Ship sends the shopper when a label is bought. It is sent from orders@dinkuskit.com under your store's Site title.
- **Box sizes**: each box's name, size in inches and empty weight in ounces, with **Remove** and **Add box size**. Labels need at least one.

Labels need the ship-from address and a box size; the Shipments page says so until both are set. Ship's own Settings page at ship.dinkuskit.com shows and changes the same settings.

## Label history

On **Store > Shipments**, **Label history** lists every label the store bought, newest first and 50 at a time with **Load more**: the day it was bought, the order, the service and postage, the tracking number and where the parcel is, or that the label was cancelled. Press an order number to open it, then use **Back to Label history** to return to the page you were viewing.

## Buy a label

1. Open **Store > Shipments** in the store admin. Counts at the top show how many orders are **To ship**, need you to **Fix address**, and are **On the way**. Each row shows the order number (press it to open the order), who it goes to (name and city) and a status with a coloured dot: yellow **Needs label**; red **Fix address**, **Label cancelled** or **Delivery problem**; blue **Label bought**, **In transit** or **Out for delivery**; green **Delivered**; white **Completed** (finished in Commerce without a Ship label).
2. The order page shows **Ship to** on its address lines beside **Package** (the item count and what the items weigh), then the items with their weights. When any item has options, an **Options** column shows the shopper's choices, such as Size: M, so two sizes of one product show apart (Ship's own order page shows them in grey under the name). Weights read in pounds and ounces, such as 1 lb 4.5 oz. A very large order shows its first 50 items and its 50 newest labels, then says how many more there are; **Open in Ship** lists them all.
3. Under **Buy a label**, check the box and the package weight in ounces (items plus box), then press **See prices**. Pick a USPS service from the list, which shows each service with its price: USPS Ground Advantage (the default), Priority Mail or Priority Mail Express.
4. Press **Buy label**. Nothing is bought without this press.
5. Press **Print label**. The PDF opens in a new tab through a link that works for five minutes and only for that label.

Once a label is bought, the order page shows the **Label** beside Ship to (service, tracking number, box and weight, and where the parcel is), then the date and price with **Print label** beside them, and **Track on USPS** and **Cancel label** below. The **Labels** table lists every label Ship made for the order, cancelled ones included.

Within a few minutes Commerce picks the label up from Ship and marks the order Completed with USPS and the tracking number, the same as when the label is bought on Ship's own page. If you press **Cancel label** before Commerce picks the label up, Commerce never gets that tracking number: the order stays as it is until you buy a new label, and only the new label completes it. A label cancelled after Commerce picked it up leaves the order Completed with the old tracking number. Pressing **Cancel label** twice, or in two tabs at once, cancels the label once. **Cancel label** cancels the label only; it does not cancel or refund the Commerce order. Payment refunds belong to the payment and order workflow.

Ship makes labels for the 50 states and DC only. An address in a US territory (Puerto Rico, the US Virgin Islands, Guam and the other islands) or a military APO, FPO or DPO address needs customs forms, which Ship does not make yet, so the order shows **Fix address**. Ship goes by the ZIP code as well as the state, so a territory or military ZIP code typed with a state's name is caught too. Hawaii and Alaska are states and get labels.

If any item has no weight in Commerce, the plugin shows its weight as **Not set** and warns you to weigh the whole package. The prefilled package weight includes only known item weights and the empty box; update it before checking prices or buying a label. If the plugin rejects the weight, correct it in the same form; it keeps the selected box and label kind. For a sandbox or live label, check prices again using the corrected weight before buying.

On Ship's own order page, **Labels** keeps the full tracking number, package, postage and **Open PDF to print** / **Cancel label** actions together. On phones each label's fields stack rather than pushing its actions offscreen. Printing reopens the label already bought; it does not buy another one.

If a label purchase's answer is lost, **Check last label** on Ship's own order page looks for the original without buying postage. If Pitney Bowes has no record, **Buy a new label** confirms only the attempt and order details Ship just checked. To see prices or switch to practice, go back to the label options first. If someone already retried, a check is still in progress, or the order or postage account changed, reopen the order and review the current details rather than reusing the old confirmation.

## Sandbox and practice labels

Ship runs on the Pitney Bowes sandbox. Live postage is not available yet. A sandbox PDF and tracking number are not postage for mailing a parcel.

| TEST-order label | Behavior |
| --- | --- |
| Pitney Bowes sandbox label | Available when the sandbox configuration is complete. Uses sandbox rates, shipment creation, PDF, and tracking; it charges no real postage. The page marks it TEST SANDBOX. If the sandbox goes offline after you open the form on Ship's own page, reopen the form to choose practice; Ship will not substitute it. |
| Practice label | Made without calling Pitney Bowes when the owner presses **Make practice label** or **Make practice label instead** on a TEST order. That choice stays practice if the sandbox becomes available before the form is submitted. The PDF says TEST - NOT POSTAGE and PRACTICE LABEL - DO NOT MAIL. |

A TEST order stays TEST everywhere and never gets live postage. A real order needs the owner's own Pitney Bowes postage account connected in **Shipping settings** (or Ship's own Settings page); until one is connected, prices and labels for real orders are refused.

Tracking updates (In transit, Out for delivery, Delivered, Problem) come from Pitney Bowes for live labels only, so they do not appear while Ship is on the sandbox.

## Integration boundary

Commerce calls three routes on the hosted service with a DinkusKit store pass scoped `ship:orders`:

| Route | Purpose |
| --- | --- |
| `POST /v1/orders` | Accept a versioned Commerce shipping record. |
| `GET /v1/labels` | Read label events awaiting acknowledgement. |
| `POST /v1/labels/ack` | Acknowledge a delivered label event. |

The plugin's Shipments and Shipping settings pages call routes under `/v1/admin/` with a pass scoped `ship:admin`. The store always comes from the signed pass, never from anything in the request. Ship accepts the current or a newer order version and never overwrites it with an older one. It keeps the US delivery address, line quantities and email; billing details and payment credentials stay out of Ship. None of these is a public, unauthenticated API.

## Sources and review scope

This article lives in the Ship repository, is reviewed with the code it describes without signing in, buying labels or buying postage, and was published from the `v{{version}}` tag:

- [Release notes](https://github.com/dinkuskit/ship/releases/tag/v{{version}}) and [changelog](https://github.com/dinkuskit/ship/blob/v{{version}}/CHANGELOG.md)
- [Repository overview](https://github.com/dinkuskit/ship/blob/v{{version}}/README.md) and [plugin manifest](https://github.com/dinkuskit/ship/blob/v{{version}}/emdash-plugin.jsonc)
- [What the Ship plugin calls](https://github.com/dinkuskit/ship/blob/v{{version}}/docs/contracts/ship-plugin-v1.md)
- [Hosted service contract](https://github.com/dinkuskit/ship/blob/v{{version}}/service/README.md)
