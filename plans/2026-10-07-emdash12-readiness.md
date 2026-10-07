# Ship EmDash 1.2 migration readiness

Date: 2026-10-07
Checkout: `codex/emdash-12-migration-readiness-20261007`
HEAD: `68a155eec8bb9c17f32a1e02f442594952f99641` (`mergedmain68a155e`)

This is a public-safe readiness inventory of the checked-out source. It is
not a release plan with guessed target versions, and it does not claim a
Registry release, signed install, Commerce handoff, provider operation, or
deployment.

## Current package and dependency closure

### Ship package

`package.json` declares:

| Field | Current value |
| --- | --- |
| package | `@dinkuskit/ship` |
| version | `0.0.0` |
| package state | `private: true` |
| module format | ESM (`type: module`) |
| supported exports | `.` and `./plugin`, both `./src/plugin.js` |
| runtime dependencies | none |
| devDependencies | none |
| package scripts | `test`, `dev`, `fixture:proof`, `verify:sandbox`, `prepare:sandbox` |

No tracked `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`,
`pnpm-lock.yaml`, or Bun lockfile exists. The root package therefore has no
committed dependency-resolution artifact.

The package source entry uses only plain JavaScript and Node built-ins or
relative modules. The supported exported entry, `src/plugin.js`, has no
EmDash, Blocks, React, Kumo, or host-runtime import. Its related source
modules are included by the package `files` list, but are not dependencies of
the supported package entry.

There is retained historical native source under `src/native/`:

- `src/native/index.ts` imports `emdash` and `./admin.js`.
- `src/native/admin.ts` imports `@emdash-cms/blocks`.
- The root package declares neither import as a dependency.
- No native subpath is exported or supported by the current package contract.

That source/dependency gap is an affected seam if native UI is revived; it is
not a reason to add dependencies to the current dependency-free Ship entry.

### Actual host fixture closure

The tracked `test-support/sandbox-host/package.json` is a separate local GUI
fixture host, not Ship package metadata. Its exact current direct dependency
closure is:

| Section | Package | Version |
| --- | --- | --- |
| dependencies | `@astrojs/node` | `11.1.6` |
| dependencies | `@astrojs/react` | `6.0.5` |
| dependencies | `@emdash-cms/sandbox-workerd` | `0.9.3` |
| dependencies | `astro` | `7.3.2` |
| dependencies | `emdash` | `1.2.0` |
| dependencies | `react` | `19.2.0` |
| dependencies | `react-dom` | `19.2.0` |
| dependencies | `workerd` | `1.20261001.1` |
| devDependencies | `@astrojs/check` | `0.9.10` |
| devDependencies | `typescript` | `6.0.3` |

The fixture requires Node `>=22.16.0`. `astro.config.mjs` selects server
output, the Node adapter, SQLite, local upload storage, the
`@emdash-cms/sandbox-workerd/sandbox` runner, and the standard-format
`@dinkuskit/ship` entrypoint. It separately repeats package identity,
capabilities, allowed hosts, preferences storage, and host admin pages.

The applicable official target matrix is
`EMDASH-1_2-PUBLISHED-TARGET-MATRIX-20261007.json` (SHA-256
`72e6c6b30b314fbad1bad3981e334d6ad0fef800787d0846b9564bd660f4135a`).
Observed target changes are EmDash `1.2.0` and sandbox-workerd `0.9.3`;
other fixture pins remain unchanged.

## Affected API seams

### Registry manifest

`emdash-plugin.jsonc` currently declares:

- slug `ship`;
- MIT license, author `DinkusKit`, name `DinkusKit Ship`;
- no publisher identity or security contact;
- empty `capabilities` and `allowedHosts`;
- `storage.preferences.indexes: ["locale"]`;
- manifest admin pages `/orders`, `/settings`, `/order-detail`, and
  `/shipping`.

