#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, copyFile, readdir, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { bundlePlugin } from "@emdash-cms/plugin-cli";
import { verifySandboxBehavior } from "./verify-sandbox-behavior.mjs";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const runRoot = join(root, "runs");
await mkdir(runRoot, { recursive: true });
const packet = await mkdtemp(join(runRoot, "registry-artifact-"));
const host = join(packet, "host");
const cap = { file: 131072, total: 262144, files: 20 };
const profile = JSON.parse(await readFile(join(root, "emdash-plugin.jsonc"), "utf8"));
// EmDash 1.2.0 src/registry/plugin-id.ts: r_ + first 16 base32 SHA-256 digits.
let bits = 0, value = 0, encoded = "";
for (const byte of createHash("sha256").update(`${profile.publisher}\n${profile.slug}`).digest()) {
  value = (value << 8) | byte; bits += 8;
  while (bits >= 5) { bits -= 5; encoded += "abcdefghijklmnopqrstuvwxyz234567"[(value >>> bits) & 31]; }
}
const pluginId = `r_${encoded.slice(0, 16)}`;
const artifact = await bundlePlugin({ dir: root, outDir: join(packet, "bundle") });
const extracted = join(packet, "artifact");
await mkdir(extracted);
await run("tar", ["-xzf", artifact.tarballPath, "-C", extracted]);
async function inventory(dir, prefix = "") {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    assert.ok(!item.isSymbolicLink(), "artifact must not contain symlinks");
    const name = `${prefix}${item.name}`;
    if (item.isDirectory()) result.push(...await inventory(join(dir, item.name), `${name}/`));
    else { assert.ok(item.isFile()); result.push({ name, bytes: (await stat(join(dir, item.name))).size }); }
  }
  return result;
}
const files = await inventory(extracted);
assert.ok(files.length <= cap.files);
for (const file of files) assert.ok(file.bytes <= cap.file, `${file.name} exceeds per-file cap`);
const total = files.reduce((sum, file) => sum + file.bytes, 0);
assert.ok(total <= cap.total);
assert.equal(createHash("sha256").update(await readFile(artifact.tarballPath)).digest("hex"), artifact.sha256);
const manifest = JSON.parse(await readFile(join(extracted, "manifest.json"), "utf8"));
assert.equal(manifest.id, profile.slug);
assert.equal(manifest.version, "0.0.0");
assert.deepEqual(manifest.capabilities, []);
assert.deepEqual(manifest.allowedHosts, []);
assert.deepEqual(manifest.storage, profile.storage);
assert.deepEqual(manifest.admin.pages, profile.admin.pages);
assert.deepEqual(manifest.routes.map(route => [route.name, route.permission, route.methods]), [
  ["admin", "plugins:manage", ["POST"]], ["settings", "plugins:manage", ["POST"]], ["status", "plugins:read", ["POST"]],
]);
const receipt = { pluginId, publisher: profile.publisher, slug: profile.slug, sha256: artifact.sha256,
  tarballBytes: artifact.tarballBytes, files, totalBytes: total, cap, host, signedRegistryInstallation: false };
