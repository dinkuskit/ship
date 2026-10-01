# Scoped PB sandbox interface decision

Status: implementation scope only; not a product-shape lock.
Date: 2026-09-30
Owner: Ship PB sandbox interface slice

## Exception

For this local, loopback-only experiment, the charter's prohibition on
implementing a shipping kernel is explicitly overridden only enough to exercise
an unconfigured-by-default Pitney Bowes USPS sandbox adapter and merchant-lab
UI. This does not select a provider for Ship, establish a production contract,
or change the charter's unresolved product-shape questions.

The production status remains unresolved. No production endpoint, production
credential, postage purchase, funding, deployment, release, or account
mutation is in scope.

## Confirmed bounded slice

- Synthetic domestic US shipment with a positive decimal weight and dimensions.
- USPS Priority Mail (`PM`) and rectangular parcel (`PKG`) only.
- Server-only OAuth and rate/shipment calls against fixed PB sandbox origins.
- Explicit quote review showing service and price before a clearly labelled
  `Create test label` action.
- View/download of a PB sandbox PDF only when its document URL passes the
  server-side safety checks.
- Local task state protects quote fingerprints, expiration, idempotency, and
  unknown create outcomes across reloads.
- Browser requests never receive credentials, tokens, raw provider responses, or
  provider error payloads.
- Fake transport tests cover deterministic failure and retry contracts. They do
  not claim live API proof.
- The future Ship surface exposes only a read-only Commerce projection of
  order destination and package data, operation statuses (`pending`, `unknown`,
  `label_created`), and a local test-PDF reference. It is not an order or
  Commerce mutation contract.

## Explicit exclusions

Inventory, Commerce mutation, payment, purchase/funding, production labels,
carrier selection, provider routing, live credentials, custom origins,
redirects, deployment, npm release, and merge remain excluded. A focused source
review may be performed against this bounded repair; no deployment or merge is
implied.
Sample PDF evidence and test fixtures remain distinct from live API results.

## Reconciliation

The pending Ship PR2 contract and ledger were inspected read-only. This record
is source-linked scope for this isolated implementation, not a replacement or
second canonical ledger. Before any product decision, merge, or promotion, the
owner must reconcile this experiment's exception and operation semantics with
the active PR2 ledger and preserve the unresolved charter status.
