import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Checks FEATURE_MAP.md against the tree, so the map an agent navigates by cannot drift
 * from what the repository holds (dinkuskit/commerce's scripts/check-features.mjs, for
 * Ship's product-surface rows). bin/verify-ship quick runs it first, and the Repository
 * contract workflow runs that on every pull request and push to main.
 *
 * Each of these is a finding, and one finding fails the run:
 * - a verification asset is missing (the map, the verifier, this check, the workflows);
 * - the table's columns are not the seven the map promises, or a row has the wrong cell count;
 * - a surface id is not one backticked `dinkus.ship-<surface>`, or is repeated;
 * - a backticked tree path in any cell names something the tree does not have, or a
 *   directory written without its trailing slash;
 * - a file under a verified root is owned by no row, or by more than one;
 * - a row's verifier is not one backticked `bin/verify-ship <tier>` with a tier the script accepts;
 * - FEATURE_MAP.md exists but is empty or has no table;
 * - the Repository contract workflow has no job step that is plain wiring: every line one bare
 *   allowlisted command with no operator character, one line exactly `bin/verify-ship quick`
 *   (or `npx bin/verify-ship quick`, after an optional `VAR=value ` prefix). A job name, a YAML
 *   comment, a commented-out line, an argument, a string, a substitution, a pipe, a redirection
 *   or a `||` / `&&` branch does not count, and the finding names the offending line;
 * - bin/verify-ship does not declare `set -e` before its `quick)` tier, or that tier has no line
 *   that is exactly `node scripts/check-feature-map.mjs`.
 */
export const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const COLUMNS = [
  "Surface ID",
  "Responsibility",
  "Owned paths",
  "Entry points",
  "Driver actions",
  "Observable success states",
  "Quick verifier",
];
/** Every file under these roots must have exactly one owning row. */
export const VERIFIED_ROOTS = [
  "src",
  "service/src",
  "service/spec",
  "service/scripts",
  "tests",
  "scripts",
  "bin",
  ".github/workflows",
  ".github/scripts",
];
/** The verification assets a repository with this map keeps. */
export const REQUIRED_FILES = [
  "FEATURE_MAP.md",
  "bin/verify-ship",
  "scripts/check-feature-map.mjs",
  ".github/workflows/ci.yml",
  ".github/workflows/repo-contract.yml",
];
const VERIFIER_SCRIPT = "bin/verify-ship";
const PR_WORKFLOW = ".github/workflows/repo-contract.yml";
/** Build output and installs, never owned. */
const SKIPPED = new Set([".git", "node_modules", "dist", "dist-sandbox", ".tmp", ".emdash-release", ".artifacts", ".wrangler", "runs"]);
const SURFACE_ID = /^dinkus\.ship-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERIFIER_COMMAND = /^bin\/verify-ship (\S+)$/;
/** A backticked token that names a file or directory in this tree, as opposed to a route, setting, flag or build output. */
const TREE_PATH = /^(?:(?:src|service|tests|scripts|bin|docs|proof|\.github|\.changeset|\.grilltrack|\.claude)(?:\/[^\s`]*)?|[A-Za-z0-9_.-]+\.(?:md|json|jsonc|mjs|ts|txt))$/;

const tokens = (cell) => Array.from(cell.matchAll(/`([^`]+)`/g), (match) => match[1]);

/**
 * The shell of every `run:` step under a job's `steps:` in a workflow, read by the file's
 * structure (keys by indentation, list items by their dash), so a job's name, a YAML
 * comment or any other string can never stand in for an actual run step.
 */
export function workflowRunSteps(yaml) {
  const lines = yaml.split("\n");
  const steps = [];
  /** The open mapping keys above the current line, as [indent, key]. */
  const open = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(#|$)/.test(line)) continue;
    let indent = /^ */.exec(line)[0].length;
    let rest = line.slice(indent);
    if (rest.startsWith("- ")) {
      indent += 2;
      rest = rest.slice(2);
    }
    while (open.length && open[open.length - 1][0] >= indent) open.pop();
    const key = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(rest);
    if (!key) continue;
    const [, name, value = ""] = key;
    const above = open.map(([, openKey]) => openKey);
    if (name === "run" && above[0] === "jobs" && above.includes("steps")) {
      if (/^[|>][-+]?\s*(#.*)?$/.test(value)) {
        const body = [];
        while (index + 1 < lines.length && (/^\s*$/.test(lines[index + 1]) || /^ */.exec(lines[index + 1])[0].length > indent)) {
          body.push(lines[index += 1]);
        }
        const margin = Math.min(...body.filter((text) => text.trim()).map((text) => /^ */.exec(text)[0].length), Infinity);
        steps.push(body.map((text) => text.slice(Math.min(margin, text.length))).join("\n").trim());
      } else steps.push(value.replace(/^(["'])(.*)\1$/, "$2"));
    }
    open.push([indent, name]);
  }
  return steps;
}

/** What a wiring line in the Repository contract workflow's step may start with. */
export const WORKFLOW_LEADS = new Set(["set", "export", "cd", "echo", "true", "npm", "npx", "node", "bin/verify-ship"]);
/** A character that gives a line shell semantics; a wiring line holds none. */
const OPERATOR = /[&|;`$'"(){}<>]/;
/** A `set -e` line, with or without other flags and pipefail. */
const SET_E = /^\s*set\s+-[a-z]*e[a-z]*(\s+(-o\s+)?pipefail)?\s*$/;
/** Shell comments and blank lines gone, the rest trimmed. */
const commandLines = (text) => text.split("\n").map((line) => line.replace(/(^|\s)#.*$/, "").trim()).filter(Boolean);
/** The line without a leading `VAR=value ` prefix. */
const bare = (line) => line.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");

/**
 * Why a shell text is not plain wiring that runs `command`, or null when it is. The rule leaves
 * no shell semantics to reason about: once shell comments and blank lines are gone, every line
 * is one bare command whose first word is in `leads` and that holds no operator character
 * (&, |, ;, a backtick, $, a quote, a bracket, < or >), and one line is exactly `command` or
 * `npx ` + `command`, after an optional leading `VAR=value ` prefix. So nothing can be
 * substituted, quoted, piped, redirected, backgrounded, or skipped behind `||` or `&&`.
 */
export function plainWiring(text, command, leads) {
  const lines = commandLines(text);
  if (lines.length === 0) return "it has no command";
  let found = false;
  for (const line of lines) {
    if (OPERATOR.test(line)) return `line "${line}" holds an operator`;
    const plain = bare(line);
    if (!leads.has(plain.split(/\s+/)[0])) return `line "${line}" does not start with one of ${[...leads].join(", ")}`;
    if (plain === command || plain === `npx ${command}`) found = true;
  }
  return found ? null : `no line is exactly "${command}"`;
}

/**
 * Why bin/verify-ship's quick tier does not run the map check, or null when it does: the
 * script declares `set -e` (any flags, pipefail or not) before its `quick)` case label, and
 * a line between that label and its `;;` is exactly `node scripts/check-feature-map.mjs`, so
 * the check cannot be skipped and its failure cannot be suppressed on that line.
 */
export function quickTierWiring(sh, command = "node scripts/check-feature-map.mjs") {
  const lines = sh.split("\n");
  const start = lines.findIndex((line) => /^\s*quick\)\s*$/.test(line));
  if (start < 0) return "it has no quick) tier";
  if (!lines.slice(0, start).some((line) => SET_E.test(line))) return 'no "set -e" is declared before its quick) tier';
  const end = lines.findIndex((line, at) => at > start && /^\s*;;\s*$/.test(line));
  const tier = commandLines(lines.slice(start + 1, end < 0 ? lines.length : end).join("\n"));
  if (tier.includes(command)) return null;
  const near = tier.find((line) => line.includes(command.split(/\s+/).pop()));
  return near ? `line "${near}" is not exactly "${command}"` : `no line in its quick) tier is exactly "${command}"`;
}

/** The map's one table as rows keyed by column, or why it cannot be read. */
export function parseFeatureMap(markdown) {
  const lines = markdown.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("|"));
  if (lines.length < 2) return { error: "FEATURE_MAP.md has no table" };
  const cells = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const header = cells(lines[0]);
  if (header.join(" | ") !== COLUMNS.join(" | ")) {
    return { error: `FEATURE_MAP.md columns must be: ${COLUMNS.join(" | ")} (found: ${header.join(" | ")})` };
  }
  if (!/^\|(\s*:?-+:?\s*\|)+$/.test(lines[1])) return { error: "FEATURE_MAP.md table has no separator row under its header" };
  const rows = [];
  for (const [index, line] of lines.slice(2).entries()) {
    const values = cells(line);
    if (values.length !== COLUMNS.length) {
      return { error: `FEATURE_MAP.md row ${index + 1} has ${values.length} cells, not ${COLUMNS.length}` };
    }
    rows.push(Object.fromEntries(COLUMNS.map((column, position) => [column, values[position]])));
  }
  return { rows };
}

async function walk(root, directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (SKIPPED.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(root, absolute)));
    else files.push(relative(root, absolute));
  }
  return files;
}

async function kind(root, path) {
  try {
    return (await stat(join(root, path))).isDirectory() ? "directory" : "file";
  } catch {
    return null;
  }
}

const read = async (root, path) => {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    return "";
  }
};

/** A row owns a file it names, or every file under a directory it names with its trailing slash. */
const owns = (path, file) => (path.endsWith("/") ? file.startsWith(path) : file === path);

export async function auditFeatureMap(root = repositoryRoot) {
  const findings = [];
  for (const required of REQUIRED_FILES) {
    if ((await kind(root, required)) !== "file") findings.push(`missing verification asset: ${required}`);
  }
  if ((await kind(root, "FEATURE_MAP.md")) !== "file") return findings;
  const parsed = parseFeatureMap(await read(root, "FEATURE_MAP.md"));
  if (parsed.error) {
    findings.push(parsed.error);
    return findings;
  }

  // The tiers bin/verify-ship accepts are its case labels.
  const verifier = await read(root, VERIFIER_SCRIPT);
  const tiers = new Set(Array.from(verifier.matchAll(/^\s*([a-z]+)\)\s*$/gm), (match) => match[1]));
  if (tiers.size === 0) findings.push(`${VERIFIER_SCRIPT} declares no tier (expected case labels such as quick) and full))`);
  const tierReason = quickTierWiring(verifier);
  if (tierReason) findings.push(`${VERIFIER_SCRIPT} no longer runs scripts/check-feature-map.mjs as a command in its quick tier: ${tierReason}`);
  const steps = workflowRunSteps(await read(root, PR_WORKFLOW));
  const stepReasons = steps.map((step, at) => {
    const reason = plainWiring(step, `${VERIFIER_SCRIPT} quick`, WORKFLOW_LEADS);
    return reason && `step ${at + 1}: ${reason}`;
  });
  if (stepReasons.every(Boolean)) {
    findings.push(`${PR_WORKFLOW} no longer runs ${VERIFIER_SCRIPT} in a run step of a job: ${stepReasons.join("; ") || "it has no run step"}`);
  }

  const ids = new Set();
  /** Owned path to the ids of the rows that claim it. */
  const owners = new Map();
  for (const [index, row] of parsed.rows.entries()) {
    const idTokens = tokens(row["Surface ID"]);
    const id = idTokens[0];
    const label = id && SURFACE_ID.test(id) ? id : `row ${index + 1}`;
    if (idTokens.length !== 1 || !SURFACE_ID.test(id) || row["Surface ID"] !== `\`${id}\``) {
      findings.push(`${label}: Surface ID must be one backticked dinkus.ship-<surface> id (found: ${row["Surface ID"]})`);
    } else if (ids.has(id)) findings.push(`${label}: duplicate surface id ${id}`);
    else ids.add(id);

    for (const column of ["Responsibility", "Driver actions", "Observable success states"]) {
      if (!row[column]) findings.push(`${label}: ${column} is empty`);
    }

    const owned = tokens(row["Owned paths"]);
    if (owned.length === 0) findings.push(`${label}: Owned paths names nothing`);
    for (const path of owned) {
      if (!TREE_PATH.test(path)) findings.push(`${label}: Owned paths holds something that is not a tree path: ${path}`);
      owners.set(path, [...(owners.get(path) ?? []), label]);
    }

    // Every tree path in every cell exists, written as a file, or as a directory with its slash.
    for (const column of COLUMNS.slice(1)) {
      for (const token of tokens(row[column])) {
        if (!TREE_PATH.test(token)) continue;
        const found = await kind(root, token);
        if (found === null) findings.push(`${label}: ${column} names a path the tree does not have: ${token}`);
        else if (found === "directory" && !token.endsWith("/")) findings.push(`${label}: ${column} names a directory without its trailing slash: ${token}`);
        else if (found === "file" && token.endsWith("/")) findings.push(`${label}: ${column} names a file as a directory: ${token}`);
      }
    }

    const command = VERIFIER_COMMAND.exec(tokens(row["Quick verifier"])[0] ?? "");
    if (!command || row["Quick verifier"] !== `\`${command[0]}\``) {
      findings.push(`${label}: Quick verifier must be one backticked bin/verify-ship <tier> command (found: ${row["Quick verifier"]})`);
    } else if (!tiers.has(command[1])) {
      findings.push(`${label}: Quick verifier tier "${command[1]}" is not one ${VERIFIER_SCRIPT} accepts (${[...tiers].join(", ") || "none"})`);
    }
  }
  if (parsed.rows.length === 0) findings.push("FEATURE_MAP.md has no surface rows");

  // Every file under a verified root has exactly one owner.
  let verified = 0;
  for (const rootDirectory of VERIFIED_ROOTS) {
    for (const file of (await walk(root, join(root, rootDirectory))).sort()) {
      verified += 1;
      const owning = [...new Set([...owners].filter(([path]) => owns(path, file)).flatMap(([, labels]) => labels))];
      if (owning.length === 0) findings.push(`no row owns ${file}`);
      else if (owning.length > 1) findings.push(`${file} is owned by more than one row: ${owning.join(", ")}`);
    }
  }

  return findings.length ? findings : Object.assign([], { surfaces: parsed.rows.length, verified });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = await auditFeatureMap();
  if (findings.length) {
    for (const finding of findings) console.error(`feature_map: ${finding}`);
    console.error(`feature_map=drift findings=${findings.length}`);
    process.exitCode = 1;
  } else {
    console.log(`feature_map=clean surfaces=${findings.surfaces} verified_files=${findings.verified}`);
  }
}
