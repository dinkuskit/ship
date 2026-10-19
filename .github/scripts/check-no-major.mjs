#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 1.0.0 gate (GrillTrack release-1-0-gate-063 in dinkuskit/dinkuskit):
// Ship stays on 0.x until coupons, inventory, commerce, payments and
// ship have all landed. Removing this check is the explicit 1.0 decision.
export function findMajorViolation(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version ?? "");
	if (!match) return `unparseable package version: ${JSON.stringify(version)}`;
	if (Number.parseInt(match[1], 10) >= 1) {
		return `package version ${version} reaches >=1.0.0 before the 1.0.0 gate`;
	}
	return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const manifest = JSON.parse(readFileSync("package.json", "utf8"));
	const violation = findMajorViolation(manifest.version);
	if (violation) {
		console.error(`::error::${violation}. A new major needs a deliberate change to this check.`);
		process.exit(1);
	}
	console.log(`Checked ${manifest.name}@${manifest.version}: stays on 0.x.`);
}
