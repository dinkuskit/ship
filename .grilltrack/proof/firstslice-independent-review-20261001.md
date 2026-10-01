# Firstslice independent review and adjudication

Date: 2026-10-01

## Review identity

- Reviewed source: `git:938908e2fecca4b335a0f70460d489d2b9eedde5`
- Review mode: delegated read-only defect-first inspection, followed by
  source-bound adjudication.
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
| The handoff source binding was described as current repository HEAD. | Rejected as a final defect | `reject_false_positive` | The packet now explicitly distinguishes the immutable Commerce source snapshot `8147f626aa391937b41e2b576d34a555c4349ffe` from later proof-only commits. |

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
print, or Commerce runtime hook exists or was proven. This is a partial
private package scaffold, not a completed milestone.

The PB packet records only:

```text
no_matching_report_entry
transaction=1
merchant=1
postage_print=0
valid_shipment=0
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
- `.grilltrack/proof/commerce-handoff-20261001.md`: `ec4ab3aa1ca82eabab5573b37d593dce4caf5635d354cdee1f51725940d79693`
- `.grilltrack/proof/pb-consumer-unknown-gate-20261001.md`: `a7771a0966896ff24a458abd85f0e992e1c8a7d51b7a1697efb51095968de0ae`