The manifest explicitly describes a private local sandbox package. Publisher
identity and Registry publication metadata are absent by design. Release
readiness must therefore treat Registry validation, signing, publication, and
installation as separate gates.

### Supported runtime entry and Block Kit

`src/plugin.js` is the supported standard-format entry. It exports a plugin
with these private JSON POST routes:

| Route | Permission | Current behavior |
| --- | --- | --- |
| `admin` | `plugins:manage` | Block Kit admin response and interaction handling |
| `settings` | `plugins:manage` | Read-only preference/status response |
| `status` | `plugins:read` | Disabled provider and empty operations status |

The admin response is plain Block Kit-shaped JSON. The default `/orders`
surface is fail-closed when no trusted Commerce order is mounted. The
explicit `synthetic-order-1042` input or host-mounted `/proof-fixture` page enables synthetic order detail,
shipping review, editable package validation, and the fixed sample destination
and paid total. Provider lookup, purchase, retry, PDF, print, credentials,
Commerce reads, and Inventory reads are absent from this entry.

The supported entry exports routes rather than admin page registration. The
retained unsupported native entry lists `/orders` and `/settings`; the manifest
also names `/order-detail` and `/shipping`; the fixture host names
`/orders`, `/proof-fixture`, and `/settings`. These are not interchangeable
contracts and must be reconciled or explicitly mapped before a release claim.

### Storage and preferences

The manifest and fixture host both declare plugin-scoped
`storage.preferences` with the `locale` index. The route reads preference key
`admin` for `showDashboardLinks`, locale, and direction, and stores the
synthetic package under `synthetic-package` only for the explicit fixture.
Settings persistence is local display state; it is not provider account or
credential state.

### Locale and direction

The route consumes host-attested `routeCtx.ui.locale` and
`routeCtx.ui.direction`. English and Arabic copy are present; locale families
other than Arabic fall back to English, while direction is normalized only to
host-provided `rtl` or `ltr`. The acceptance seam is therefore host locale
delivery plus rendered direction, not an action-body locale override.

## Prepare, verify, and proof provenance

`npm run prepare:sandbox` copies the tracked host package/config into an
ignored run directory, packs the current Ship package, records a content
hash, installs that tarball with scripts disabled and audit/funding disabled,
and initializes the host's local EmDash SQLite database. It does not publish,
call a provider, or use Registry credentials.

`npm run verify:sandbox` packs and installs into a temporary package, imports
the installed entry, and requires an explicitly configured real sandbox
runner plus loopback host. When those prerequisites exist, it compares fresh
and host-installed package files, invokes the actual private admin dispatcher,
checks settings persistence, checks default Commerce fail-closed behavior,
checks the explicit fixture package flow, and checks Arabic RTL responses.
Without a runner it intentionally reports package installation but does not
claim sandbox execution.

Existing dated proof is historical provenance and remains labeled as such:

- `proof/2026-10-01-emdash-sandbox-blockkit/`: initial packaged Block Kit
  seam, storage contract, host-attested locale contract, and blocked runner
  gate.
- `proof/2026-10-03-emdash-sandbox-host/`: local packaged workerd host,
  settings persistence, default fail-closed state, and Arabic RTL checks.
- `proof/2026-10-03-emdash-sandbox-host/ACCEPTANCE.md`: parent corrections,
  actual-dispatcher checks, and explicit limits around Registry, Commerce,
  and provider work.
- `proof/2026-10-06-package-form/`: later package-form validation and
  installed-host proof, including historical package hashes and repair
  notes.

Those records refer to their own heads, package hashes, and execution
environments. They are not relabeled as proof of this checkout.

## Target acceptance checklist

This checklist was the bounded validation surface for the selected official
EmDash target matrix. The fresh host proof passed the applicable checks.

### Packaged artifact

- [x] Confirm the selected target matrix against official release sources.
- [x] Pack the current package and record the artifact identity.
- [x] Confirm only the supported `@dinkuskit/ship` standard entry is required.
- [ ] Confirm the manifest and package metadata agree on identity, version,
      pages, storage, capabilities, and publication prerequisites.
