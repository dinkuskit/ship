import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { auditFeatureMap, parseFeatureMap, repositoryRoot, shellRuns, workflowRunSteps } from "../scripts/check-feature-map.mjs";

// The feature map check bin/verify-ship quick runs first: this repository's map is clean,
// and a map that drifts from its tree, in either direction, is reported.

const HEADER =
  "| Surface ID | Responsibility | Owned paths | Entry points | Driver actions | Observable success states | Quick verifier |\n" +
  "| --- | --- | --- | --- | --- | --- | --- |\n";
const PLUGIN_ROW =
  "| `dinkus.ship-plugin` | The plugin | `src/plugin.ts`; `tests/plugin.test.mjs` | `src/plugin.ts` | a click | a page | `bin/verify-ship quick` |\n";
const CONTRACT_ROW =
  "| `dinkus.ship-repo-contract` | The contract | `bin/verify-ship`; `scripts/check-feature-map.mjs`; `FEATURE_MAP.md`; `.github/workflows/` | `bin/verify-ship quick` | a pull request | `feature_map=clean` | `bin/verify-ship quick` |\n";

/** The Repository contract workflow, as the repository's one is shaped. */
const WORKFLOW = [
  "name: Repository contract",
  "# bin/verify-ship quick runs below; this comment is not a step.",
  "on:",
  "  pull_request:",
  "jobs:",
  "  verify-ship:",
  "    name: bin/verify-ship quick",
  "    runs-on: ubuntu-24.04",
  "    steps:",
  "      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0",
  "        with:",
  "          persist-credentials: false",
  "      - run: npm ci --ignore-scripts --no-audit --no-fund",
  "      - run: bin/verify-ship quick",
  "",
].join("\n");

