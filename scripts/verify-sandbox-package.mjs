#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join("/tmp", "dinkuskit-ship-sandbox-"));

try {
  const manifest = await readFile(join(root, "emdash-plugin.jsonc"), "utf8");
  for (const required of ['"storage"', '"preferences"', '"indexes"', '"admin"']) {
    if (!manifest.includes(required)) throw new Error(`manifest is missing ${required}`);
  }

  await writeFile(join(temp, "package.json"), '{"private":true,"type":"module"}\n');
  const packed = JSON.parse((await run("npm", [
    "pack", "--json", "--pack-destination", temp,
  ], { cwd: root })).stdout);
  const tarball = join(temp, packed[0].filename);
  await run("npm", ["install", "--ignore-scripts", "--no-save", tarball], { cwd: temp });

  const installed = await import("@dinkuskit/ship");
  if (!installed.default?.routes?.admin) throw new Error("installed sandbox entry has no admin route");
  const installedManifest = await readFile(join(temp, "node_modules/@dinkuskit/ship/emdash-plugin.jsonc"), "utf8");
  if (!installedManifest.includes('"preferences"')) throw new Error("installed manifest lost storage contract");

  const runnerModule = process.env.EMDASH_SANDBOX_RUNNER_MODULE;
  if (!runnerModule) {
    console.error("SANDBOX_GATE=blocked");
    console.error("reason=EmDash 1.0.1 Node host exposes only NoopSandboxRunner");
    console.error("required=EMDASH_SANDBOX_RUNNER_MODULE exporting createSandboxRunner");
    console.error("package_install=passed");
    console.error("sandbox_execution=not_claimed");
    process.exitCode = 2;
  } else {
    const runner = await import(runnerModule.startsWith(".")
      ? pathToFileURL(resolve(root, runnerModule)).href
      : runnerModule);
    if (typeof runner.createSandboxRunner !== "function") {
      throw new Error(`${runnerModule} does not export createSandboxRunner`);
    }
    console.log("SANDBOX_GATE=runner-adapter-present");
    console.log("package_install=passed");
    console.log("runner_factory=passed");
    console.log("sandbox_execution=requires host db/options wiring");
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
