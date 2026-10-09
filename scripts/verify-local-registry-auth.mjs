#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { bundlePlugin } from "@emdash-cms/plugin-cli";
import { computeMultihash } from "@emdash-cms/registry-verification/checksum";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const fixture = join(root, "test-support/private-assets");
const runRoot = join(root, "runs/local-registry-auth-runs");
if (process.argv.length > 2) throw new Error("Usage: verify-local-registry-auth.mjs");
await mkdir(runRoot, { recursive: true });
const packet = await mkdtemp(join(runRoot, "run-"));
const host = join(packet, "host");
const bundleDir = join(packet, "bundle");
await mkdir(host, { recursive: true });

const nodeVersion = process.version;
const profile = JSON.parse(await readFile(join(fixture, "emdash-plugin.jsonc"), "utf8"));
const artifact = await bundlePlugin({ dir: fixture, outDir: bundleDir });
const artifactBytes = new Uint8Array(await readFile(artifact.tarballPath));
const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
assert.equal(artifactSha256, artifact.sha256);
const checksum = await computeMultihash(artifactBytes);
assert.equal(checksum.success, true);
const version = "0.0.0";
const publisherDid = profile.publisher;
const packageSlug = profile.slug;
const profileCid = "bafyreigh2akiscaildc4mscz4uzpcbap5jxg26eecmrf6cmnvkzkjmoixe";
const releaseCid = "bafyreic3z2zsc6hr3xnjg5z5vixd7baqfk7x3h5cxqv4hqe7dxr5zxmtnu";
const profileNsid = "com.emdashcms.experimental.package.profile";
const releaseNsid = "com.emdashcms.experimental.package.release";
const releaseExtensionNsid = "com.emdashcms.experimental.package.releaseExtension";

const profileRecord = {
  $type: profileNsid,
  id: `at://${publisherDid}/${profileNsid}/${packageSlug}`,
  slug: packageSlug,
  type: "emdash-plugin",
  name: profile.name,
  license: profile.license,
  authors: [{ name: profile.author.name }],
  security: [{ url: profile.securityContacts[0].url }],
  extensions: {
    "com.emdashcms.experimental.package.profileExtension": {
      $type: "com.emdashcms.experimental.package.profileExtension",
      repository: "https://github.com/dinkuskit/ship",
      releasePolicy: { requireProvenance: false, confirmation: "escalation-only", approvers: [publisherDid] },
    },
  },
};
const releaseRecord = {
  $type: releaseNsid,
  package: packageSlug,
  version,
  artifacts: {
    package: {
      url: "REPLACED_ARTIFACT_URL",
      checksum: checksum.value,
    },
  },
  extensions: {
    [releaseExtensionNsid]: {
      $type: releaseExtensionNsid,
      declaredAccess: {},
    },
  },
};

let artifactUrl;
const registry = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url.pathname === "/health") return json(res, { status: "ok" });
  if (url.pathname === "/registry/fixture.tgz") {
    res.writeHead(200, { "Content-Type": "application/gzip" });
    res.end(artifactBytes);
    return;
  }
  if (
    url.pathname === "/xrpc/com.emdashcms.experimental.aggregator.getPackage" ||
    url.pathname === "/xrpc/com.emdashcms.experimental.aggregator.resolvePackage"
  ) {
    return json(res, {
      uri: `at://${publisherDid}/${profileNsid}/${packageSlug}`,
      cid: profileCid,
      did: publisherDid,
      slug: packageSlug,
      handle: "local-registry.example",
      profile: profileRecord,
      latestVersion: version,
      indexedAt: "2026-01-01T00:00:00.000Z",
      labels: [],
    });
  }
  if (
    url.pathname === "/xrpc/com.emdashcms.experimental.aggregator.listReleases" ||
    url.pathname === "/xrpc/com.emdashcms.experimental.aggregator.getLatestRelease"
  ) {
    return json(res, {
      uri: `at://${publisherDid}/${releaseNsid}/${packageSlug}:${version}`,
      cid: releaseCid,
      did: publisherDid,
      package: packageSlug,
      version,
      release: { ...releaseRecord, artifacts: { package: { ...releaseRecord.artifacts.package, url: artifactUrl } } },
      artifactCaches: [],
      indexedAt: "2026-01-01T00:00:00.000Z",
      labels: [],
      ...(url.pathname.endsWith("listReleases") ? { releases: [{
        uri: `at://${publisherDid}/${releaseNsid}/${packageSlug}:${version}`,
        cid: releaseCid, did: publisherDid, package: packageSlug, version,
        release: { ...releaseRecord, artifacts: { package: { ...releaseRecord.artifacts.package, url: artifactUrl } } },
        artifactCaches: [], indexedAt: "2026-01-01T00:00:00.000Z", labels: [],
      }] } : {}),
    });
  }
  return json(res, { error: "not found" }, 404);
});
function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
await new Promise((resolveListen) => registry.listen(0, "127.0.0.1", resolveListen));
registry.unref();
const registryPort = registry.address().port;
const registryBase = `http://127.0.0.1:${registryPort}`;
artifactUrl = `${registryBase}/registry/fixture.tgz`;

