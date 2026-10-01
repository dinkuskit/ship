# Ship native admin UI proof — 2026-10-01

## Scope

One bounded local package/native admin proof slice on branch
`codex/ship-registry-sandbox-20261001`, starting at `2180d0f`.
No Commerce, Registry, provider, account, secret store, Inventory, deploy,
publication, push, merge, email, or external mutation was performed.

The committed Commerce `HEAD` (`51ab023`) was inspected read-only. It contains
catalog/inventory admin source, but no committed order-detail or paid-total
runtime seam. Commerce binding is therefore **UNVERIFIED**. The native UI uses
a visibly synthetic `Order #1042`; it does not read Commerce.

## Implementation

- `src/native/index.ts` — native EmDash plugin manifest, `plugins:manage`
  admin route, Orders and Ship settings pages, display-only settings schema.
- `src/native/admin.ts` — supported Block Kit rendering for
  Orders → `Order #1042` → `Make a postage label` → Ship review, plus settings.
- `emdash-plugin.jsonc` — no publisher DID and no invented security contact;
  package remains private and non-publishable.
- `runs/native-admin-ui-proof-20261001/host/` — ignored local Astro host
  harness mounting the tracked plugin source.

The UI keeps paid Commerce totals immutable and separate from merchant-funded
postage, marks provider status disabled/unconnected, does not require
Inventory, and offers no quote, buy, retry, PDF, print, or provider mutation.
Dashboard links are reference links only.

## Upstream/source inspection

The local host was pinned to EmDash `1.0.1`, Astro `7.3.2`, React `19.2.0`,
`@astrojs/react` `6.0.5`, `@astrojs/node` `11.1.6`, and TypeScript `6.0.3`.
The supported upstream source surfaces inspected were `definePlugin`,
`admin.pages`, `admin.settingsSchema`, native plugin routes, and
`@emdash-cms/blocks` `blocks`/`elements` APIs from the installed EmDash
1.0.1 host dependency.

Interface source hashes at proof time:

```text
7745b5e0db326316adb7e4e3fb3c721e0fcb948717427260af0a671c1633e8b3  src/native/index.ts
1bad7055ceefe5013b6dfe7d57d510127457f8a2edab4cd3acc5fbf71c7ec8e5  src/native/admin.ts
90088c8b3e82bbb2d8a1f8e012cc6fdce19dcd11183647522819def43832abbd  emdash-plugin.jsonc
9148d9a9b2ede0d219af976a5f85113663c40ab2fc23f1bb89b4b2d709d541fc  runs/native-admin-ui-proof-20261001/host/package.json
02969e100c0dc22e739386e4dc68de2ba2d7156bd2eff094d515529772981595  runs/native-admin-ui-proof-20261001/host/astro.config.mjs
e29e60688274e769942477f84b7a740e632ef43a81a345251af22e1ff133a4e1  runs/native-admin-ui-proof-20261001/host/src/plugin.ts
```

## Commands and results

Exact package test:

```text
npm test
9 tests passed, 0 failed
```

Exact native host install:

```text
cd runs/native-admin-ui-proof-20261001/host
env PATH="/Users/bobbybones/.local/share/mise/installs/node/22.23.1/bin:/usr/local/bin:/usr/bin:/bin" \
  /Users/bobbybones/.local/share/mise/installs/node/22.23.1/bin/npm install --ignore-scripts
```

The first npm invocation under Node 24 exposed the known macOS native binding
Team ID mismatch; verification was rerun with the pinned project-supported
Node `22.23.1`.

Exact host verification:

```text
cd runs/native-admin-ui-proof-20261001/host
env PATH="/Users/bobbybones/.local/share/mise/installs/node/22.23.1/bin:/usr/local/bin:/usr/bin:/bin" \
  npm run typecheck
EmDash v1.0.1
Result (0 files):
- 0 errors
- 0 warnings
- 0 hints
```

The managed local host rendered successfully at:

```text
http://127.0.0.1:4337/_emdash/admin/plugins/dinkuskit-ship/orders
http://127.0.0.1:4337/_emdash/admin/plugins/dinkuskit-ship/settings
```

The dev-bypass boot returned HTTP 200; authenticated admin and both native
routes returned HTTP 200 after redirect. No browser automation tool was
available in this session, so no screenshot is claimed. The loopback URL is
left as the parent CUA screenshot handoff.

## Remaining truthful gates

- Commerce must provide and authorize a real trusted immutable order snapshot,
  action permission, recipient consent, and paid-total seam; current status:
  **UNVERIFIED**.
- Publisher DID, real security contact, Registry submission/release/publication,
  and a Registry runner install remain human/project gates.
- Provider/account selection, credential binding, postage funding, quote/buy,
  label retrieval, print proof, and production host deployment remain outside
  this slice.

## Package/install repair

The initial host harness did not prove a package install: its plugin entry
re-exported an ancestor-relative source file and the package had no native
export. The repair adds `@dinkuskit/ship/native` → `./src/native/index.ts` and
changes the host entry to import that installed package export. The host’s
ancestor filesystem allowance was removed.

The supported local tarball was `dinkuskit-ship-0.0.0.tgz`, installed with
`npm install --ignore-scripts --no-save`. Its SHA-256 is
`b6877585b7b05e9aca5d16c15cb8aefc6ab8fb49f9913d1c95713d357dc70dee`.
The installed package is `@dinkuskit/ship@0.0.0`; EmDash is `1.0.1`. Tarball
contents include both `src/native/index.ts` and `src/native/admin.ts`.

