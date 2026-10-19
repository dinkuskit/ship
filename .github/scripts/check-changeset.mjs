#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Every pull request carries a changeset (docs/tests/CI-only PRs use an
// empty one). While Ship is on 0.x, fixes are patch and everything else
// is minor; major is rejected until the 1.0.0 gate. See RELEASING.md.
const PACKAGE_NAME = "@dinkuskit/ship";
const ALLOWED_BUMPS = new Set(["patch", "minor"]);

export function parseChangeset(source) {
	const match = /^---\n([\s\S]*?)\n?---\n/.exec(source);
	if (!match) return { error: "missing frontmatter" };
	const body = match[1].trim();
	if (body === "") return { bumps: {} };
	const bumps = {};
	for (const line of body.split("\n")) {
		const entry = /^(?:"([^"]+)"|'([^']+)'|([^:]+)):\s*(\S+)\s*$/.exec(line.trim());
		if (!entry) return { error: `unparseable frontmatter line: ${line.trim()}` };
		bumps[(entry[1] ?? entry[2] ?? entry[3]).trim()] = entry[4];
	}
	return { bumps };
}

export function auditChangesets(files) {
	const findings = [];
	for (const { path, source } of files) {
		const parsed = parseChangeset(source);
		if (parsed.error) {
			findings.push(`${path}: ${parsed.error}`);
			continue;
		}
		for (const [name, bump] of Object.entries(parsed.bumps)) {
			if (name !== PACKAGE_NAME) findings.push(`${path}: unknown package ${name}`);
			else if (!ALLOWED_BUMPS.has(bump)) {
				findings.push(
					`${path}: bump "${bump}" is not allowed on 0.x (use patch for fixes, minor for everything else)`,
				);
			}
		}
	}
	return findings;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [baseSha, headSha, headRef] = process.argv.slice(2);
	if (headRef === "changeset-release/main") {
		console.log("Release pull request: changeset check not required.");
		process.exit(0);
	}
	if (!baseSha || !headSha) {
		console.error("usage: check-changeset.mjs <base-sha> <head-sha> [head-ref]");
		process.exit(2);
	}
	const changed = execFileSync(
		"git",
		["diff", "--name-only", "--diff-filter=A", `${baseSha}...${headSha}`],
		{ encoding: "utf8" },
	)
		.split("\n")
		.filter(Boolean);
	const changesetPaths = changed.filter(
		(path) => /^\.changeset\/[^/]+\.md$/.test(path) && path !== ".changeset/README.md",
	);
	if (changesetPaths.length === 0) {
		console.error(
			"::error::This pull request adds no changeset. Add one with `npx changeset`, or `npx changeset --empty` for docs/tests/CI-only changes.",
		);
		process.exit(1);
	}
	const findings = auditChangesets(
		changesetPaths.map((path) => ({ path, source: readFileSync(path, "utf8") })),
	);
	if (findings.length > 0) {
		for (const finding of findings) console.error(`::error::${finding}`);
		process.exit(1);
	}
	console.log(`Changeset check passed (${changesetPaths.length} changeset file(s)).`);
}
