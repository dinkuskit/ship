import { verifySandboxBehavior } from "./verify-sandbox-behavior.mjs";
#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
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

  const installedEntry = pathToFileURL(join(
    temp,
    "node_modules",
    "@dinkuskit",
    "ship",
    "src",
    "plugin.js",
  )).href;
  const backendBytes = (await readFile(new URL(installedEntry))).byteLength;
  if (backendBytes > 128 * 1024) throw new Error("standard backend exceeds the 128 KiB bundle cap");
  console.log(`backend_bytes=${backendBytes};cap_bytes=131072`);
  const installed = await import(installedEntry);
  if (!installed.default?.routes?.admin) throw new Error("installed sandbox entry has no admin route");
  if (installed.default.routes.admin.permission !== "plugins:manage" ||
      installed.default.routes.settings?.permission !== "plugins:manage") {
    throw new Error("installed admin routes do not require plugins:manage");
  }
  console.log("insufficient_permission_contract=passed");
  const installedManifest = await readFile(join(temp, "node_modules/@dinkuskit/ship/emdash-plugin.jsonc"), "utf8");
  if (!installedManifest.includes('"preferences"')) throw new Error("installed manifest lost storage contract");

  const runnerModule = process.env.EMDASH_SANDBOX_RUNNER_MODULE;
  if (!runnerModule) {
    console.error("SANDBOX_GATE=blocked");
    console.error("reason=no supported EmDash runner configured");
    console.error("required=configure @emdash-cms/sandbox-workerd/sandbox with workerd");
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
    console.log("package_install=passed");
    console.log(`runner_module=${runnerModule}`);
    if (!process.env.EMDASH_SANDBOX_HOST_URL) {
      throw new Error("runner factory alone is not execution proof; set EMDASH_SANDBOX_HOST_URL");
    }
    const base = process.env.EMDASH_SANDBOX_HOST_URL.replace(/\/$/, "");
    const url = new URL(base);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) {
      throw new Error("sandbox proof requires an HTTP loopback host");
    }
    const hostDirectory = process.env.EMDASH_SANDBOX_HOST_DIR;
    if (!hostDirectory) throw new Error("set EMDASH_SANDBOX_HOST_DIR to verify the host-installed package identity");
    for (const { path: file } of packed[0].files) {
      const fresh = await readFile(join(temp, "node_modules/@dinkuskit/ship", file));
      const actual = await readFile(join(hostDirectory, "node_modules/@dinkuskit/ship", file));
      if (!fresh.equals(actual)) throw new Error(`host-installed package differs: ${file}`);
    }
    console.log(`package_sha256=${createHash("sha256").update(await readFile(tarball)).digest("hex")}`);
    console.log("host_installed_package=matched");
    await verifySandboxBehavior({ base, hostDirectory, root });
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
