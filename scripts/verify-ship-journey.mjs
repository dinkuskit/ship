#!/usr/bin/env node
// Setup is useful evidence, but never a substitute for the installed journey.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
if (process.argv.length > 3 || (mode !== undefined && mode !== "--setup")) {
  console.error("Usage: node scripts/verify-ship-journey.mjs [--setup]");
  process.exitCode = 64;
} else {
  // The explicit setup mode MUST run the host install/init acceptance test.
  const child = spawn(process.execPath, ["--test", "test/ship-journey/installed-package.test.js"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, SHIP_JOURNEY_HOST_PROOF: mode === "--setup" ? "1" : "0" },
  });
  const code = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => accept(signal ? 1 : code ?? 1));
  });
  if (code !== 0) process.exitCode = code;
  else {
    console.log(`SETUP_GATE=${mode === "--setup" ? "passed:host_installed_and_initialized" : "passed:package_only"}`);
    console.log("JOURNEY_GATE=blocked");
    console.log("dependency=Ship workflow/installed factory exports and tested private journey routes");
    console.log("journey_coverage=not_run;provider_traffic=none;registry_install=not_claimed");
    process.exitCode = mode === "--setup" ? 0 : 2;
  }
}
