# Parent acceptance and corrections

2026-10-03. This supersedes the worker's acceptance claims in `PROOF.md`.
The original worker handoff remains historical evidence.

The worker completed with cleanup confirmed. Parent review found default
detail/shipping routes could still expose the synthetic order and that the
host verifier checked `blocks` on the response envelope rather than `data`.
Those defects were repaired and independently rechecked. Arabic settings field
labels were translated. The new direct-route regression failed before the fix.

## Current execution

`npm test`: 16 passed, zero failed. Script syntax checks and `git diff --check`
passed. No host typecheck is claimed as plugin execution proof.

The tracked `test-support/sandbox-host` configuration and
`scripts/prepare-sandbox-host.mjs` prepare an ignored host using the current
content-hashed npm tarball, initialize its local database with the supported
EmDash CLI, and configure the supported sandbox runner. The host runs on HTTP
loopback port 4343. A standard Node 22.23.1 runtime was used; the app-bundled
runtime could not load the native binding under macOS library validation.
No signatures or security protections were changed.

Runtime versions: EmDash 1.0.1, sandbox-workerd 0.9.1, workerd 1.20261001.1.
Development uses the runner's supported Miniflare/workerd path. The fresh host
records `Loaded sandboxed plugin dinkuskit-ship:0.0.0`. There is no native Ship
registration or direct source import in the host configuration.

Current package SHA-256:
`f2da608b4c66a0b6ba6349d88dcdf5d2e6570672c90510ecdec1870aefad497d`.
All packed files were compared byte-for-byte with the host-installed package.

The corrected `verify:sandbox` command passed:

```text
package_install=passed
host_installed_package=matched
sandbox_execution=passed
host_route=admin
settings_persistence=passed
default_commerce_data=fail-closed
host_attested_arabic_rtl=passed
```

The host rejects unregistered detail/shipping pages; direct handler tests also
ensure absent fixture selectors never expose order 1042 or recipient/money.
The persistence check reads the actual response envelope and verifies the
reloaded form toggle. English and Arabic HTTP requests use host-attested
locale/direction, not fields supplied in the action body.

## Rendered proof

Parent browser automation used the supported admin Language selector, saved
the Arabic settings toggle and reloaded the page: `aria-checked=true` persisted.
The English desktop rendered at 1299 CSS pixels with `lang=en`, `dir=ltr`.
The narrow Arabic render reported 585 CSS pixels with `lang=ar`, `dir=rtl` and
document scrollWidth 585. The requested viewport was 390; the measured width
is the actual proof size. Settings actions remained usable. Long field values
use the host's truncation/tooltips. Viewport override was reset afterward.

Selected sanitized JPEGs were stored on the separately selected asset shelf;
no binary or private asset coordinates are committed here.

| Capture | SHA-256 | Bytes |
|---|---|---:|
| English settings | 1863a9f0fcd7b043aa97b7b93c412abdec3fa46e9610e47eb0b7e3155939fdfc | 64589 |
| Arabic narrow settings | 4755bac0baa6c7c5ac419ffa42180b7d9205fe266ab72c3b644dec65741f4edb | 37548 |

Only synthetic local Dev Admin and disconnected provider status are visible;
no credentials, private tenant data, or live order appear.

## Remaining gates

This is config-managed local sandbox package proof. Signed Registry install,
publisher/security contact, publication and deployment remain unproved and
unapproved. Commerce order/address/package/authorized handoff remains absent.
Provider actions remain disabled. No provider call, credential access, purchase,
retry, account mutation or merge occurred. CI and official exact-source review
must qualify the frozen PR before the maintainer merge gate.
