# EmDash sandbox host proof

Date: 2026-10-03

## Result

The reusable ignored host at
`runs/sandbox-host-20261003/host` runs EmDash `1.0.1` with the packaged
`@dinkuskit/ship@0.0.0` tarball, `@emdash-cms/sandbox-workerd@0.9.1`, and
`workerd@1.20261001.1`.

The package was installed from:

```text
runs/sandbox-host-20261003/host/.artifacts/dinkuskit-ship-0.0.0.tgz
sha256 b309e6cf8a0f127d65a45fbee57918a43a9a447b796220b31504f64ad10157da
```

The host is configured for loopback port `4343` and loads the standard-format
entrypoint `@dinkuskit/ship` through the supported workerd sandbox runner.
The host log records `Loaded sandboxed plugin dinkuskit-ship:0.0.0`.
It is currently kept ready by the user-session launchd label
`ship-sandbox-host-20261003` (current PID observed: `26557`).

Stop it with:

```sh
launchctl remove ship-sandbox-host-20261003
```

## Executed proof

```text
npm test
15 passed, 0 failed

npm run typecheck
0 errors, 0 warnings, 0 hints

EMDASH_SANDBOX_RUNNER_MODULE=file:///.../host/node_modules/@emdash-cms/sandbox-workerd/dist/sandbox/index.mjs
EMDASH_SANDBOX_HOST_URL=http://127.0.0.1:4343
npm run verify:sandbox
package_install=passed
sandbox_execution=passed
host_route=admin
settings_persistence=passed
default_commerce_data=fail-closed
host_attested_arabic_rtl=passed
```

The verification posted a settings action, reloaded settings through the
host, and checked that the persisted toggle removed the dashboard link block.
It also checked that default Orders contains no Order 1042, recipient, or
money/address fixture and that Arabic copy preserves host-attested `rtl`.

## Source changes

- `src/plugin.js`: removes the technical Commerce handoff proposal button;
  default Orders remains fail-closed, with no fake order or money/address.
- `scripts/verify-sandbox-package.mjs`: adds packaged-host persistence proof.
- `test/sandbox-plugin.test.js`: locks the absence of the proposal action.
- `runs/sandbox-host-20261003/host`: ignored reusable host source and install.

Safe source hashes:

```text
3b81e593126ddd7c2439e485b855040811857e41c71512941b42dbbc1f678999  emdash-plugin.jsonc
58fe6c055635aeed878adca7596cd1302a20dbc0b12f05b68bd62058f2e677ce  src/plugin.js
8183ee14be14927b56135c7fdc02f28976e121dad6fce54db87f66f4cfb53023  scripts/verify-sandbox-package.mjs
```

No publisher DID, security contact, signing identity, account, credential,
Commerce edit, provider request, deploy, publish, or merge was performed.
Existing proof and other checkouts were not modified.
