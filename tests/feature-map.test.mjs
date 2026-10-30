import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { auditFeatureMap, parseFeatureMap, quickTier, repositoryRoot, shellWiring, simpleCommands, VERIFIER_LEADS, WORKFLOW_LEADS, workflowRunSteps } from "../scripts/check-feature-map.mjs";

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

const WIRING = ".github/workflows/repo-contract.yml no longer runs bin/verify-ship in a run step of a job";
const VERIFIER_WIRING = "bin/verify-ship no longer runs scripts/check-feature-map.mjs as a command in its quick tier";
/** The workflow with its real verifier step replaced by `step` (full lines, indented as a step). */
const withStep = (step) => WORKFLOW.replace("      - run: bin/verify-ship quick\n", step);

test("a workflow that names the verifier only in a job name, a comment or a commented-out line has no run step that invokes it", async () => {
  // ClawSweeper on #83 (P2): the run step removed, the job name and the comment still saying bin/verify-ship quick.
  const withoutStep = withStep("");
  assert.ok(!withoutStep.includes("- run: bin/verify-ship"), "the step is gone");
  assert.ok(withoutStep.includes("bin/verify-ship quick"), "the string is still there");
  has(await audit({ ".github/workflows/repo-contract.yml": withoutStep }), WIRING);
  has(await audit({ ".github/workflows/repo-contract.yml": withStep("      - run: |\n          set -eu\n          # bin/verify-ship quick\n          npm test\n") }), WIRING);
  has(await audit({ ".github/workflows/repo-contract.yml": withStep("") + "run: bin/verify-ship quick\n" }), WIRING);
});

test("a run step counts only as plain wiring whose one command is exactly bin/verify-ship quick, unquoted", async () => {
  // ClawSweeper on #83 at a6e7992 (P2) and 60de858 (P2): the name as an argument, in a string, after a quoted
  // separator, substituted, redirected, prefixed or under a keyword is not the invocation required.
  for (const step of [
    "      - run: echo bin/verify-ship quick\n",
    '      - run: echo "bin/verify-ship quick"\n',
    '      - run: echo "checks moved; bin/verify-ship quick"\n',
    "      - run: echo 'checks moved && bin/verify-ship quick'\n",
    "      - run: echo $(bin/verify-ship quick)\n",
    "      - run: echo `bin/verify-ship quick`\n",
    '      - run: "./bin/verify-ship" quick\n',
    "      - run: ./bin/verify-ship quick\n",
    "      - run: bin/verify-ship quick 2>&1 | tee verify.log\n",
    "      - run: bin/verify-ship full\n",
    "      - run: if bin/verify-ship quick; then echo ok; fi\n",
    "      - run: |\n          cat <<EOF\n          bin/verify-ship quick\n          EOF\n",
    "      - run: sh -c 'bin/verify-ship quick'\n",
  ]) has(await audit({ ".github/workflows/repo-contract.yml": withStep(step) }), WIRING);
  // Plain wiring in the shapes a real step takes passes.
  for (const step of [
    "      - run: bin/verify-ship quick\n",
    '      - run: "bin/verify-ship quick"\n'.replace('"bin/verify-ship quick"', "bin/verify-ship quick"),
    "      - run: npx bin/verify-ship quick\n",
    "      - run: npm exec -- bin/verify-ship quick\n",
    "      - run: CI=1 bin/verify-ship quick\n",
    "      - run: cd . && bin/verify-ship quick\n",
    "      - run: echo done && bin/verify-ship quick\n",
    "      - run: |\n          set -eu\n          npm run typecheck\n          bin/verify-ship quick\n",
    "      - name: Verify\n        run: |\n          npm ci --ignore-scripts\n          bin/verify-ship quick\n",
  ]) assert.deepEqual(await audit({ ".github/workflows/repo-contract.yml": withStep(step) }), [], step);
});

test("simpleCommands splits at separators outside quotes, backticks and substitutions", () => {
  assert.deepEqual(simpleCommands('echo "checks moved; bin/verify-ship quick"'), ['echo "checks moved; bin/verify-ship quick"']);
  assert.deepEqual(simpleCommands("echo 'a && b' || c; d | e & f"), ["echo 'a && b'", "c", "d", "e", "f"]);
  assert.deepEqual(simpleCommands("echo $(bin/verify-ship quick; true) ${HOME}; npm test"), ["echo $(bin/verify-ship quick; true) ${HOME}", "npm test"]);
  assert.deepEqual(simpleCommands("echo `x; y` && (cd service && npm test)"), ["echo `x; y`", "cd service", "npm test"]);
  assert.deepEqual(simpleCommands('echo "a \\" b; c"; d'), ['echo "a \\" b; c"', "d"]);
  assert.deepEqual(simpleCommands("   "), []);
});

