# Turning on Pitney Bowes tracking updates

Ship receives Pitney Bowes's tracking updates at one address for DinkusKit's whole
developer account (GrillTrack ship-tracking-001). PB turns the webhook on by hand:
the developer contacts PB with the address and the credentials PB should send with
each update. These are the steps for Ronald; nothing here runs on its own.

## 1. Make the credentials

Pick a username (for example `dinkus-ship`) and a long random password (32 or more
characters, for example from 1Password). Set them on the Ship Worker, from the
`service` folder on the Mac, one at a time, and keep them in 1Password:

```
npx wrangler secret put PB_TRACKING_USER --name dinkus-ship
npx wrangler secret put PB_TRACKING_PASSWORD --name dinkus-ship
```

Each command asks for the value on its own line; nothing goes in this repository
or in a chat. Setting a secret deploys a new Worker version with the same code.

## 2. Ask Pitney Bowes

Send PB (the developer support contact in the Developer Hub, or the same thread as
the pending fee question) this, with the real username and password filled in:

> Subject: Tracking webhook for developer ID <DinkusKit's PB developer ID>
>
> Please enable tracking event notifications (the Tracking Webhook) for our developer
> account <developer ID>, for all merchants under it, in the sandbox and in production.
>
> Webhook URL: https://ship.dinkuskit.com/v1/tracking/pitney
> Authentication: HTTP Basic
> Username: <PB_TRACKING_USER>
> Password: <PB_TRACKING_PASSWORD>
>
> Our endpoint answers 200 with a per-event `responses` list and echoes
> `X-PB-ReferenceId`. Please also confirm whether there is any charge for the
> webhook or for the Track a Parcel API.

PB's webhook page says each POST carries `Authorization`, `Content-Type` and
`X-PB-ReferenceId`, with `{ "trackingEvents": [...] }` in the body, and that PB
retries any non-2xx answer at 1m, 5m, 10m, 30m, 1h, 2h, 4h, 8h and 16h.

## 3. What to expect

Sandbox labels never get tracking events ("Tracking is available for Production
labels only"), so nothing shows on a TEST order. The first proof is a real label on
Ronald's own store with production postage: its order page on Ship and the
plugin's Shipping page move from "Label bought" to "In transit", "Out for delivery"
and "Delivered" (or "Problem" with the carrier's reason). The daily check at
14:00 UTC asks PB about any live label not yet delivered, so a missed update still
shows within a day.
