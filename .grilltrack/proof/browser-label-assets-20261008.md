# Native browser access to stored Ship labels

## Authorized slice and provenance

Provide an optional native Astro adapter for an authenticated host to expose already-stored, operation-bound PDFs. Its GET path checks actual host user, permissions, token scope, enabled installation and private-route metadata before trusted dispatch. The default plugin remains unavailable without genuine injected authority. Browser actions do not purchase postage, reconcile a purchase or fetch bytes from a provider.

The candidate was produced by the existing runtime implementation owner. The independent proof owner copied the ten explicitly selected files byte-for-byte, compared two complete snapshot passes, and made no runtime or harness changes. Packaging retains that source exactly. Baseline: `b822093466b0c021b149795a05b0751004f6bb0f`. Candidate content identity: `7beca5d4e8a3d8520ad37b220c81efd03a27f268db780fb118e68b6485182ce5`.

## Independent verification

- Full repository verification: 80 passed, three explicit host/workerd/browser-host opt-in skips, plus package dry run passed.
- Focused adapter tests: 8 passed, no skips.
- Explicit installed native-host test: 1 passed, no skips. Fresh tarball installed into disposable EmDash 1.2.0 with actual native Astro locals/session and private workerd dispatch. Logged-out, reduced-role, wrong-tenant, wrong-order/operation and forged-field denials passed. Download response is private, no-store, nosniff and attachment; exact bytes matched stored output.
- Ordinary Chrome browser: fixture dev session, no global request headers or browser protection changes. View label clicked and synthetic one-page PDF visibly rendered. Download label clicked and its actual download event yielded 700000 bytes with SHA256 `bdbd0f8c677d3875e5f5927a1e770cba97c60638dd4710d7dcf4732b000623ed`, identical to the stored PDF.
- Print attempt explicitly clicked. Subsequent accessibility state and screenshot show the rendered PDF and the status that a print attempt was sent to the browser. No print dialog was captured; physical printing and delivery are not confirmed.
- Provider counters stayed at one create, one PDF fetch and zero reconciles across all browser actions.
- Initial browser-proof tarball SHA256: `7790acdfcf480e6b37becf1059571fb1d74334c775963998226de8bab1241f01`.
- Only owned tabs and disposable host were cleaned. Host directory was absent and host unreachable after awaited cleanup. No runtime-owner processes were touched.

Reproduction: `node --test test/host-label-assets.test.js`; `SHIP_BROWSER_HOST_PROOF=1 node test/ship-browser/installed.test.js`; run `node test-support/ship-browser/preview.mjs` with open stdin for the manual browser flow. Use an ordinary supported Node executable. The preview produces only synthetic artifacts. Raw logs, screenshots, download and counter receipts are retained in the ignored local `runs/ship-browser-runs/20261008/` packet.

## Fidelity limits and exclusions

The in-app browser reported loaded but rendered a blank PDF frame, so it does not support the visible-view claim; Chrome supplies that evidence. A separate stale-operation navigation in Chrome was blocked with `ERR_BLOCKED_BY_CLIENT`. No protection was bypassed, and that browser state is not attributed to the server. The denial is independently established by installed HTTP testing.

There is no print-dialog, physical-print, delivery, live-provider, paid production Commerce integration, deployment or Registry-installability claim. Production order provenance, authority and mounting remain external gates. No confirmed runtime defect or harness repair was needed during independent proof. Reviews are advisory; final PR tuple qualification is retained separately and merge requires human authorization.

## Selected source fingerprints

- `package.json`: `dc218dfdb76ab040d78be84a04f314ef6aa4b9aaa85abf436799da585ca10ed5`
- `src/host-label-assets.js`: `7abcf650aac795ce9044c60f23cdda40b2ddef344d74dce7992332c237c5af20`
- `src/installed-workflow.js`: `d61d0ede1cd0783d831da04a6d76fb1444619b58cf03f6c3e1e95f3894d9e9d2`
- `test-support/ship-browser/host.mjs`: `418811ac4f4dc668341ef2b326149b2fd5916609ff49b1102fbec5a12c05d643`
- `test-support/ship-browser/prepare.mjs`: `32f63ff3d81a5e6cb61ab544de1d8ae14a3019226363683eea3b1d6291d05104`
- `test-support/ship-browser/preview.mjs`: `715b2bab164afa593779df81021dbca04d6ab4d9af4f75dfb3ad741b356cd85c`
- `test-support/ship-journey/host.mjs`: `525ccdcb6f2d5669f8cc790617b9d7480163f4cb52576903b336932db40c0b44`
- `test-support/ship-journey/runner.mjs`: `7c501a73579d77fab2a4a3287545c1f29099d970335bf8a305046e3d4eebb4cb`
- `test/host-label-assets.test.js`: `62846bd1d886705b9de655a4ff73319f83f08ebd1090c7b06584c3db7b4af9d8`
- `test/ship-browser/installed.test.js`: `6df6f050221532dbdb95df64d1d3f3d14069bd6b97b0bf618e955282b27bb3d7`

## Source review

Independent canonical Codex P0-P3 review completed scoped-clean for `git:4ca4bcc8fbffd611b41e83144d135a73bd4dd526`: no actionable findings or required runtime fixes. Standards and source intent were reviewed, including host authority, stored-only operation binding and fixture/print-attempt exclusions. This was static review; raw local artifacts and unchanged workflow internals were not executed by that reviewer. Independent runtime/browser proof above supplies separate evidence. Final source and native publication receipts are qualified against the final PR tuple before the human merge gate.

## Native documentation finding and repair

Native review of `git:604c117ff41c582fbc9359f00c4197ba4d5ef38c` published one actionable P2: the installed-workflow contract still said browser label access was unavailable. Accepted as `required_fix`; its related merge-risk and next-step checklist entries describe the same documentation gap. No runtime or security finding was reported. The contract now documents the optional native mount, actual host policy checks, link binding, stored-only dispatch, response behavior and fixture limits. README status is aligned.

All ten selected source fingerprints above remain unchanged. After the documentation repair, full verification again passed 80 tests with three explicit opt-in skips and package dry run; the explicit installed browser-host test again passed 1/1. The refreshed documentation-package SHA256 is `fce1950870e7b80f82166d8a1eb6f5b3c36481ce9a518b3ac7a508d95375567f`; stored PDF bytes and digest are unchanged. README is included in the package, which explains the tarball identity change. Visible browser evidence belongs to the initial package and the identical runtime source; the refreshed package received fresh installed HTTP testing, not a repeated visible click run. Final canonical and native re-review remain required before qualification.
