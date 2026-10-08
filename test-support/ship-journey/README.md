# Installed Ship proof

The helper packs Ship with lifecycle scripts disabled, installs the tarball,
resolves advertised exports, and compares every installed file with the fresh
artifact. It prepares a disposable pinned EmDash1.2.0 / Astro7.3.2 / workerd host.

```sh
node --test test/ship-journey/installed-package.test.js
node scripts/verify-ship-journey.mjs --setup
node scripts/verify-ship-journey.mjs --workerd
```

`--setup` explicitly runs the host dependency install and database initialization.
Ordinary tests skip this install and the workerd journey. The default verifier
exits2 with `JOURNEY_GATE=blocked` even when package checks pass.

Use an ordinary development Node22.16+ runtime and prepend its directory to
`PATH` for npm and host children. App-bundled Node may enforce macOS library
validation and reject correctly installed native dependencies with different
Team IDs. Do not modify binaries or disable security checks. The host sets
`ASTRO_DEV_BACKGROUND=0` so its server and workerd children remain owned by the
invoking process. Cleanup covers only directories created by that process.

`--workerd` bundles a test-only entry that consumes the packed `installed` and
`workflow` exports. It drives real private EmDash HTTP dispatch and the official
workerd runner, with explicit diagnostic request headers. The tests cover
canonical `order:<UUID>` identities, trusted minor-unit totals including zero,
quote/confirmation, simultaneous buys, retry identity, stale quote invalidation,
unknown outcomes, original-transaction recovery, raw PDF bytes, private response
headers, real EmDash storage limits, chunk corruption/missing records, restart
reuse, role denials, and a distinct print-request record.

The order and authority ports are synthetic. The injected store calls the real
EmDash `ctx.storage.operations.getVersioned` and `compareAndSet` bridge in the
disposable SQLite host. Operation records, PDF manifests and chunks use actual
conditional writes; the1MiB CAS serialization limit is checked against the host.
This is installed local storage evidence, not an established production binding.
Provider-port outcomes are normalized
fixtures, not a proof of PB HTTP classification. Every provider/CAS URL is
intercepted under `https://1.1.1.1`, with no live fallback. This literal is a transport sentinel,
not a contacted service: pinned EmDash validates targets before its injected
fetch hook and bypasses DNS only for public IP literals. The original `.invalid`
sentinel failed that preflight. The fixture retains host/capability validation;
it does not grant unrestricted network access. No
credentials, live provider requests or Registry operation are involved.

Logs are retained under `runs/ship-journey-runs/20261008/`. A passing workerd run
reports `FIXTURE_JOURNEY_GATE=passed` while keeping `JOURNEY_GATE=blocked` for
unbound production ports and the browser asset mediator. The packaged default
factory's absent-port denial is checked separately. Fixture ports remain outside
the production package and are never a production selector.

Admin route diagnostics can show packaged form/state output. Ordinary browser
PDF view/download/print needs an authenticated host mediator that is not supplied
here. A diagnostic Node request with `X-EmDash-Request` cannot clear that browser
requirement. No physical printing, delivery, production tenant/order/CAS, real
Commerce handoff, provider integration, deployment or Registry acceptance is
claimed.

For a manual visible form check, start the same disposable host and open the
printed local URL in a browser. It creates only synthetic test data. Stop it
with Ctrl-C; it then cleans up its own directory.

```sh
node test-support/ship-journey/preview.mjs
```
