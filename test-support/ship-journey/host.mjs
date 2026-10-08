import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  cleanupDisposableRun,
  createDisposableRun,
  installPackedPackage,
} from "./package-install.mjs";
import { journeyEntrySource, writeFixtureState } from "./journey-fixture.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sandboxHost = join(root, "test-support", "sandbox-host");

export async function prepareInstalledEmdashHost({ repoRoot = root, onInterrupted = async () => {} } = {}) {
  const runDirectory = await createDisposableRun(join(tmpdir(), "ship-journey-host-"));
  const hostDirectory = join(runDirectory, "host");
  const host = { runDirectory, hostDirectory };
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    await stopJourneyHost(host);
    await cleanupDisposableRun(runDirectory);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  })();
  host.cleanup = cleanup;
  let interruption;
  const interrupt = signal => interruption ??= (async () => {
    let failed = false;
    try { await onInterrupted(signal, "running"); } catch { failed = true; }
    try { await cleanup(); } catch { failed = true; }
    try { await onInterrupted(signal, failed ? "failed" : "passed"); } catch { failed = true; }
    if (!failed) console.log(`host_cleanup=interrupted:${signal}`);
    process.exit(failed ? 1 : signal === "SIGINT" ? 130 : 143);
  })();
  const onInterrupt = () => interrupt("SIGINT");
  const onTerminate = () => interrupt("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try {
    await mkdir(join(hostDirectory, ".emdash", "uploads"), { recursive: true });
    await copyFile(join(sandboxHost, "package.json"), join(hostDirectory, "package.json"));
    await copyFile(join(sandboxHost, "astro.config.mjs"), join(hostDirectory, "astro.config.mjs"));

    // This installs only the pinned local host dependencies. The config's
    // sandbox runner is not contacted until a caller starts a server.
    await run("npm", [
      "install", "--ignore-scripts", "--include=optional", "--no-audit", "--no-fund",
    ], { cwd: hostDirectory, maxBuffer: 20 * 1024 * 1024 });
    const installed = await installPackedPackage({
      repoRoot,
      runDirectory,
      packageDirectory: hostDirectory,
      initialize: false,
    });
    await run(process.execPath, [
      join(hostDirectory, "node_modules", "emdash", "dist", "cli", "index.mjs"),
      "init", "--database", ".emdash/proof.sqlite",
    ], { cwd: hostDirectory, maxBuffer: 10 * 1024 * 1024 });
    Object.assign(host, installed, { runDirectory, hostDirectory, cleanup });
    return host;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function configureJourneyHost(host) {
  const entryDirectory = join(host.hostDirectory, "node_modules", "@dinkuskit", "ship-journey");
  await mkdir(entryDirectory, { recursive: true });
  const source = join(entryDirectory, "entry-source.mjs");
  await writeFile(source, journeyEntrySource());
  const esbuild = join(host.hostDirectory, "node_modules", ".bin", "esbuild");
  await run(esbuild, ["--bundle", "--format=esm", "--platform=neutral", source, "--outfile=index.mjs"], {
    cwd: entryDirectory, maxBuffer: 10 * 1024 * 1024,
  });
  await writeFile(join(entryDirectory, "package.json"), JSON.stringify({
    name: "@dinkuskit/ship-journey", type: "module", exports: {
      ".": "./index.mjs", "./runner": "./runner.mjs",
    },
  }));
  await copyFile(join(dirname(fileURLToPath(import.meta.url)), "runner.mjs"), join(entryDirectory, "runner.mjs"));
  await copyFile(join(root, "test-support/fixture-pdf.js"), join(entryDirectory, "fixture-pdf.js"));
  const requireFromHost = createRequire(join(host.hostDirectory, "package.json"));
  const { createShipPlugin } = await import(pathToFileURL(requireFromHost.resolve("@dinkuskit/ship/installed")));
  // EmDash's sandbox registration needs manifest route metadata separately
  // from the bundled standard entry. Derive it from the packed factory.
  const routes = Object.entries(createShipPlugin().routes).map(([name, route]) => ({
    name, permission: route.permission, methods: route.methods,
    request: route.request, response: route.response, public: route.public === true,
  }));
  routes.push({ name: "fixture", permission: "plugins:manage", methods: ["POST"], request: { body: "json", maxBytes: 16384 } });
  const configPath = join(host.hostDirectory, "astro.config.mjs");
  const config = await readFile(configPath, "utf8");
  await writeFile(configPath, config
    .replace('sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox"', 'sandboxRunner: "@dinkuskit/ship-journey/runner"')
    .replace('entrypoint: "@dinkuskit/ship"', 'entrypoint: "@dinkuskit/ship-journey"')
    .replace('capabilities: []', 'capabilities: ["network:request"]')
    .replace('allowedHosts: []', `allowedHosts: ["1.1.1.1"], routes: ${JSON.stringify(routes)}`)
    .replace('storage: { preferences: { indexes: ["locale"] } }', 'storage: { preferences: { indexes: ["locale"] }, operations: { indexes: [] } }')
    .replace('adminPages: [', 'adminPages: [{ path: "/journey", label: "Synthetic shipment proof", icon: "flask" },'));
  host.fixtureFile = await writeFixtureState(host.hostDirectory);
  return host;
}

export async function startJourneyHost(host) {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((accept, reject) => probe.close(error => error ? reject(error) : accept()));
  const manifest = JSON.parse(await readFile(join(host.hostDirectory, "node_modules/astro/package.json"), "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.astro;
  const child = spawn(process.execPath, [join(host.hostDirectory, "node_modules/astro", bin), "dev"], {
    cwd: host.hostDirectory, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), ASTRO_DEV_BACKGROUND: "0", SHIP_JOURNEY_FIXTURE_FILE: host.fixtureFile },
  });
  host.child = child;
  host.base = `http://127.0.0.1:${port}`;
  let output = "";
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-500000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-500000); });
  host.output = () => output;
  for (let attempt = 0; attempt < 160; attempt++) {
    if (child.exitCode !== null) throw new Error(`Journey host exited: ${output}`);
    try {
      const response = await fetch(`${host.base}/_emdash/api/plugins/dinkuskit-ship/status`, {
        method: "POST", headers: { "content-type": "application/json", "X-EmDash-Request": "1" }, body: "{}",
        signal: AbortSignal.timeout(2000), redirect: "manual",
      });
      if ([401,403].includes(response.status)) return host;
    } catch {}
    await new Promise(accept => setTimeout(accept, 250));
  }
  throw new Error(`Journey host readiness timed out: ${output}`);
}

export async function stopJourneyHost(host) {
  const child = host?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  // Foreground Astro and its workerd children are in this task-owned group.
  process.kill(-child.pid, "SIGTERM");
  let timer;
  const timeout = new Promise(accept => { timer = setTimeout(() => accept(false), 10000); });
  if (await Promise.race([exited.then(() => true), timeout]) === false) {
    process.kill(-child.pid, "SIGKILL");
    await exited;
  }
  clearTimeout(timer);
  host.child = null;
}

export { cleanupDisposableRun, createDisposableRun };
