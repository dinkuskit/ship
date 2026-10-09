#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { bundlePlugin } from "@emdash-cms/plugin-cli";

import { fixturePdf } from "../test-support/private-assets/src/pdf.js";
const run = promisify(execFile);
const providerMode = process.argv.includes("--provider-link");
const serve = process.argv.includes("--serve");
if (process.argv.slice(2).some(arg => !["--provider-link", "--serve"].includes(arg)) || (serve && !providerMode)) throw new Error("Usage: verify-private-assets.mjs [--provider-link [--serve]]");
const root = resolve(import.meta.dirname, "..");
const fixture = join(root, "test-support/private-assets");
const runRoot = join(root, "runs/private-asset-qualification-runs");
await mkdir(runRoot, { recursive: true });
const packet = await mkdtemp(join(runRoot, "probe-"));
console.log(`proof_directory=${packet}`);
const host = join(packet, "host");
const state = join(packet, "STATE.md");
const events = join(packet, "events.jsonl");
const heartbeat = join(packet, "heartbeat");
const proof = join(packet, "PROOF.md");


await mkdir(join(host, ".emdash/uploads"), { recursive: true });
await mkdir(join(packet, "bundle"), { recursive: true });
await copyFile(join(root, "test-support/sandbox-host/package.json"), join(host, "package.json"));
await run("npm", ["install", "--package-lock=false", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: fixture, maxBuffer: 20 * 1024 * 1024,
});
await run("npm", ["install", "--package-lock=false", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: host, maxBuffer: 20 * 1024 * 1024,
});
await run("npm", ["install", "--force", "--ignore-scripts", "--no-save", "--no-audit", "--no-fund",
  "@bruits/satteri-wasm32-wasi@0.10.5", "@astrojs/compiler-binding-wasm32-wasi@0.4.1"], {
  cwd: host, maxBuffer: 20 * 1024 * 1024,
});

const artifact = await bundlePlugin({ dir: fixture, outDir: join(packet, "bundle") });
const extracted = join(packet, "artifact");
await mkdir(extracted, { recursive: true });
await run("tar", ["-xzf", artifact.tarballPath, "-C", extracted]);
const profile = JSON.parse(await readFile(join(fixture, "emdash-plugin.jsonc"), "utf8"));
const manifest = JSON.parse(await readFile(join(extracted, "manifest.json"), "utf8"));
const backend = await readFile(join(extracted, "backend.js"));
const pluginId = (() => {
  let bits = 0;
  let value = 0;
  let encoded = "";
  for (const byte of createHash("sha256").update(`${profile.publisher}\n${profile.slug}`).digest()) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += "abcdefghijklmnopqrstuvwxyz234567"[(value >>> bits) & 31];
    }
  }
  return `r_${encoded.slice(0, 16)}`;
})();

await run(process.execPath, [
  join(host, "node_modules/emdash/dist/cli/index.mjs"),
  "init", "--database", ".emdash/proof.sqlite",
], { cwd: host });
const installDir = join(host, ".emdash/uploads/registry", pluginId, manifest.version);
await mkdir(installDir, { recursive: true });
await writeFile(join(installDir, "manifest.json"), JSON.stringify({ ...manifest, id: pluginId }));
await writeFile(join(installDir, "backend.js"), backend);
await run("python3", ["-c", `
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
 db.execute("INSERT INTO _plugin_state (plugin_id,version,status,installed_at,activated_at,source,display_name,registry_publisher_did,registry_slug,mcp_tools_enabled) VALUES (?,?,?,datetime('now'),datetime('now'),?,?,?,?,?)",(sys.argv[2],"0.0.0","active","registry","Private asset qualification fixture",sys.argv[3],sys.argv[4],0))
`, join(host, ".emdash/proof.sqlite"), pluginId, profile.publisher, profile.slug]);