/** A tree the map above describes exactly. */
const BASE = {
  "FEATURE_MAP.md": HEADER + PLUGIN_ROW + CONTRACT_ROW,
  "bin/verify-ship": 'case "$mode" in\n  quick)\n    node scripts/check-feature-map.mjs\n    ;;\n  full)\n    ;;\nesac\n',
  "scripts/check-feature-map.mjs": "// stand-in\n",
  ".github/workflows/ci.yml": "name: CI\n",
  ".github/workflows/repo-contract.yml": WORKFLOW,
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

test("a workflow that names the verifier only in a job name, a comment or a commented-out line has no run step that invokes it", async () => {
  // ClawSweeper on #83 (P2): the run step removed, the job name and the comment still saying bin/verify-ship quick.
  const withoutStep = WORKFLOW.replace("      - run: bin/verify-ship quick\n", "");
  assert.ok(!withoutStep.includes("- run: bin/verify-ship"), "the step is gone");
  assert.ok(withoutStep.includes("bin/verify-ship quick"), "the string is still there");
  has(await audit({ ".github/workflows/repo-contract.yml": withoutStep }), ".github/workflows/repo-contract.yml no longer runs bin/verify-ship in a run step of a job");
  const commentedOut = WORKFLOW.replace("      - run: bin/verify-ship quick\n", "      - run: |\n          set -eu\n          # bin/verify-ship quick\n          npm test\n");
  has(await audit({ ".github/workflows/repo-contract.yml": commentedOut }), "no longer runs bin/verify-ship in a run step of a job");
  const outsideJobs = WORKFLOW.replace("      - run: bin/verify-ship quick\n", "") + "run: bin/verify-ship quick\n";
  has(await audit({ ".github/workflows/repo-contract.yml": outsideJobs }), "no longer runs bin/verify-ship in a run step of a job");
  // A real run step passes however it is written: plain, quoted, or in a block scalar after other commands.
  assert.deepEqual(await audit({ ".github/workflows/repo-contract.yml": WORKFLOW.replace("- run: bin/verify-ship quick", '- run: "bin/verify-ship quick"') }), []);
  assert.deepEqual(await audit({ ".github/workflows/repo-contract.yml": WORKFLOW.replace("      - run: bin/verify-ship quick\n", "      - name: Verify\n        run: |\n          set -eu\n          npm run typecheck\n          bin/verify-ship quick 2>&1 | tee verify.log\n") }), []);
});

test("workflowRunSteps reads run steps by structure and shellRuns ignores comments", () => {
  assert.deepEqual(workflowRunSteps(WORKFLOW), ["npm ci --ignore-scripts --no-audit --no-fund", "bin/verify-ship quick"]);
  assert.deepEqual(workflowRunSteps("name: x\nrun: bin/verify-ship quick\njobs:\n  a:\n    run: not-a-step\n"), []);
  assert.deepEqual(workflowRunSteps("jobs:\n  a:\n    steps:\n      - run: |\n          one\n\n          two\n      - uses: x\n"), ["one\n\ntwo"]);
  assert.equal(shellRuns("set -eu\nnode scripts/check-feature-map.mjs\n", "node scripts/check-feature-map.mjs"), true);
  assert.equal(shellRuns("# node scripts/check-feature-map.mjs\nnpm test\n", "node scripts/check-feature-map.mjs"), false);
  assert.equal(shellRuns("npm test # bin/verify-ship quick\n", "bin/verify-ship"), false);
  assert.equal(shellRuns("cd x && bin/verify-ship quick", "bin/verify-ship"), true);
  assert.equal(shellRuns("./bin/verify-ship-other quick", "bin/verify-ship"), false);
  // ClawSweeper on #83 at a6e7992 (P2): the name as an argument, in a string or in a comment is not an invocation.
  assert.equal(shellRuns("echo bin/verify-ship quick", "bin/verify-ship"), false);
  assert.equal(shellRuns('echo "bin/verify-ship quick"', "bin/verify-ship"), false);
  assert.equal(shellRuns("printf '%s\\n' bin/verify-ship", "bin/verify-ship"), false);
  assert.equal(shellRuns("echo node scripts/check-feature-map.mjs", "node scripts/check-feature-map.mjs"), false);
  assert.equal(shellRuns("node scripts/check-feature-map-other.mjs", "node scripts/check-feature-map.mjs"), false);
  // Command positions: wrappers, assignments, keywords, quoting and ./ do not hide a real invocation.
  assert.equal(shellRuns("npx bin/verify-ship quick", "bin/verify-ship"), true);
  assert.equal(shellRuns("CI=1 time bin/verify-ship quick", "bin/verify-ship"), true);
  assert.equal(shellRuns('"bin/verify-ship" quick', "bin/verify-ship"), true);
  assert.equal(shellRuns("./bin/verify-ship quick", "bin/verify-ship"), true);
  assert.equal(shellRuns("if bin/verify-ship quick; then echo ok; fi", "bin/verify-ship"), true);
  assert.equal(shellRuns("set -eu\ncd . && bin/verify-ship quick 2>&1 | tee verify.log", "bin/verify-ship"), true);
  assert.equal(shellRuns("time node scripts/check-feature-map.mjs", "node scripts/check-feature-map.mjs"), true);
});

test("a run step that only echoes the verifier, and a verifier that only echoes the check, do not count as running them", async () => {
  // ClawSweeper on #83 at a6e7992 (P2): `echo bin/verify-ship quick` in place of the real step kept the audit green.
  const echoed = WORKFLOW.replace("      - run: bin/verify-ship quick\n", "      - run: echo bin/verify-ship quick\n");
  has(await audit({ ".github/workflows/repo-contract.yml": echoed }), ".github/workflows/repo-contract.yml no longer runs bin/verify-ship in a run step of a job");
  const quotedEcho = WORKFLOW.replace("      - run: bin/verify-ship quick\n", '      - run: echo "bin/verify-ship quick"\n');
  has(await audit({ ".github/workflows/repo-contract.yml": quotedEcho }), "no longer runs bin/verify-ship in a run step of a job");
  has(await audit({ "bin/verify-ship": "quick)\n  echo node scripts/check-feature-map.mjs\n  npm test\n  ;;\nfull)\n  ;;\n" }), "bin/verify-ship no longer runs scripts/check-feature-map.mjs as a command");
  // Real invocations in other shapes still pass.
  for (const step of ["      - run: npx bin/verify-ship quick\n", "      - run: cd . && bin/verify-ship quick\n", "      - run: |\n          set -eu\n          npm run typecheck\n          bin/verify-ship quick\n", '      - run: "./bin/verify-ship" quick\n']) {
    assert.deepEqual(await audit({ ".github/workflows/repo-contract.yml": WORKFLOW.replace("      - run: bin/verify-ship quick\n", step) }), [], step);
  }
});

test("a verifier that only mentions the check in a comment no longer runs it", async () => {
  has(await audit({ "bin/verify-ship": "quick)\n  # node scripts/check-feature-map.mjs used to run here\n  npm test\n  ;;\nfull)\n  ;;\n" }), "bin/verify-ship no longer runs scripts/check-feature-map.mjs as a command");
  assert.deepEqual(await audit({ "bin/verify-ship": "quick)\n  npm run audit:features\n  npm test\n  ;;\nfull)\n  ;;\n" }), []);
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