await writeFile(join(packet, "registry-fixture.json"), JSON.stringify({
  publisherDid, packageSlug, profileCid, profile: profileRecord,
  version, releaseCid, release: { ...releaseRecord, artifacts: { package: { ...releaseRecord.artifacts.package, url: artifactUrl } } },
}, null, 2));
await writeFile(join(host, "package.json"), JSON.stringify({
  type: "module",
  dependencies: {
    "@astrojs/node": "11.1.6", "@astrojs/react": "6.0.5",
    "@emdash-cms/sandbox-workerd": "0.9.3", astro: "7.3.2",
    emdash: "1.2.0", react: "19.2.0", "react-dom": "19.2.0", workerd: "1.20261001.1",
    playwright: "1.64.0",
  },
}, null, 2));
await mkdir(join(host, ".emdash/uploads"), { recursive: true });
await run("npm", ["install", "--package-lock=false", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: host });
await run(join(host, "node_modules/.bin/playwright"), ["install", "chromium"], { cwd: host, maxBuffer: 20 * 1024 * 1024 });
await run("npx", ["--yes", "--package=node@22", "node", join(host, "node_modules/emdash/dist/cli/index.mjs"), "init", "--database", ".emdash/local.sqlite"], { cwd: host });

await writeFile(join(host, "astro.config.mjs"), `
import { readFileSync } from "node:fs";
import node from "@astrojs/node";
import react from "@astrojs/react";
import emdash, { local } from "emdash/astro";
import { installRegistryAuthoritativeFixture } from "emdash/internal/testing/registry";
import { sqlite } from "emdash/db";
installRegistryAuthoritativeFixture(JSON.parse(readFileSync(process.env.EMDASH_REGISTRY_FIXTURE, "utf8")));
export default {
  output: "server",
  adapter: node({ mode: "standalone" }),
  vite: { resolve: { dedupe: ["emdash", "@emdash-cms/blocks"] }, ssr: { noExternal: ["emdash", "@emdash-cms/admin", "@emdash-cms/blocks"] } },
  server: { host: "127.0.0.1", port: Number(process.env.PORT), strictPort: true },
  integrations: [react(), emdash({
    database: sqlite({ url: "file:./.emdash/local.sqlite" }),
    storage: local({ directory: "./.emdash/uploads", baseUrl: "/_emdash/api/media/file" }),
    sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
    registry: process.env.EMDASH_REGISTRY_URL,
  })],
};
`);

