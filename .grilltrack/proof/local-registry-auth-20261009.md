# Local Registry installation and normal-session qualification

Base: `77d22efdc90594981ef9b5e71983c9abadb8df0c` (Ship PR #19).
Branch: `codex/ship-local-registry-auth`. This follow-up changes only the test
harness, its dependencies and proof. Ship runtime source is unchanged.

## Executed evidence

`npm run verify:local-registry-auth` runs a fresh database and the published,
unmodified EmDash package with the standard workerd sandbox. The official
plugin CLI builds the existing provider-link fixture; no prototype PDF host
code or seeded `_plugin_state` is used.

- Node v22.23.3; EmDash 1.2.0; sandbox-workerd 0.9.3;
  workerd 1.20261001.1; plugin CLI 0.13.3; Playwright 1.64.0.
- Artifact: 3500 bytes, SHA-256 `0553c4cdfa60530685b32f11eeaf8dd4cecf882973727856f7d2ed3cf5961496`.
- Chromium virtual WebAuthn creates a passkey through the ordinary setup wizard,
  then logs in through the ordinary passkey screen. The normal first-login
  welcome dialog is dismissed. No dev-bypass session is used.
- Registry UI verification: **200**. Capability consent followed by install:
  **201**. Installed source is `registry`, ID `r_qe232lamzwtmextd`.
- The authenticated page renders **View label** with `_blank` and
  `noopener noreferrer`. After synthetic expiry, no label link remains and the
  page displays the unavailable/expired message.
- After logout, the private fixture route returns **401**.
- The browser permits only the two owned loopback origins. No external request
  was attempted, and the inert PB-shaped link was never opened. The sandbox
  fixture declares no allowed network hosts.
- `npm test`: **86 passed**, **3 existing opt-in skips**. Syntax and diff checks pass.

The ignored run contains the machine-readable receipt and screenshots at
`runs/local-registry-auth-runs/run-CrveAf/`. Parent inspected visible and expired
screenshots. Earlier failed receipts are retained as debugging history; they
are not qualification passes. ACP supplied the first harness candidate; the
parent corrected fixture multihash and profile metadata, host Registry config,
normal login/welcome navigation, request bounds, cleanup and evidence handling.

## Meaning and limits

This is **local Registry conformance and installation**, using EmDash's
published `internal/testing/registry` authoritative-record hook. The hook
substitutes local profile/release records; the real verify/consent/install path
validates their structure and the downloaded artifact checksum. The local
fixture policy makes provenance optional. It does not establish live PDS
retrieval, cryptographic publisher provenance, public Registry publication,
a physical passkey, or production trust configuration.

It closes the previous local installation/ordinary-session gap for the provider
fixture. The default Ship artifact still requires trusted host bindings. Live
PB retrieval, redirects, copied-link privacy, PDF integrity and provider-side
expiry remain unqualified. No live postage, provider call, public publication,
deployment or merge was performed.

## Review cycle 1 adjudication

Comprehensive exact-tuple OpenClaw review at `b5b515101bc20073c036eea7fd89d77c27499397`
returned one P2 finding, accepted: a blocked non-PB external request could still
produce a passing receipt. The runner now requires the complete blocked-request
list to be empty. The normal install/auth flow passes with zero blocked requests.
The follow-up review must cover this correction before closeout.
