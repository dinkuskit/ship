---
---

Guard Pitney Bowes shipment label parsing in the hosted service against non-object entries in `documents` so malformed 2xx responses preserve `PitneyError("unknown")` reconciliation rows. Hosted service only; nothing in the plugin package changes.
