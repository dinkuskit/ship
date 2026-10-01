# PB consumer and unknown-outcome gate packet

Date: 2026-10-01
Scope: value-free first-slice handoff only.

## Sanitized consumer result

The only supplied consumer result is retained verbatim as a shape-safe receipt:

```json
{
  "result": "no_matching_report_entry",
  "returned": {
    "transaction": 1,
    "merchant": 1,
    "postage_print": 0,
    "valid_shipment": 0
  },
  "matched": false
}
```

This does not identify a provider account, transaction, merchant, shipment,
label, amount, credential, endpoint, or report payload. It proves neither
provider availability nor a successful purchase or print.

## Unknown-operation gate

- Original outcome: `purchase_unknown`.
- Reconciliation result: `no_matching_report_entry`.
- Retry: not performed.
- New idempotency key: remains blocked.
- Existing operation: remains unresolved and must not be converted to
  `label_created`, `dispatched`, or `print_confirmed`.
- No wrapper was found. This is a human setup gate, not a generic operation
  failure.

The next permitted step is a separately authorized provider-specific
reconciliation using the approved wrapper. Until that gate produces a
sanitized receipt, no second purchase attempt is allowed.

## Explicit non-claims

No live PB request, provider response, account lookup, label PDF, postage
purchase, physical print, Registry install, native page, admin UI, or
Commerce runtime hook was exercised by this packet.
