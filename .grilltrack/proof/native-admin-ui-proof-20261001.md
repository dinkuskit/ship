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
