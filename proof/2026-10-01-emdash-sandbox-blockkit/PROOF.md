# Packaged EmDash sandbox BlockKit proof

Date: 2026-10-01

## Bounded implementation

This slice adds a real sandbox-format package entry in `src/plugin.js`.
It returns plain Block Kit JSON and has no React, Kumo, or host-runtime
imports. The manifest declares the plugin-owned `preferences` collection.
`Orders → Order #1042 → Make a postage label` remains synthetic and
read-only. Ship settings expose a display-only dashboard-link preference;
the admin form persists it through `ctx.storage.preferences`. Paid Commerce
totals remain immutable and separate from merchant-funded postage. Inventory
is explicitly optional. No provider lookup, create, retry, credential, or
transaction action exists in this slice.

The route consumes `routeCtx.ui.locale` and `routeCtx.ui.direction` as
host-attested values. English and Arabic copy are provided; unknown locales
fall back to English without inferring or changing the host direction.

## Upstream/runtime facts

Inspected installed EmDash `1.0.1` source and pinned upstream guidance at
`0e8977c22`:

- `SandboxRunner` is a platform adapter interface; `NoopSandboxRunner` is
  unavailable on Node and explicitly requires a real runner adapter.
- sandbox route context supplies `ui`, while plugin context supplies
  `storage`, `settings`, and `kv`.
- manifest storage entries require `indexes` arrays.
- pinned guidance requires Kumo/Lingui for authored native React UI; this
  sandbox JSON entry imports neither.
- pinned guidance requires publisher and security contact for Registry
  publication. Those remain human inputs and are intentionally absent.

Installed runner identity:

```text
package=emdash
version=1.0.1
runner=NoopSandboxRunner
available=false
healthy=false
reason=no adapter configured
```

## Executable verification

```text
npm test
14 passed, 0 failed

node --check src/plugin.js
PASS

node --check scripts/verify-sandbox-package.mjs
PASS

git diff --check
PASS
```

The package gate runs `npm pack`, installs the resulting tarball into a
fresh temporary package with `npm install --ignore-scripts --no-save`, and
imports the installed sandbox entry. It then fails closed unless
`EMDASH_SANDBOX_RUNNER_MODULE` names a module exporting
`createSandboxRunner`:

```text
npm run verify:sandbox
SANDBOX_GATE=blocked
reason=EmDash 1.0.1 Node host exposes only NoopSandboxRunner
required=EMDASH_SANDBOX_RUNNER_MODULE exporting createSandboxRunner
package_install=passed
sandbox_execution=not_claimed
exit=2
```

This is an executable gate, not sandbox execution proof. No in-process
adapter, native wrapper, or fake runner is used.

## Private package identity

The locally packed artifact was `dinkuskit-ship-0.0.0.tgz`.

```text
sha256 742ad0a17a1fd2832a096422d3225c81b244975ea9f129957bfcbb492d2a0084
```

The pack contained 12 files, including `emdash-plugin.jsonc`,
`src/plugin.js`, and the existing native entry. This package was not
submitted, published, released, listed, or deployed.

## Remaining gates

- Supply an approved real publisher DID and monitored security contact
  before manifest validation for Registry release.
- Configure an actual supported EmDash sandbox runner and host database
  options before claiming sandbox execution.
- Obtain a trusted Core/Commerce order/action seam before replacing the
  synthetic order.
- Keep provider/account/credential and real-transaction work outside this
  slice.
