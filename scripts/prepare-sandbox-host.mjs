#!/usr/bin/env node
import { mkdir, copyFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = resolve(root, "runs/sandbox-host-local/host");
await mkdir(join(host, ".artifacts"), { recursive: true });
await mkdir(join(host, "src"), { recursive: true });
await mkdir(join(host, ".emdash/uploads"), { recursive: true });
for (const file of ["package.json", "astro.config.mjs"]) {
  await copyFile(join(root, "test-support/sandbox-host", file), join(host, file));
}
const packed = JSON.parse((await run("npm", ["pack", "--json", "--pack-destination", join(host, ".artifacts")], { cwd: root })).stdout);
const original = join(host, ".artifacts", packed[0].filename);
const digest = createHash("sha256").update(await readFile(original)).digest("hex");
const artifact = join(host, ".artifacts", `ship-${digest}.tgz`);
await copyFile(original, artifact);
await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", artifact], { cwd: host });
await run(process.execPath, [join(host, "node_modules/emdash/dist/cli/index.mjs"), "init", "--database", ".emdash/proof.sqlite"], { cwd: host });
console.log(`package_sha256=${digest}`);
console.log(`host_directory=${host}`);
console.log("Start in that directory: npm run dev");
console.log("Local config-managed sandbox install only; no Registry release or provider requests.");