await writeFile(join(packet, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(`proof_directory=${packet}`);
console.log(`artifact_sha256=${artifact.sha256};artifact_bytes=${artifact.tarballBytes}`);
console.log(`backend_bytes=${files.find(file => file.name === "backend.js").bytes};total_bytes=${total};files=${files.length}`);
if (process.argv.includes("--bundle-only")) {
 console.log("official_bundle=passed;installed_runtime=not_run");
 process.exit(0);
}


// Seed only the post-install local storage/state boundary. No npm Ship source,
// configured sandbox entry, external Registry, signature or publish is involved.
await mkdir(join(host, ".emdash/uploads"), { recursive: true });
await copyFile(join(root, "test-support/sandbox-host/package.json"), join(host, "package.json"));
await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: host });
await run(process.execPath, [join(host, "node_modules/emdash/dist/cli/index.mjs"), "init", "--database", ".emdash/proof.sqlite"], { cwd: host });
const prefix = join(host, ".emdash/uploads/registry", pluginId, manifest.version);
await mkdir(prefix, { recursive: true });
// The official installer replaces the manifest slug with the derived runtime ID.
await writeFile(join(prefix, "manifest.json"), JSON.stringify({ ...manifest, id: pluginId }));
await copyFile(join(extracted, "backend.js"), join(prefix, "backend.js"));
await run("python3", ["-c", `
import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
 db.execute("INSERT INTO _plugin_state (plugin_id,version,status,installed_at,activated_at,source,display_name,registry_publisher_did,registry_slug,mcp_tools_enabled) VALUES (?,?,?,datetime('now'),datetime('now'),?,?,?,?,?)",(sys.argv[2],"0.0.0","active","registry","DinkusKit Ship",sys.argv[3],sys.argv[4],0))
`, join(host, ".emdash/proof.sqlite"), pluginId, profile.publisher, profile.slug]);
await writeFile(join(host, "astro.config.mjs"), `import node from "@astrojs/node";
import react from "@astrojs/react";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { defineConfig } from "astro/config";
export default defineConfig({
 output: "server", adapter: node({ mode: "standalone" }),
 vite: { resolve: { dedupe: ["emdash", "@emdash-cms/blocks"] }, ssr: { noExternal: ["emdash", "@emdash-cms/admin", "@emdash-cms/blocks"] } },
 integrations: [react(), emdash({ database: sqlite({ url: "file:./.emdash/proof.sqlite" }),
 storage: local({ directory: "./.emdash/uploads", baseUrl: "/_emdash/api/media/file" }),
 sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox", registry: { aggregatorUrl: "http://127.0.0.1:9" } })],
});\n`);
const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const base = `http://127.0.0.1:${port}`;
const astroPackage = JSON.parse(await readFile(join(host, "node_modules/astro/package.json"), "utf8"));
const astroBin = resolve(host, "node_modules/astro", astroPackage.bin.astro);
let child, stopPromise, interrupted, output = "";
async function start() {
 if (interrupted) throw new Error(`interrupted by ${interrupted}`);
 child = spawn(process.execPath, [astroBin, "dev", "--host", "127.0.0.1", "--port", String(port)], { cwd: host, detached: true, env: { ...process.env, ASTRO_DEV_BACKGROUND: "1" }, stdio: ["ignore", "pipe", "pipe"] });
 child.stdout.on("data", chunk => { output += String(chunk); });
 child.stderr.on("data", chunk => { output += String(chunk); });
 const deadline = Date.now() + 60000;
 while (Date.now() < deadline) {
  if (child.exitCode !== null) throw new Error(`host exited ${child.exitCode}`);
  try { const response = await fetch(`${base}/_emdash/api/setup/status`); if (response.status < 500) { console.log(`registry_host_pid=${child.pid};url=${base}`); return; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
 }
 throw new Error("Registry host startup timed out");
}
async function stop() {
 if (stopPromise) return stopPromise;
 const owned = child;
 if (!owned) return;
 child = undefined;
 stopPromise = (async () => {
  const running = owned.exitCode === null && owned.signalCode === null;
  const exited = running ? new Promise(resolve => owned.once("exit", resolve)) : Promise.resolve();
  try { process.kill(-owned.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  const timer = setTimeout(() => {
   try { process.kill(-owned.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") console.error("Owned host cleanup failed"); }
  }, 5000);
  try { await exited; } finally { clearTimeout(timer); }
 })();
 try { await stopPromise; } finally { stopPromise = undefined; }
}
const handleSignal = signal => {
 if (interrupted) return;
 interrupted = signal;
 void stop().then(() => writeFile(join(packet, "host.log"), output)).finally(() => {
  process.exit(signal === "SIGINT" ? 130 : 143);
 });
};
process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);
try {
 await start();
 process.env.EMDASH_SANDBOX_PERMISSION_PROOF = "1";
 await verifySandboxBehavior({ base, hostDirectory: host, root, pluginId });
 assert.match(output, new RegExp(`Loaded registry plugin ${pluginId}:0.0.0`));
 await stop();
 await start();
 const bypass = await fetch(`${base}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`, { redirect: "manual" });
 const cookie = bypass.headers.get("set-cookie")?.split(";")[0];
 assert.ok(cookie);
 const response = await fetch(`${base}/_emdash/api/plugins/${pluginId}/admin`, { method: "POST", headers: { "Content-Type": "application/json", "X-EmDash-Request": "1", Cookie: cookie }, body: JSON.stringify({ page: "/settings", type: "page_load" }) });
 assert.equal(response.status, 200);
 const envelope = await response.json();
 assert.match(JSON.stringify(envelope.data), /Example City/);
 assert.match(JSON.stringify(envelope.data), /10001-1234/);
 receipt.registrySourceRuntime = "passed";
 receipt.restartPersistence = "passed";
 receipt.base = base;
 await writeFile(join(packet, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
 console.log(`registry_source_runtime=passed;restart_persistence=passed;plugin_id=${pluginId}`);
 console.log("signed_registry_installation=not_claimed;provider_requests=none");
} finally {
 await stop();
 await writeFile(join(packet, "host.log"), output);
 process.off("SIGINT", handleSignal);
 process.off("SIGTERM", handleSignal);
}
