#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Version script for changesets/action/version. Changesets owns
// package.json and CHANGELOG.md; the EmDash plugin CLI refuses to publish
// when emdash-plugin.jsonc disagrees with package.json, so the release PR
// keeps the manifest version in sync here.
export function syncPluginVersion(manifestSource, version) {
	const pattern = /"version":\s*"[^"]*"/;
	if (!pattern.test(manifestSource)) {
		throw new Error('emdash-plugin.jsonc has no "version" field to sync');
	}
	return manifestSource.replace(pattern, `"version": "${version}"`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	execFileSync("npx", ["changeset", "version"], { stdio: "inherit" });
	const manifest = JSON.parse(readFileSync("package.json", "utf8"));
	const pluginPath = "emdash-plugin.jsonc";
	const before = readFileSync(pluginPath, "utf8");
	const after = syncPluginVersion(before, manifest.version);
	if (after !== before) {
		writeFileSync(pluginPath, after);
		console.log(`Synced emdash-plugin.jsonc version to ${manifest.version}.`);
	}
}
