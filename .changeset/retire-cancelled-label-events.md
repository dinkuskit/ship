---
"@dinkuskit/ship": patch
---

Retire unacknowledged `label_events` rows when a label is cancelled so Commerce never marks an order shipped with a voided tracking number, and enforce explicit `LABEL_STATE_TRANSITIONS` and `PURCHASE_STATE_TRANSITIONS` tables in the Ship service store.