await writeFile(join(host, "astro.config.mjs"), `import node from "@astrojs/node";
import react from "@astrojs/react";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { defineConfig } from "astro/config";
export default defineConfig({
  output: "server",
  vite: { resolve: { dedupe: ["emdash", "@emdash-cms/blocks"] },
    ssr: { noExternal: ["emdash", "@emdash-cms/admin", "@emdash-cms/blocks"] } },
  server: { host: "127.0.0.1", port: Number(process.env.PORT), strictPort: true },
  adapter: node({ mode: "standalone" }),
  integrations: [react(), emdash({
    database: sqlite({ url: "file:./.emdash/proof.sqlite" }),
    storage: local({ directory: "./.emdash/uploads", baseUrl: "/_emdash/api/media/file" }),
    sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
    registry: { aggregatorUrl: "http://127.0.0.1:9" },
  })],
});\n`);

const probe = createServer();
await new Promise(resolveProbe => probe.listen(0, "127.0.0.1", resolveProbe));
const port = probe.address().port;
await new Promise((resolveClose, reject) => probe.close(error => error ? reject(error) : resolveClose()));
const base = `http://127.0.0.1:${port}`;
const astro = JSON.parse(await readFile(join(host, "node_modules/astro/package.json"), "utf8"));
const astroBin = typeof astro.bin === "string" ? astro.bin : astro.bin.astro;
const child = spawn(process.execPath, [join(host, "node_modules/astro", astroBin), "dev"], {
  cwd: host, detached: true, stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env, PORT: String(port), ASTRO_DEV_BACKGROUND: "0", NAPI_RS_FORCE_WASI: "true",
  },
});
let output = "";
child.stdout.on("data", chunk => { output = (output + String(chunk)).slice(-8000); });
child.stderr.on("data", chunk => { output = (output + String(chunk)).slice(-8000); });

async function stop() {
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : new Promise(resolveExit => child.once("exit", resolveExit));
  try { process.kill(-child.pid, "SIGTERM"); } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([exited, new Promise(resolveTimeout => setTimeout(resolveTimeout, 5000))]);
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
}

