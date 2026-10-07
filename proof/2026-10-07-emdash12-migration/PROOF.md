# EmDash 1.2 migration readiness proof

Date: 2026-10-07  
Checkout: `codex/emdash-12-migration-readiness-20261007`  
HEAD at start: `68a155eec8bb9c17f32a1e02f442594952f99641`  
Node: `22.23.1` from `/Users/bobbybones/.local/share/mise/installs/node/22.23.1/bin`

This is a local, public-safe readiness proof. It is not a Registry
publication, signed install, provider operation, Commerce handoff, quote,
purchase, account, grant, deployment, or release claim.

## Authorization and selected target

The approved published matrix selects EmDash `1.2.0` and
`@emdash-cms/sandbox-workerd@0.9.3`. Matrix SHA-256:
`72e6c6b30b314fbad1bad3981e334d6ad0fef800787d0846b9564bd660f4135a`.

Applied host changes:

- `emdash`: `1.0.1` → `1.2.0`
- `@emdash-cms/sandbox-workerd`: `0.9.1` → `0.9.3`

Unchanged host pins include Astro `7.3.2`, React `19.2.0`, workerd
`1.20261001.1`, the Astro adapters, and TypeScript/check tooling. The root
Ship package remains private and dependency-free. Retained `src/native` files
and their EmDash SDK imports were not revived or changed.

## Fresh host and artifact

Fresh ignored host:

`runs/emdash12-migration/host`

The host was prepared from the tracked host package, with a new local SQLite
database and no reuse or deletion of historical run directories. Installed
top-level versions were verified with `npm ls --depth=0`:

```text
emdash                         1.2.0
@emdash-cms/sandbox-workerd   0.9.3
astro                          7.3.2
@astrojs/node                  11.1.6
@astrojs/react                 6.0.5
react                          19.2.0
react-dom                      19.2.0
workerd                        1.20261001.1
```

The packaged standard entry was installed into the host with scripts,
auditing, and funding disabled.

Artifact SHA-256:

`e8ade9525a83f78779365319fb81e474d94bcbe18a0f418172c8a8781153a948`

The fresh package and host-installed package contents matched byte-for-byte.

## Actual checks

- Root baseline and post-change `npm test`: **29 passed, 0 failed**.
- Upgraded host `npm run typecheck`: **0 errors, 0 warnings, 0 hints**.
- Actual loopback Astro/EmDash/workerd dispatcher:
  - package install and host identity: **passed**
  - admin route dispatch: **passed**
  - unauthenticated admin request: **denied with HTTP 401**
  - settings persistence: **passed**
  - valid package `3.5 lb · 12 × 9 × 5 in`: **persisted**
  - invalid Arabic submission with zero weight: **rejected and did not overwrite the valid package**
  - default Commerce surface: **fail-closed**
  - explicit synthetic fixture only: **passed**
  - English fallback/LTR: **passed**
  - Arabic translation/RTL and locale refresh: **passed**
  - manifest-declared `/orders`, `/settings`, `/order-detail`, and `/shipping`
    compatibility through the supported admin dispatcher: **passed**
  - provider mutation, credentials, quote, purchase, PDF, print, and external
    requests: **not invoked**

The unchanged backend request contract remains bounded by the existing
standard-plugin route definition. No business, Commerce, or provider contract
was altered.

## Official CLI applicability and limits

The exact installed `@emdash-cms/plugin-cli@0.13.3` was inspected from its
published npm package:

- package integrity:
  `sha512-InhSrac5cq5c8aC0x6qPh4wzuUrWdj0UW/ly1qPSTqdyx93qEWCi3Ax+rCGHQ8/UTFbwo358zB1uzz6/HOjvJg==`
- `build`: requires `emdash-plugin.jsonc` plus `src/plugin.ts` and emits
  `dist/plugin.mjs`, `dist/manifest.json`, and `dist/index.mjs`
- `bundle --validate-only`: performs build plus bundle validation; the
  official bundle contract caps `backend.js` at **128 KiB**, total decompressed
  bundle size at 256 KiB, and file count at 20
- offline `validate --json`: **blocked truthfully** with
  `publisher: Invalid input: expected string, received undefined`

Running the official CLI against this checkout therefore stops at the missing
publisher gate before build/bundle validation. This checkout intentionally uses
the supported plain standard-format `src/plugin.js` entry, not the CLI's
typed `src/plugin.ts` sandboxed-plugin build format. The CLI was not added as
an unused project dependency, and no publisher identity was invented.

## State and historical boundary

The parent independently reproduced the target-host verifier and then created
an isolated baseline host at `runs/emdash12-migration/baseline-host` with
EmDash `1.0.1` and sandbox-workerd `0.9.1`. The same installed-package verifier
passed on that baseline and populated two preference records through the real
admin dispatcher. A synthetic content page and synthetic plugin-state sentinel
were added solely to qualify database preservation; the sentinel is not a
Registry install claim.

After stopping that task-owned host, only the two applicable pins were upgraded.
The official `emdash migrate --from-config --status --json` reported pending
`090_redirect_enable_loop_guard` and `091_redirect_artifacts`. The parent applied
those using the exact reported local SQLite target fingerprint, without running
`init` or `seed` again. All columns in the one synthetic `ec_pages` row, two
`_plugin_storage` rows, and one synthetic `_plugin_state` row matched the
pre-upgrade snapshot exactly. Snapshot SHA-256:
`ed321a5bb90b8579464d473bff51977a3e9d32fb89f1238b4ba349b5bab13d9e`.

The upgraded baseline host then passed the real dispatcher proof again. Host
configuration now mounts every manifest-declared page plus the explicit proof
fixture; `/order-detail` and `/shipping` are required to return real fail-closed
responses, rather than allowing the earlier unmounted-page HTTP 400 result.
The verifier additionally checks unsupported `fr-FR` locale fallback to English.
The installed standard backend is 20,296 bytes, below 131,072 bytes; this size
check is not a claim of official CLI bundle or Registry validation.

Parent raw non-secret outputs remain in the ignored task run:
`parent-verify.txt`, `migration-apply.txt`, and `state-preservation.json`.
Historical runs and proof remain untouched. This covers synthetic local SQLite
state preservation, not a production database or signed Registry installation.

No credentials, environment files, auth logs, provider, Registry account,
publication, grant, purchase, quote, deploy or ledger edit was
performed.
