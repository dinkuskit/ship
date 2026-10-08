#!/usr/bin/env node
// Setup is useful evidence, but never a substitute for the installed journey.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
if (process.argv.length > 3 || (mode !== undefined && !["--setup", "--workerd"].includes(mode))) {
  console.error("Usage: node scripts/verify-ship-journey.mjs [--setup|--workerd]");
  process.exitCode = 64;
} else {
  // The explicit setup mode MUST run the host install/init acceptance test.
  const workerd = mode === "--workerd";
  const child = spawn(process.execPath, ["--test", workerd
    ? "test/ship-journey/workerd.test.js"
    : "test/ship-journey/installed-package.test.js"], {
    cwd: root, detached: process.platform !== "win32",
    stdio: workerd ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, SHIP_JOURNEY_HOST_PROOF: mode === "--setup" ? "1" : "0", SHIP_JOURNEY_WORKER: workerd ? "1" : "0" },
  });
  const forwardSignal = signal => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const onInterrupt = () => forwardSignal("SIGINT");
  const onTerminate = () => forwardSignal("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  const output = [];
  if (workerd) {
    child.stdout.on("data", chunk => { process.stdout.write(chunk); output.push(String(chunk)); });
    child.stderr.on("data", chunk => { process.stderr.write(chunk); output.push(String(chunk)); });
  }
  const code = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => accept(signal ? 1 : code ?? 1));
  });
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onTerminate);
  if (workerd) {
    const evidence = resolve(root, "runs/ship-journey-runs/20261008");
    await mkdir(evidence, { recursive: true });
    await writeFile(resolve(evidence, "journey.log"), output.join(""));
  }
  if (code !== 0) process.exitCode = code;
  else {
    if (workerd) {
      console.log("FIXTURE_JOURNEY_GATE=passed:installed_emdash_workerd");
      console.log("JOURNEY_GATE=blocked:production_ports_and_browser_mediator_unbound");
      console.log("provider=fixture_only;network=intercepted_offline;registry=not_claimed");
      console.log("ui=admin_route_diagnostics_only;browser_mediator=absent;physical_print_or_delivery=not_claimed");
      process.exit(0);
    }
    console.log(`SETUP_GATE=${mode === "--setup" ? "passed:host_installed_and_initialized" : "passed:package_only"}`);
    console.log("JOURNEY_GATE=blocked");
    console.log("dependency=Ship workflow/installed factory exports and tested private journey routes");
    console.log("journey_coverage=not_run;provider_traffic=none;registry_install=not_claimed");
    process.exitCode = mode === "--setup" ? 0 : 2;
  }
}
