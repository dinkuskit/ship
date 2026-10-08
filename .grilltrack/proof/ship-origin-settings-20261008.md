# Ship origin settings proof

Approved slice: one merchant-managed U.S. ship-from address per installed store.
Starting main: `221546bc90af48c68e465b7112a6f26a11197f55`.
Owner: sidebar `01a11b32-922c-7430-9eb0-99a763b8f0ee`.
Branch: `codex/ship-origin-settings-20261008`.

The coordinator confirmed sole ownership and GitHub had no open Ship PR before
mutation. One Cursor ACP job, `97af02be-8f8b-4cc9-b644-a63d67b5ee87`, used the
advertised Luna Medium model and authorized `approve-all` mode. It completed
with observed cleanup before the owner took over validation repairs and proof.

The standard sandbox entry stores the origin separately from dashboard
preferences. All address reads and writes require the existing admin permission.
Status returns only the existing preference projection and disabled-provider
state. The retained native entry remains historical and unexported.

Validation checks required single-line text, explicit U.S. country, recognized
U.S. postal regions, ZIP structure, field types and a 100-character field limit.
It rejects invalid optional fields instead of silently discarding them. Region
codes follow [USPS Publication 28 Appendix B](https://pe.usps.com/text/pub28/28apb.htm);
this does not establish address deliverability, service eligibility or provider
verification. Stored records survive rejected submissions.

## Observed verification

- Supported Node `22.23.1`: `bin/verify-ship full` passed, 33 tests, zero failures,
  with the distributable package dry-run.
- Actual disposable EmDash `1.2.0` and sandbox-workerd `0.9.3` host on loopback:
  fresh tarball and every installed package file matched byte for byte.
- Installed admin create, edit and reload persisted the complete record.
  Invalid region submission preserved that record and display preferences.
- Unauthenticated private routes denied access. Admin returned HTTP 401.
- With `EMDASH_SANDBOX_PERMISSION_PROOF=1`, the synthetic user's reduced role
  received HTTP 403 on admin, settings and status. The verifier restored its
  role and confirmed that denied writes had not changed the saved origin.
- Status omitted origin fields and values. Provider state remained disabled.
- English fallback and host-attested Arabic RTL passed through the real dispatcher.
- Browser edit/save/reload passed. A mobile invalid submission showed an error;
  reload restored the saved ZIP and normalized region. Fields and save controls
  remained usable with vertical scrolling at the observed 480 CSS-pixel width.
  Captures used fictional data and are not committed. A privacy-safe empty-form
  capture also confirmed the mobile controls.

Runtime transcripts live outside this checkout in the owning task directory.
They contain fixed result markers, package hashes and no address/session values.
Exact commit review, CI and native receipts are retained there after committing.

## Limits

The in-app browser clamped narrower viewport requests to 480 CSS pixels.
Smaller phone widths and physical devices were not proved. The bundled OpenClaw
Node runtime crashed in an existing HTTP test; the supported Node runtime passed.
The first installed comparison used cached sandbox bytes and failed; restarting
the task-owned host and rerunning with matched fresh bytes passed.

No provider connection, credentials, network grants, quotes, purchases, Commerce
order binding, Registry release, deployment or upstream EmDash changes occurred.
Saving the origin does not imply provider readiness. Merchant-funded postage
and extra-fee preferences are recorded; subsidy amounts remain unapproved.
Historical unrelated ledger decisions still requiring verification remain open.
