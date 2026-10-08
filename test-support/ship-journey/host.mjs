import { copyFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  cleanupDisposableRun,
  createDisposableRun,
  installPackedPackage,
} from "./package-install.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sandboxHost = join(root, "test-support", "sandbox-host");

export async function prepareInstalledEmdashHost({ repoRoot = root } = {}) {
  const runDirectory = await createDisposableRun(join(tmpdir(), "ship-journey-host-"));
  try {
    const hostDirectory = join(runDirectory, "host");
    await mkdir(join(hostDirectory, ".emdash", "uploads"), { recursive: true });
    await copyFile(join(sandboxHost, "package.json"), join(hostDirectory, "package.json"));
    await copyFile(join(sandboxHost, "astro.config.mjs"), join(hostDirectory, "astro.config.mjs"));

    // This installs only the pinned local host dependencies. The config's
    // sandbox runner is not contacted until a caller starts a server.
    await run("npm", [
      "install", "--ignore-scripts", "--no-audit", "--no-fund",
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
    return {
      ...installed,
      runDirectory,
      hostDirectory,
      cleanup: () => cleanupDisposableRun(runDirectory),
    };
  } catch (error) {
    await cleanupDisposableRun(runDirectory);
    throw error;
  }
}

export { cleanupDisposableRun, createDisposableRun };