const http = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
const route = suffix => `${base}/_emdash/api/plugins/${pluginId}/${suffix}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`host exited ${child.exitCode}: ${output.slice(-4000)}`);
    try {
      const response = await http(`${base}/_emdash/api/setup/status`, { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) { ready = true; break; }
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  assert.equal(ready, true, `host startup timed out: ${output.slice(-2000)}`);
  const bypass = await http(`${base}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`);
  const cookie = bypass.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "local fixture session was not issued");
  const auth = { Cookie: cookie, "X-EmDash-Request": "1" };
  const admin = await http(route("admin"), {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ page: "/proof", type: "page_load" }),
  });
  const adminText = await admin.text();
  assert.equal(admin.status, 200, adminText);
  const response = JSON.parse(adminText);
  const link = response.data.blocks.find(block => block.type === "actions")
    ?.elements?.find(element => element.type === "link");
  assert.equal(link?.target?.url, `${base}/_emdash/api/plugins/${pluginId}/private-pdf`);

  if (providerMode) {
    const post = async (suffix, input, headers = auth) => {
      const result = await http(route(suffix), { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(input) });
      return { status: result.status, body: await result.text() };
    };
    assert.equal((await post("seed-provider-proof", {})).status, 200);
    const pageInput = { page: "/provider-proof", type: "page_load" };
    const page = await post("admin", pageInput);
    assert.equal(page.status, 200);
    const target = JSON.parse(page.body).data.blocks.find(block => block.type === "actions")?.elements[0]?.target;
    assert.deepEqual(target, { kind: "external", url: "https://stg-labels-cls.gcs.pitneybowes.com/usps/fixture/outbound/label/fixture.pdf" });
    assert.equal((await post("admin", pageInput, {})).status, 401);
    assert.equal((await post("admin", pageInput, { Cookie: cookie })).status, 403);
    const wrong = await post("admin", { ...pageInput, values: { orderId: "wrong-order", url: "https://example.test" } });
    assert.equal(wrong.body.includes("stg-labels"), false);
    assert.equal((await post("admin", pageInput)).body, page.body, "read changed fixture state");
    await post("seed-provider-proof", { expired: true });
    const expired = await post("admin", pageInput);
    assert.equal(expired.body.includes("stg-labels"), false);
    assert.match(expired.body, /unavailable or expired/);
    await post("seed-provider-proof", {});
    await writeFile(join(packet, "provider-link.json"), JSON.stringify({
      cliArtifactSha256: artifact.sha256, linkTarget: "exact synthetic PB-shaped URL",
      unsignedRegistrySourceRuntime: "passed", missingSession: 401, missingCsrf: 403,
      wrongOrder: "no link", expired: "no link", repeatRead: "unchanged",
      signedInstall: false, normalSignin: false, livePb: false, browserAcceptance: false,
    }, null, 2));
    console.log("provider_link_registry_source_runtime=passed;signed_install=false;live_pb=false");
  }

  const expected = fixturePdf();
  await writeFile(join(packet, "expected.pdf"), expected);
  const request = { headers: auth, signal: AbortSignal.timeout(15000) };
  const deniedHeader = await http(route("private-pdf"), {
    headers: { Cookie: cookie },
  });
  assert.equal(deniedHeader.status, 403);
  const deniedSession = await http(route("private-pdf"), {
    headers: { "X-EmDash-Request": "1" },
  });
  assert.equal(deniedSession.status, 401);
  const raw = await http(route("private-pdf"), request);
  const pdf = new Uint8Array(await raw.arrayBuffer());
  assert.equal(raw.status, 200, `raw route failed: ${raw.status}`);
  assert.deepEqual(pdf, expected, "private response must preserve every PDF byte");
  const headers = raw;
  assert.equal(headers.headers.get("content-type"), "application/pdf");
  assert.equal(headers.headers.get("cache-control"), "private, no-store");
  assert.equal(headers.headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.headers.get("content-security-policy"), "sandbox; default-src 'none'");
  const browserNavigation = await http(new URL(link.target.url, base), { headers: { Cookie: cookie } });
  assert.equal(browserNavigation.status, 403);

  const repeat = new Uint8Array(await (await http(route("private-pdf"), request)).arrayBuffer());
  assert.deepEqual(repeat, pdf, "repeated retrieval changed bytes");
  await writeFile(join(packet, "received.pdf"), pdf);
  const result = {
    pluginId,
    artifactSha256: artifact.sha256,
    artifactBytes: artifact.tarballBytes,
    exactPdfSha256: createHash("sha256").update(pdf).digest("hex"),
    authenticatedRawTransport: "exact",
    expectedBytes: expected.length, receivedBytes: pdf.length,
    expectedSha256: createHash("sha256").update(expected).digest("hex"),
    sandboxHttpBody: "exact",
    repeatedRetrieval: "exact",
    nodeVersion: process.version,
    emdash: "1.2.0", sandboxWorkerd: "0.9.3", workerd: "1.20261001.1",
    session: "local-dev-bypass",
    installation: "seeded-post-install-state",
    missingRequestHeader: "403",
    missingSession: "401",
    blockKitLinkNavigation: "403",
    realSignedRegistryInstall: "not-executed",
    browserAcceptance: "not-executed",
  };
  const now = new Date().toISOString();
  await appendFile(events, JSON.stringify({ at: now, event: "qualification", result }) + "\n");
  await writeFile(heartbeat, `${now}\n`);
  await writeFile(join(packet, "receipt.json"), JSON.stringify(result, null, 2) + "\n");
  await writeFile(state, `Runtime probe complete; byte transport: ${result.authenticatedRawTransport}. Registry install and browser acceptance NOT EXECUTED.\n`);
  await writeFile(proof, `Official bundle + seeded post-install EmDash 1.2.0/workerd runtime. Dev-bypass synthetic session only. Expected ${expected.length} bytes; received ${pdf.length}. CSRF/session denials and security headers asserted. See receipt.json. No browser, signed Registry install, provider, or physical printing proof.\n`);
  console.log(JSON.stringify(result));
  if (serve) {
    console.log(`PROVIDER_PREVIEW=${base}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin/plugins/${pluginId}/provider-proof`);
    console.log("Type any line to stop this owned preview.");
    process.stdin.resume();
    await new Promise(resolve => process.stdin.once("data", resolve));
    process.stdin.pause();
  }

} catch (error) {
  await writeFile(state, "FAILED: runtime probe did not qualify; see failure.json.\n");
  await writeFile(join(packet, "failure.json"), JSON.stringify({ error: error.message }, null, 2) + "\n");
  throw error;
} finally {
  await stop();
}
