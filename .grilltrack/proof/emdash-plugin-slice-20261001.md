# EmDash plugin seam proof

Date: 2026-10-01
Scope: private local package scaffold only.

## Implemented

- `emdash-plugin.jsonc` declares slug `ship` with empty capabilities,
  allowed hosts, and storage.
- `src/plugin.js` exports the package's default route object.
- `package.json` exposes `.` and `./plugin` through the same supported local
  package path.
- `admin`, `settings`, and `status` are private POST/JSON routes with explicit
  permissions and JSON-serializable results.
- Settings are read-only synthetic PB sandbox metadata; no route performs a
  provider call or Commerce mutation.

## Verification

Commands:

```sh
npm test
node --input-type=module -e 'import("@dinkuskit/ship").then(({ default: plugin }) => console.log(Object.keys(plugin.routes)))'
```

Observed:

- `npm test`: 9 passing tests, including the fixture-backed quote → review →
  test-label workflow and the package/manifest/route seam test.
- Package import lists `admin`, `settings`, and `status`.

## Boundaries

This is not Registry publication, release, install, or runner proof. No
publisher identity was created. No EmDash host, actual Commerce hook, provider
credential, provider create call, or live claim was exercised. The native
route contract is source-bound to these official URLs:

- https://docs.emdashcms.com/plugins/creating-plugins/manifest/
- https://docs.emdashcms.com/plugins/creating-plugins/api-routes/
- https://docs.emdashcms.com/plugins/creating-native-plugins/your-first-native-plugin/
- https://docs.emdashcms.com/plugins/creating-native-plugins/distributing/

Remaining gates: Registry runner/release/install, actual Commerce hook,
Pitney Bowes availability, consumer taste, and any visual/attended host proof.