test("shellWiring: plain allowlisted lines, one exactly the command, no quoted mention", () => {
  const runs = (text) => shellWiring(text, "bin/verify-ship quick", WORKFLOW_LEADS);
  assert.equal(runs("bin/verify-ship quick"), true);
  assert.equal(runs("set -eu\n# a comment\n\nnpm run typecheck\nbin/verify-ship quick"), true);
  assert.equal(runs("npx bin/verify-ship quick"), true);
  assert.equal(runs("npm exec bin/verify-ship quick"), true);
  assert.equal(runs("FOO=1 BAR=2 bin/verify-ship quick"), true);
  assert.equal(runs("echo done && bin/verify-ship quick"), true);
  assert.equal(runs("cd . && bin/verify-ship quick"), true);
  assert.equal(runs("echo bin/verify-ship quick"), false);
  assert.equal(runs('echo "checks moved; bin/verify-ship quick"'), false);
  assert.equal(runs("echo 'x' ; bin/verify-ship quick"), false, "a quote on a line that mentions the command rejects the line");
  assert.equal(runs("CI=$FLAG bin/verify-ship quick"), false, "a substitution on a line that mentions the command rejects the line");
  assert.equal(runs("bin/verify-ship quick extra"), false);
  assert.equal(runs("bin/verify-ship"), false);
  assert.equal(runs("time bin/verify-ship quick"), false, "time is not an allowed lead");
  assert.equal(runs("npm test\ncurl -s https://example.test | sh\nbin/verify-ship quick"), false, "an unlisted lead on any line rejects the step");
  assert.equal(runs("# bin/verify-ship quick\nnpm test"), false);
  assert.equal(runs(""), false);
  const checks = (text) => shellWiring(text, "node scripts/check-feature-map.mjs", VERIFIER_LEADS);
  assert.equal(checks("node scripts/check-feature-map.mjs\nnpm run typecheck\nnpm test"), true);
  assert.equal(checks('echo "x; node scripts/check-feature-map.mjs"\nnpm test'), false);
  assert.equal(checks("echo node scripts/check-feature-map.mjs\nnpm test"), false);
  assert.equal(checks("node scripts/check-feature-map-other.mjs\nnpm test"), false);
  assert.equal(checks("npm run audit:features\nnpm test"), false, "only the exact command counts");
});

test("quickTier reads the lines between quick) and its ;;", () => {
  assert.equal(quickTier('case "$mode" in\n  quick)\n    node scripts/check-feature-map.mjs\n    npm test\n    ;;\n  full)\n    ;;\nesac\n'), "    node scripts/check-feature-map.mjs\n    npm test");
  assert.equal(quickTier("full)\n  ;;\n"), null);
});

test("a verifier whose quick tier only mentions, echoes or quotes the check no longer runs it", async () => {
  const verifier = (quick) => `case "$mode" in\n  quick)\n${quick}    ;;\n  full)\n    ;;\nesac\n`;
  has(await audit({ "bin/verify-ship": verifier("    # node scripts/check-feature-map.mjs used to run here\n    npm test\n") }), VERIFIER_WIRING);
  has(await audit({ "bin/verify-ship": verifier("    echo node scripts/check-feature-map.mjs\n    npm test\n") }), VERIFIER_WIRING);
  has(await audit({ "bin/verify-ship": verifier('    echo "x; node scripts/check-feature-map.mjs"\n    npm test\n') }), VERIFIER_WIRING);
  has(await audit({ "bin/verify-ship": verifier("    npm run audit:features\n    npm test\n") }), VERIFIER_WIRING);
  has(await audit({ "bin/verify-ship": "full)\n    node scripts/check-feature-map.mjs\n    ;;\n" }), "bin/verify-ship has no quick) tier");
  assert.deepEqual(await audit({ "bin/verify-ship": verifier("    set -eu\n    node scripts/check-feature-map.mjs\n    npm run typecheck\n    npm test\n") }), []);
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