let hostPort;
const probe = createServer();
await new Promise((resolveListen) => probe.listen(0, "127.0.0.1", resolveListen));
hostPort = probe.address().port;
await new Promise((resolveClose) => probe.close(resolveClose));
const base = `http://localhost:${hostPort}`;
const astro = JSON.parse(await readFile(join(host, "node_modules/astro/package.json"), "utf8"));
const astroBin = typeof astro.bin === "string" ? astro.bin : astro.bin.astro;
const child = spawn(process.execPath, [join(host, "node_modules/astro", astroBin), "dev"], {
  cwd: host, detached: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(hostPort), NAPI_RS_FORCE_WASI: "true",
    EMDASH_REGISTRY_URL: registryBase, EMDASH_REGISTRY_FIXTURE: join(packet, "registry-fixture.json") },
});
let hostOutput = "";
child.stdout.on("data", (chunk) => { hostOutput = (hostOutput + chunk).slice(-12000); });
child.stderr.on("data", (chunk) => { hostOutput = (hostOutput + chunk).slice(-12000); });
const stop = async () => {
  if (child.exitCode === null) {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    await Promise.race([new Promise(resolveExit => child.once("exit", resolveExit)), new Promise(resolveExit => setTimeout(resolveExit, 3000))]);
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  }
};
const http = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
const receipt = {
  node: nodeVersion, emdash: "1.2.0", sandboxWorkerd: "0.9.3", workerd: "1.20261001.1",
  artifactSha256, artifactBytes: artifactBytes.length, artifactChecksum: checksum.value, registry: "loopback-only",
  authoritativeRecords: "local-test-hook", provenance: "not-exercised", publicPublication: false,
  pluginCli: JSON.parse(await readFile(join(root, "node_modules/@emdash-cms/plugin-cli/package.json"), "utf8")).version,
  playwright: JSON.parse(await readFile(join(host, "node_modules/playwright/package.json"), "utf8")).version,
  providerRequests: 0, pbUrlOpened: false, credentialsInspected: false,
  screenshots: [], statuses: {},
};
let network = [];
let browser;
let page;
const pageErrors = [];
const consoleErrors = [];
const blockedRequests = [];
try {
  let ready = false;
  for (let i = 0; i < 240; i++) {
    try { const response = await http(`${base}/_emdash/api/setup/status`, { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) { ready = true; break; }
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  assert.equal(ready, true, `host startup timed out: ${hostOutput}`);
  const { chromium } = await import(join(host, "node_modules/playwright/index.mjs"));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if ([base, registryBase].includes(url.origin)) return route.continue();
    blockedRequests.push({ host: url.hostname, method: route.request().method() });
    return route.abort("blockedbyclient");
  });
  page = await context.newPage();
  page.on("console", msg => { if(msg.type() === "error") consoleErrors.push(msg.text().replace(/https?:\/\/[^\s]+/g, "[url]")); });
  page.on("pageerror", error => pageErrors.push(error.message.replace(/https?:\/\/[^\s]+/g, "[url]")));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  }});
  await page.goto(`${base}/_emdash/admin`);
  await page.getByLabel("Site Title").fill("Local Registry Auth");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your Email").fill("local-registry@example.test");
  await page.getByLabel("Your Name").fill("Local Registry User");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create passkey" }).click();
  await page.getByRole("heading", { name: "Passkey created" }).waitFor({ state: "visible", timeout: 60000 });
  await page.screenshot({ path: join(packet, "passkey-created.png"), fullPage: true });
  receipt.screenshots.push("passkey-created.png");
  await page.getByRole("button", { name: "Open the dashboard" }).click();
  // A setup-created session must not stand in for ordinary passkey login.
  const setupLogout = await page.request.post(`${base}/_emdash/api/auth/logout`, {
    headers: { "X-EmDash-Request": "1", Origin: base },
  });
  receipt.statuses.setupLogout = setupLogout.status();
  assert.ok([200, 204, 401].includes(setupLogout.status()));
  const beforeLogin = await page.request.get(`${base}/_emdash/api/admin/plugins`);
  receipt.statuses.beforeFreshLogin = beforeLogin.status();
  assert.equal(beforeLogin.status(), 401);
  await page.goto(`${base}/_emdash/admin/login?redirect=%2F_emdash%2Fadmin`);
  await page.getByRole("button", { name: /passkey/i }).first().click();
  receipt.authentication = "fresh-passkey-login-after-explicit-logout";
  await page.waitForURL(/\/_emdash\/admin\/?$/);
  await page.getByRole("button", { name: "Get Started", exact: true }).click({ timeout: 30000 });
  await page.screenshot({ path: join(packet, "setup-passkey.png"), fullPage: true });
  receipt.screenshots.push("setup-passkey.png");

  const adminPlugins = await page.request.get(`${base}/_emdash/api/admin/plugins`);
  receipt.statuses.adminPlugins = adminPlugins.status();
  assert.equal(adminPlugins.status(), 200);
  await page.addInitScript((did) => {
    localStorage.setItem(`emdash:did-handle:${did}`, JSON.stringify({
      resolution: { status: "missing" }, expiresAt: Date.now() + 60000,
    }));
  }, publisherDid);
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.includes("node_modules") && !url.pathname.startsWith("/@")) {
      network.push({ method: response.request().method(), path: url.pathname, status: response.status() });
    }
  });
  await page.goto(`${base}/_emdash/admin/plugins/registry/${publisherDid}/${packageSlug}`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(packet, "registry-page.png"), fullPage: true });
  receipt.screenshots.push("registry-page.png");
  const verification = page.waitForResponse(r => r.url().endsWith("/plugins/registry/verify") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Install", exact: true }).click();
  receipt.statuses.verify = (await verification).status();
  assert.equal(typeof receipt.statuses.verify, "number", `verify request missing: ${JSON.stringify(network)}`);
  assert.equal(receipt.statuses.verify, 200);
  const consent = page.getByRole("dialog", { name: "Capability consent" });
  const installation = page.waitForResponse(r => r.url().endsWith("/plugins/registry/install") && r.request().method() === "POST");
  await consent.getByRole("button", { name: "Accept & Install" }).click();
  receipt.statuses.install = (await installation).status();
  assert.equal(typeof receipt.statuses.install, "number", `install request missing: ${JSON.stringify(network)}`);
  assert.equal(receipt.statuses.install, 201);
  await page.screenshot({ path: join(packet, "installed.png"), fullPage: true });
  receipt.screenshots.push("installed.png");

  const installedBody = await (await page.request.get(`${base}/_emdash/api/admin/plugins`)).json();
  const installed = installedBody.data.items.find((item) => item.source === "registry" && item.registrySlug === packageSlug);
  assert.ok(installed?.id?.startsWith("r_"));
  receipt.pluginId = installed.id;
  const pluginRoute = `${base}/_emdash/api/plugins/${installed.id}`;
  const csrf = { "X-EmDash-Request": "1", Origin: base };
  const seed = await page.request.post(`${pluginRoute}/seed-provider-proof`, { headers: csrf, data: {} });
  receipt.statuses.seed = seed.status();
  assert.equal(seed.status(), 200);
  await page.goto(`${base}/_emdash/admin/plugins/${installed.id}/provider-proof`);
  await assertPageText(page, "Provider PDF link qualification");
  const link = page.getByRole("link", { name: "View label", exact: true });
  assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
  assert.equal(await link.count(), 1);
  assert.match(await link.getAttribute("href"), /^https:\/\/stg-labels-cls\.gcs\.pitneybowes\.com\//);
  assert.equal(await link.getAttribute("target"), "_blank");
  receipt.providerProof = { source: "registry", rel: "noopener noreferrer", inertHrefInspected: true };
  await page.screenshot({ path: join(packet, "provider-proof.png"), fullPage: true });
  receipt.screenshots.push("provider-proof.png");
  const expired = await page.request.post(`${pluginRoute}/seed-provider-proof`, { headers: csrf, data: { expired: true } });
  assert.equal(expired.status(), 200);
  await page.reload();
  await assertPageText(page, "unavailable or expired");
  assert.equal(await page.locator('a[href^="https://stg-labels-cls.gcs.pitneybowes.com/"]').count(), 0);
  receipt.expiry = "absent link and unavailable text";
  await page.screenshot({ path: join(packet, "expired.png"), fullPage: true });
  receipt.screenshots.push("expired.png");
  const logout = await page.request.post(`${base}/_emdash/api/auth/logout`, { headers: csrf });
  assert.equal(logout.ok(), true);
  const denied = await page.request.post(`${pluginRoute}/admin`, { headers: csrf, data: { page: "/provider-proof", type: "page_load" } });
  receipt.statuses.afterLogout = denied.status();
  assert.equal(denied.status(), 401);
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  await browser.close();
  assert.deepEqual(blockedRequests, [], "No external browser request may be attempted");
  receipt.result = "passed";
} catch (error) {
  receipt.result = "failed";
  receipt.failure = (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, "");
  if (page) await page.screenshot({ path: join(packet, "failure.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  receipt.network = network;
  receipt.pageErrors = pageErrors;
  receipt.consoleErrors = consoleErrors;
  receipt.blockedRequests = blockedRequests;
  await browser?.close();
  await writeFile(join(packet, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");

  await stop();
  await new Promise((resolveClose) => registry.close(resolveClose));
  console.log(`proof_directory=${packet}`);
  console.log(JSON.stringify(receipt));
}

async function assertPageText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
}
