import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { auditFeatureMap, parseFeatureMap, repositoryRoot } from "../scripts/check-feature-map.mjs";

// The feature map check bin/verify-ship quick runs first: this repository's map is clean, a map
// that drifts from its tree, in either direction, is reported, and the real bin/verify-ship,
// executed against a drifted map, exits non-zero before anything else runs.

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
  "bin/verify-ship": 'set -eu\ncase "$mode" in\n  quick)\n    node scripts/check-feature-map.mjs\n    ;;\n  full)\n    ;;\nesac\n',
  "scripts/check-feature-map.mjs": "// stand-in\n",
  ".github/workflows/ci.yml": "name: CI\n",
  ".github/workflows/repo-contract.yml": "name: Repository contract\n",
  "src/plugin.ts": "export default {};\n",
  "tests/plugin.test.mjs": "// stand-in\n",
};

/** A temporary tree holding BASE with these files added, replaced, or (null) removed. */
async function tree(changes = {}) {
  const root = await mkdtemp(join(tmpdir(), "ship-feature-map-"));
  for (const [path, content] of Object.entries({ ...BASE, ...changes })) {
    if (content === null) continue;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

/** The findings for BASE with these changes. */
async function audit(changes = {}) {
  const root = await tree(changes);
  try {
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

test("a verifier tier bin/verify-ship does not declare, or a verifier that is not one command, is reported", async () => {
  has(await audit({ "FEATURE_MAP.md": HEADER + PLUGIN_ROW.replace("`bin/verify-ship quick` |\n", "`bin/verify-ship nightly` |\n") + CONTRACT_ROW }), 'tier "nightly" is not one bin/verify-ship accepts (quick, full)');
  has(await audit({ "FEATURE_MAP.md": HEADER + PLUGIN_ROW.replace("`bin/verify-ship quick` |\n", "`npm test` |\n") + CONTRACT_ROW }), "Quick verifier must be one backticked bin/verify-ship <tier> command");
  has(await audit({ "bin/verify-ship": "set -eu\nnpm test\n" }), "bin/verify-ship declares no tier");
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

test("the verification assets must exist", async () => {
  has(await audit({ ".github/workflows/ci.yml": null }), "missing verification asset: .github/workflows/ci.yml");
  has(await audit({ ".github/workflows/repo-contract.yml": null }), "missing verification asset: .github/workflows/repo-contract.yml");
  has(await audit({ "bin/verify-ship": null }), "missing verification asset: bin/verify-ship");
});

test("an empty, table-less or row-less FEATURE_MAP.md is drift, not a pass", async () => {
  // ClawSweeper on #83 (P3): a zero-byte map used to audit clean.
  has(await audit({ "FEATURE_MAP.md": "" }), "FEATURE_MAP.md has no table");
  has(await audit({ "FEATURE_MAP.md": "# Feature map\n\nProse only.\n" }), "FEATURE_MAP.md has no table");
  has(await audit({ "FEATURE_MAP.md": HEADER }), "FEATURE_MAP.md has no surface rows");
});

test("parseFeatureMap reads the one table, keyed by column", () => {
  const { rows } = parseFeatureMap(`# Title\n\nProse.\n\n${HEADER}${PLUGIN_ROW}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Surface ID"], "`dinkus.ship-plugin`");
  assert.equal(rows[0]["Quick verifier"], "`bin/verify-ship quick`");
  assert.match(parseFeatureMap("no table").error, /no table/);
});

// Whether the quick tier really runs the check is proved by running it, not by reading it.
// The real bin/verify-ship and the real check are copied byte for byte into a tree whose map
// drifts; the verifier must exit non-zero on the check's findings before typecheck or tests.
async function runRealVerifier(changes) {
  const root = await tree(changes);
  try {
    await copyFile(join(repositoryRoot, "bin/verify-ship"), join(root, "bin/verify-ship"));
    await copyFile(join(repositoryRoot, "scripts/check-feature-map.mjs"), join(root, "scripts/check-feature-map.mjs"));
    const run = spawnSync("sh", [join(root, "bin/verify-ship"), "quick"], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: process.env.PATH } });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("bin/verify-ship quick, executed against a drifted map, exits non-zero on the check's findings and runs nothing after it", async () => {
  const drifted = await runRealVerifier({ "src/plugin.ts": null, "src/entry.ts": "export default {};\n" });
  assert.notEqual(drifted.status, 0, `exit ${drifted.status}\n${drifted.stdout}${drifted.stderr}`);
  assert.match(drifted.stderr, /feature_map: dinkus\.ship-plugin: Owned paths names a path the tree does not have: src\/plugin\.ts/);
  assert.match(drifted.stderr, /feature_map: dinkus\.ship-plugin: Entry points names a path the tree does not have: src\/plugin\.ts/);
  assert.match(drifted.stderr, /feature_map: no row owns src\/entry\.ts/);
  assert.match(drifted.stderr, /feature_map=drift findings=3/);
  assert.doesNotMatch(drifted.stdout + drifted.stderr, /typecheck|verify-ship: quick passed/, "the verifier stopped at the check");
  // The same verifier on a clean map gets past the check (and then fails on this bare tree's missing package.json, not on the map).
  const clean = await runRealVerifier({});
  assert.match(clean.stdout, /feature_map=clean surfaces=2 verified_files=/);
  assert.doesNotMatch(clean.stderr, /feature_map=drift/);
});

test("the real bin/verify-ship fails closed: set -e is on and the check is a plain line of its quick tier", async () => {
  const verifier = await readFile(join(repositoryRoot, "bin/verify-ship"), "utf8");
  assert.match(verifier, /^set -eu$/m);
  assert.ok(verifier.indexOf("set -eu") < verifier.indexOf("quick)"), "set -eu comes before the quick tier");
  assert.match(verifier, /^    node scripts\/check-feature-map\.mjs$/m);
});