- [ ] Confirm the package remains dependency-free unless an approved runtime
      contract requires a deliberate change.

### Fresh install

- [ ] Install the packed artifact into a fresh host with no inherited Ship
      source or node modules.
- [ ] Confirm the installed entry and installed manifest are byte/content
      consistent with the packed artifact.
- [x] Confirm the host's selected EmDash/runner/workerd matrix is exactly the
      researched target, rather than inferred from the current fixture pins.
- [x] Confirm the package remains private and no Registry publication or
      signature claim is made without its separate gates.

### Actual workerd GUI fixture

- [x] Prepare a clean config-managed host using the approved target matrix and
      a local SQLite database.
- [x] Start the actual loopback GUI host and verify the installed package
      through the real admin dispatcher, not direct handler calls alone.
- [x] Validate the default Orders page is fail-closed and contains no
      synthetic order, recipient, address, or paid-total data.
- [ ] Select only the explicit synthetic fixture and validate the bounded
      package form, including valid dimensions, invalid number, nonpositive,
      weight-limit, and length-plus-girth failures.
- [ ] Confirm destination and immutable paid total remain fixed while package
      values change.
- [x] Confirm settings navigation uses the supported admin action and that
      `showDashboardLinks` persists after reload.
- [x] Confirm host-attested English/LTR and Arabic/RTL settings and fixture
      rendering, including translated dimension labels and validation errors.
- [x] Confirm unauthenticated admin access is denied and invalid package input
      does not overwrite valid persisted package state.
- [ ] Confirm no provider, account, credential, Commerce, Inventory, quote,
      purchase, retry, PDF, or print operation occurs.
- [ ] Retain only sanitized, public-safe proof references with the exact
      checkout, host matrix, artifact identity, and execution result.

## Applicability and no-change boundary

For the current dependency-free Ship entry, the migration is a host-only
application: the selected EmDash 1.2 contract accepts the standard
plain-JSON entry, the declared routes, Block Kit response shape, plugin
preferences storage, host-attested locale/direction fields, and current
manifest fields without source compatibility changes. The fresh packaged
and actual-host acceptance checks above passed.

The fixture host owns Astro, React, EmDash, sandbox-workerd, workerd, adapter,
database, storage, and TypeScript/check tooling. The matrix authorized only
the EmDash and sandbox-workerd pin changes; no other host pin or config
change was required by the observed proof.

## Verification for this artifact

The requested repository test command and target-host proof were run on this
checkout:

```text
npm test
29 passed, 0 failed

host npm run typecheck
0 errors, 0 warnings, 0 hints

actual EmDash 1.2/workerd host
package install, admin dispatch, authorization denial, settings persistence,
valid/invalid package persistence, English fallback, Arabic RTL: passed
```

Official `@emdash-cms/plugin-cli@0.13.3` was inspected in a temporary
directory. Its build/bundle contract requires `src/plugin.ts`, and its
offline validation truthfully blocks this manifest because publisher identity
is absent. It was not added as an unused dependency. The official bundle
contract records a 128 KiB per-file backend cap; this standard-format
dependency-free package is not a CLI bundle input.

No credential, environment, customer data, provider call, quote, purchase,
account, deploy, commit, push, or ledger edit was performed or changed.
Historical proof remains unmodified. Full details are in
`proof/2026-10-07-emdash12-migration/PROOF.md`.

The parent reproduced the target proof, aligned host pages with the manifest,
and qualified a synthetic local SQLite `1.0.1` → `1.2.0` upgrade without reseed.
One content row, two stored preferences, and one synthetic plugin-state record
were preserved exactly. Installed backend size and unsupported locale fallback
are now explicit verifier assertions. See the dated proof for identities and
limits; Registry publisher/bundle validation remains a separate gate.
