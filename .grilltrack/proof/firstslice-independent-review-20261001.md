# Firstslice independent review and adjudication

Date: 2026-10-01

## Review identity

- Reviewed source: `git:938908e2fecca4b335a0f70460d489d2b9eedde5`
- Review mode: delegated read-only defect-first inspection, followed by
  source-bound adjudication.
- Corrective review scope: the exact current proof artifacts after the
  provenance correction; the corrective result remains `findings`.
- Prior `clean` record: `.grilltrack/proof/emdash-plugin-slice-20261001.md`
  is treated as an additive local claim only; it is not independent review
  evidence and is not used as this review's verdict.
- Primary pinned sources:
  - https://docs.emdashcms.com/plugins/creating-plugins/manifest/
  - https://docs.emdashcms.com/plugins/creating-plugins/api-routes/
  - https://docs.emdashcms.com/plugins/creating-native-plugins/distributing/

## Findings and adjudication

| Finding | Review result | Classification | Adjudication |
| --- | --- | --- | --- |
| The manifest omits required `publisher` metadata. | Accepted | `human_gate` | No publisher DID is known or authorized. Do not invent one. Registry validation/release remains blocked until the owner supplies the approved identity. |
| `security@dinkuskit.invalid` is a placeholder, not a usable security contact. | Accepted | `human_gate` | Keep the local scaffold blocked. Replace it only with an owner-approved monitored contact before distribution or publication. |
| The delegated pass reported Markdown trailing whitespace. | Accepted and repaired | `reject_false_positive` after repair | The two intentional Markdown line-break spaces were removed. Final `git diff --check` is clean. |
| The handoff incorrectly labeled Ship commit `8147f626aa391937b41e2b576d34a555c4349ffe` as Commerce source and bound it to an actual Commerce interface. | Accepted and corrected | `required_fix` | That SHA is a Ship contract-source commit (`docs: bind handoff to corrected source`), not a Commerce implementation commit. No Commerce implementation was inspected or bound. Parent Commerce `HEAD` `51ab023b14490e3bff821e5310dd1c323092df30` is context only; the actual Core mount seam remains unverified and not ready for routing. |

## Manifest and route inspection

The manifest has slug `ship`, empty capabilities, empty allowed hosts, and
empty storage. The route declarations are private POST/JSON routes with a
1 MiB request limit. `admin` and `settings` require `plugins:manage`;
`status` requires `plugins:read`. The handler receives the documented
two-argument sandbox shape and reads `ctx.plugin.id` and `ctx.plugin.version`.
The added test exercises that host-shaped context rather than only passing an
empty placeholder context.

The pinned manifest source makes `publisher` required. Therefore the local
manifest is intentionally scaffold-partial and schema-invalid for Registry
release until the human identity/contact gates are resolved. The route shape
is compatible with the pinned API-route source; this does not prove a runner.

## Explicit scope boundary

No native page, admin UI, EmDash host, Registry runner, Registry install,
publisher identity, release, provider request, provider success, physical
print, Commerce implementation inspection, or Commerce runtime hook exists or
was proven. The actual Core mount seam is unverified and not ready for routing.
This is a partial private package scaffold, not a completed milestone.

The PB packet records only:

```text
no_matching_report_entry
returned=1
transaction_matches=1
merchant_matches=1
postage_print_matches=0
valid_shipment_matches=0
matched=false
```

The original `purchase_unknown` remains unresolved; no retry or new
idempotency key is allowed. Missing wrapper evidence is a human gate, not a
generic operation failure. The Commerce packet is read-only and preserves
unknown order identity, revision, delivery snapshot, money, caller, and
postage permission.

## Verification

- `npm test`: 9 passing.
- `npm pack --dry-run --json`: succeeds; local package contains 10 files.
- `git diff --check`: clean.
- No EmDash CLI was available locally; no Registry validation or runner proof
  is claimed.

## Final artifact hashes

- `emdash-plugin.jsonc`: `cab305d8c9aeedbf7cfc7ec2d5a2ff9dc8bbeae2d2872cbc21400397c5062ddf`
- `src/plugin.js`: `3672dab45e887b1a5f334dc077f40fd4e2f3ef69a19960363206e95093e97bec`
- `test/pb-sandbox.test.js`: `2985e814163d7029cf663dcc8139553dbfd518a4e3c3cbdfa344eaa2d6e39875`
- `src/commerce-status.js`: `1128c02cc9a0d2a77e7b2c46b1bb1e559af6aa7c73a1ad4d37ee4de79f0aaaaf`
- `docs/contracts/commerce-ship-v1.md`: `200e0ce52e66fabf9f2bd10f3dc5b5a4fce0a945b678bb3c7e60a2429adf7b32`
- `.grilltrack/proof/commerce-handoff-20261001.md`: `40b2afa2a5b9bd82ac56e6227e6697d7971aeee3bd72b0df60ac42bb1d3ea4d5`
- `.grilltrack/proof/pb-consumer-unknown-gate-20261001.md`: `928385561be41d9e01ccb68f3469429e49ceb9ecbd3ff26fb0aa77394573f3aa`

## Finite first-slice stop

The finite first slice stops at the partial scaffold. Remaining gates are
publisher identity, monitored contact, native host, Registry, PB, and the
actual Commerce mount seam. No Commerce implementation is claimed ready for
routing. No source/runtime changes, deeper tests, new milestone, PR, push,
secret/provider operation, or Commerce write is included.
