# EmDash sandbox BlockKit slice

Status: bounded local implementation complete; runner gate remains blocked.

- Branch: `codex/ship-registry-sandbox-20261001`
- Starting HEAD: `9c4f44cbfda3c321ca86feebc640d326c2b549d8`
- EmDash runtime inspected: `1.0.1`
- Runtime: pinned Node `22.23.1`
- Package: private `@dinkuskit/ship@0.0.0`
- Scope: packaged sandbox-format entry, BlockKit admin flow, supported storage persistence,
  host-attested locale/direction handling, and truthful runner gate.
- Exclusions: native UI proof, Registry submission/listing, publisher/contact identity,
  Commerce integration, provider/account/credentials, deploy, release, push, and PR.

The runner gate is intentionally unresolved because the installed Node host exposes
`NoopSandboxRunner`; no local isolate execution is claimed.