The installed entry resolved to
`host/node_modules/@dinkuskit/ship/src/native/index.ts`. `astro check`
completed with `0 files`, `0 errors`, `0 warnings`, and `0 hints`. Auth-shell
HTTP 200 was not counted as native proof: authenticated installed native block
responses separately exercised Orders, synthetic order detail, Ship review,
and settings, with no provider or Commerce action.

The precise supported local development boot route, documented in the
installed EmDash source, is:

`http://127.0.0.1:4337/_emdash/api/setup/dev-bypass?content=0&redirect=/_emdash/admin/plugins/dinkuskit-ship/orders`

It is development-only, local, credential-free, and not a production bypass.
Parent CUA screenshot capture remains the visual gate. Commerce remains
**UNVERIFIED** against the exact immutable source binding; no Commerce writes
were performed.

## Acceptance closeout

Acceptance is bounded to this same native Ship slice at code baseline
`5c2f0a7`. No new implementation milestone was started, and no source,
package, provider, account, secret, deployment, publication, or Commerce
write was performed. The earlier local “screenshot pending” and
source-mounted-host statements are superseded by the installed-package and
parent-CUA evidence below.

The parent CUA visibly exercised:

`Orders → Open Order #1042 → Make a postage label → Shipping → Ship settings → Back to Orders/order detail`

These are parent browser evidence, not an independent worker claim:

```text
runs/native-admin-ui-proof-20261001/screenshots/order-detail.jpg
  2216fb2536510fa6d8dff1802ce6236e8e3882dfb14333248b4602ac5e83c3a7
runs/native-admin-ui-proof-20261001/screenshots/ship-settings.jpg
  99a707d7d0540c92b1d9bfdc3ace14e7d99c0d49095360736f8f6db20fd99d42
runs/native-admin-ui-proof-20261001/screenshots/shipping-review.jpg
  2ff06858cfbb3573a4341201257b2588861d26da8d36f4092ff84406c4bd0eb9
```

Closeout checks:

```text
npm test
  9 passed, 0 failed
SHA-256 dinkuskit-ship-0.0.0.tgz
  b6877585b7b05e9aca5d16c15cb8aefc6ab8fb49f9913d1c95713d357dc70dee
installed package
  @dinkuskit/ship@0.0.0
  native entry node_modules/@dinkuskit/ship/src/native/index.ts
explicit TypeScript compilation
  tsc --noEmit ... src/native/index.ts src/native/admin.ts: PASS
installed native navigation/settings/no-provider regression
  supported dev-bypass and authenticated Orders/settings HTTP 200;
  expected native labels present; no provider action controls: PASS
```

The host’s `astro check` result remains `0 files, 0 errors, 0 warnings,
0 hints`; it is host validation, not TypeScript compilation proof. Native
source hashes at closeout remain:

```text
7745b5e0db326316adb7e4e3fb3c721e0fcb948717427260af0a671c1633e8b3  src/native/index.ts
1bad7055ceefe5013b6dfe7d57d510127457f8a2edab4cd3acc5fbf71c7ec8e5  src/native/admin.ts
```

The parent-reported actual Commerce source SHA is
`51ab023b14490e3bff821e5310dd1c323092df30`. Its files were inspected
read-only; the exact trusted order/action seam remains **UNVERIFIED**.
Merchant-funded postage is settled as a product boundary, not an acceptance
gate.

Remaining gates are unchanged: Registry publisher identity and security
contact, public release/submission, Registry runner availability, actual
Core/Commerce binding, and PB/provider/account/credential/production
availability. Core and PB remain unknown where not independently proven.
No repack was needed because code and package contents did not change.

## Parent acceptance addendum — UI context and localization

This documentation-only addendum follows the closed native slice after `ce1b`
(`canonicalcompletedcleanupReadytrue`) and does not reopen acceptance.
Pinned EmDash `1.0.1` guidance was checked at the immutable upstream
[`AGENTS.md`](https://raw.githubusercontent.com/emdash-cms/emdash/0e8977c22/AGENTS.md)
(`Kumo` React UI 196–226, Lingui user strings 227–264, Arabic/RTL 281) and
[`CONTRIBUTING.md`](https://raw.githubusercontent.com/emdash-cms/emdash/0e8977c22/CONTRIBUTING.md)
(i18n 164–190).

The installed `blocks/dist/validation-CX9LT920.d.ts` surface provides
`PluginUiContext.locale`, `direction: "ltr" | "rtl"`, and `contentLocale`;
installed `emdash/src/plugins/types.ts` exposes `RouteContext.ui?`. The
current native route passes `ctx.input` only. The worker is BlockKit/JSON,
contains no React/Kumo imports, and has English user strings hardcoded in
`src/native/admin.ts`.

Therefore this proof does not claim localized plugin labels, Lingui or
Arabic/RTL behavior, custom React/Kumo UI, or native UI registry proof. No
source, dependency, cosmetic, or test change was made. The localization gap
is recorded honestly while the existing local packaged native UI success
remains accepted.

## Handoff truth

Full local packaged native UI success remains accepted; Commerce remains
**UNVERIFIED**. Registry publisher/contact/publication/runner, PB/provider,
account, credential, and production gates remain unknown or externally gated.
No source fallback, provider, credential, publication, PR, push, merge, or
external mutation occurred.
