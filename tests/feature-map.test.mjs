import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { auditFeatureMap, parseFeatureMap, repositoryRoot } from "../scripts/check-feature-map.mjs";

// The feature map check bin/verify-ship quick runs first: this repository's map is clean,
// and a map that drifts from its tree, in either direction, is reported.

const HEADER =
  "| Surface ID | Responsibility | Owned paths | Entry points | Driver actions | Observable success states | Quick verifier |\n" +
  "| --- | --- | --- | --- | --- | --- | --- |\n";
const PLUGIN_ROW =
  "| `dinkus.ship-plugin` | The plugin | `src/plugin.ts`; `tests/plugin.test.mjs` | `src/plugin.ts` | a click | a page | `bin/verify-ship quick` |\n";
const CONTRACT_ROW =
  "| `dinkus.ship-repo-contract` | The contract | `bin/verify-ship`; `scripts/check-feature-map.mjs`; `FEATURE_MAP.md`; `.github/workflows/` | `bin/verify-ship quick` | a pull request | `feature_map=clean` | `bin/verify-ship quick` |\n";

/** A tree the map above describes exactly. */
const BASE = {
  "FEATURE_MAP.md": HEADER + PLUGIN_ROW + CONTRACT_ROW,
  "bin/verify-ship": 'case "$mode" in\n  quick)\n    node scripts/check-feature-map.mjs\n    ;;\n  full)\n    ;;\nesac\n',
  "scripts/check-feature-map.mjs": "// stand-in\n",
  ".github/workflows/ci.yml": "name: CI\n",
  ".github/workflows/repo-contract.yml": "      - run: bin/verify-ship quick\n",
  "src/plugin.ts": "export default {};\n",
  "tests/plugin.test.mjs": "// stand-in\n",
};

/** The findings for BASE with these files added, replaced, or (null) removed. */
async function audit(changes = {}) {
  const root = await mkdtemp(join(tmpdir(), "ship-feature-map-"));
  try {
    for (const [path, content] of Object.entries({ ...BASE, ...changes })) {
      if (content === null) continue;
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    return [...(await auditFeatureMap(root))];
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const has = (findings, text) => assert.ok(findings.some((finding) => finding.includes(text)), `expected a finding with "${text}" in:\n${findings.join("\n")}`);

test("this repository's feature map names only what the tree has, and every verified file has one row", async () => {
  const findings = await auditFeatureMap(repositoryRoot);
  assert.deepEqual([...findings], []);
  assert.ok(findings.surfaces >= 1 && findings.verified >= 1);
});

test("a map that matches its tree is clean", async () => {
  assert.deepEqual(await audit(), []);
});

test("a path the tree lost and a verified file no row owns are both reported", async () => {
  const findings = await audit({ "src/plugin.ts": null, "src/entry.ts": "export default {};\n" });
  has(findings, "dinkus.ship-plugin: Owned paths names a path the tree does not have: src/plugin.ts");
  has(findings, "no row owns src/entry.ts");
});

test("a verifier tier bin/verify-ship does not accept, or a verifier that is not one command, is reported", async () => {
  has(await audit({ "FEATURE_MAP.md": HEADER + PLUGIN_ROW.replace("`bin/verify-ship quick` |\n", "`bin/verify-ship nightly` |\n") + CONTRACT_ROW }), 'tier "nightly" is not one bin/verify-ship accepts (quick, full)');
  has(await audit({ "FEATURE_MAP.md": HEADER + PLUGIN_ROW.replace("`bin/verify-ship quick` |\n", "`npm test` |\n") + CONTRACT_ROW }), "Quick verifier must be one backticked bin/verify-ship <tier> command");
});

test("a repeated id, a directory named without its slash, and a file with two owners are reported", async () => {
  const twin = PLUGIN_ROW.replace("`src/plugin.ts`; `tests/plugin.test.mjs`", "`src`");
  const findings = await audit({ "FEATURE_MAP.md": HEADER + PLUGIN_ROW + twin + CONTRACT_ROW });
  has(findings, "duplicate surface id dinkus.ship-plugin");
  has(findings, "names a directory without its trailing slash: src");
  const sibling = PLUGIN_ROW.replace("dinkus.ship-plugin", "dinkus.ship-sibling").replace("`src/plugin.ts`; `tests/plugin.test.mjs`", "`src/`");
  has(await audit({ "FEATURE_MAP.md": HEADER + PLUGIN_ROW + sibling + CONTRACT_ROW }), "src/plugin.ts is owned by more than one row: dinkus.ship-plugin, dinkus.ship-sibling");
});

test("the columns stay the seven the map promises", async () => {
  has(await audit({ "FEATURE_MAP.md": (HEADER + PLUGIN_ROW + CONTRACT_ROW).replace("| Quick verifier |", "| Verifier |") }), "columns must be");
  has(await audit({ "FEATURE_MAP.md": HEADER + "| `dinkus.ship-short` | two |\n" }), "row 1 has 2 cells, not 7");
});

test("the verifier and the pull request workflow must keep running the check, and the assets must exist", async () => {
  const findings = await audit({ "bin/verify-ship": "quick)\n  npm test\n  ;;\n", ".github/workflows/repo-contract.yml": "name: nothing\n" });
  has(findings, "bin/verify-ship no longer runs scripts/check-feature-map.mjs");
  has(findings, ".github/workflows/repo-contract.yml no longer runs bin/verify-ship");
  has(await audit({ ".github/workflows/ci.yml": null }), "missing verification asset: .github/workflows/ci.yml");
});

test("parseFeatureMap reads the one table, keyed by column", () => {
  const { rows } = parseFeatureMap(`# Title\n\nProse.\n\n${HEADER}${PLUGIN_ROW}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Surface ID"], "`dinkus.ship-plugin`");
  assert.equal(rows[0]["Quick verifier"], "`bin/verify-ship quick`");
  assert.match(parseFeatureMap("no table").error, /no table/);
});
