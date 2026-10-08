import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, lstat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const run = promisify(execFile);
const OWNED_MARKER = ".ship-journey-owned";
const ownedRuns = new Set();
const DEFAULT_PREFIX = join(tmpdir(), "ship-journey-package-");

function packageDirectory(hostDirectory) {
  return join(hostDirectory, "node_modules", "@dinkuskit", "ship");
}

function safePackagePath(root, file) {
  const candidate = resolve(root, file);
  if (relative(root, candidate).startsWith("..") || isAbsolute(relative(root, candidate))) {
    throw new Error(`packed file escapes package root: ${file}`);
  }
  return candidate;
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function packedFileList(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await packedFileList(path, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`non-regular packed file: ${relativePath}`);
  }
  return files.sort();
}

async function packPackage({ repoRoot, destination }) {
  const output = JSON.parse((await run("npm", [
    "pack", "--json", "--ignore-scripts", "--pack-destination", destination,
  ], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 })).stdout);
  if (!Array.isArray(output) || output.length !== 1 || !output[0].filename) {
    throw new Error("npm pack did not return one package artifact");
  }
  for (const { path } of output[0].files) safePackagePath(destination, path);
  const referenceRoot = await mkdtemp(join(destination, "packed-reference-"));
  await run("tar", ["-xzf", join(destination, output[0].filename), "-C", referenceRoot]);
  return {
    referenceDirectory: join(referenceRoot, "package"),
    ...output[0],
    tarball: join(destination, output[0].filename),
    sha256: await sha256(join(destination, output[0].filename)),
  };
}

export async function createDisposableRun(prefix = DEFAULT_PREFIX) {
  const directory = await mkdtemp(prefix);
  await writeFile(join(directory, OWNED_MARKER), "ship-journey disposable run\n");
  ownedRuns.add(resolve(directory));
  return directory;
}

export async function cleanupDisposableRun(directory) {
  if (!directory || !isAbsolute(directory) || !ownedRuns.has(resolve(directory))) {
    throw new Error("refusing to clean a Ship journey directory not created by this process");
  }
  const marker = join(directory, OWNED_MARKER);
  if ((await lstat(marker).catch(() => null))?.isFile() !== true) {
    throw new Error("refusing to clean a directory without the Ship journey ownership marker");
  }
  const { rm } = await import("node:fs/promises");
  await rm(directory, { recursive: true, force: true });
  ownedRuns.delete(resolve(directory));
}

export function validateLoopbackUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("sandbox host URL must be a valid URL");
  }
  const loopbackHosts = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
  if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname) ||
      url.username || url.password) {
    throw new Error("sandbox host URL must be credential-free HTTP loopback");
  }
  return url;
}

export async function installPackedPackage({
  repoRoot,
  runDirectory,
  packageDirectory: packageInstallDirectory,
  initialize = true,
} = {}) {
  const root = resolve(repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const ownsRunDirectory = !runDirectory;
  runDirectory ??= await createDisposableRun();
  packageInstallDirectory ??= runDirectory;
  try {
    if (initialize) await run("npm", ["init", "--yes"], { cwd: packageInstallDirectory });
    const packed = await packPackage({ repoRoot: root, destination: runDirectory });
    await run("npm", [
      "install", "--ignore-scripts", "--no-save", "--no-audit", "--no-fund", packed.tarball,
    ], { cwd: packageInstallDirectory, maxBuffer: 10 * 1024 * 1024 });
    const installedDirectory = packageDirectory(packageInstallDirectory);
    const requireFromRun = createRequire(pathToFileURL(join(packageInstallDirectory, "package.json")));
    const entry = requireFromRun.resolve("@dinkuskit/ship");
    const packageManifest = JSON.parse(await readFile(join(installedDirectory, "package.json"), "utf8"));
    if (packageManifest.name !== "@dinkuskit/ship" || packageManifest.version !== packed.version) {
      throw new Error("installed package identity does not match npm pack metadata");
    }
    const imported = await import(pathToFileURL(entry).href);
    return { root, packed, installedDirectory, entry, imported, packageInstallDirectory, runDirectory,
      cleanup: () => cleanupDisposableRun(runDirectory) };
  } catch (error) {
    if (ownsRunDirectory) await cleanupDisposableRun(runDirectory);
    throw error;
  }
}

export async function comparePackedFileBytes({ packed, installedDirectories }) {
  const files = [...(packed.files ?? [])].map(({ path }) => path).sort();
  if (!files.length) throw new Error("npm pack returned no packed files");
  if (!packed.referenceDirectory || !Array.isArray(installedDirectories) || !installedDirectories.length) {
    throw new Error("packed reference and at least one installed directory are required");
  }
  const referenceRoot = resolve(packed.referenceDirectory);
  if (JSON.stringify(await packedFileList(referenceRoot)) !== JSON.stringify(files)) {
    throw new Error(`reference installed package file set differs in ${referenceRoot}`);
  }
  const digests = [];
  for (const directory of installedDirectories) {
    const packageRoot = resolve(directory);
    const actual = await packedFileList(packageRoot);
    if (JSON.stringify(actual) !== JSON.stringify(files)) {
      throw new Error(`installed package file set differs in ${packageRoot}`);
    }
    for (const file of files) {
      const expected = await readFile(safePackagePath(referenceRoot, file));
      const installed = await readFile(safePackagePath(packageRoot, file));
      if (!expected.equals(installed)) {
        throw new Error(`installed package differs: ${file}`);
      }
    }
    digests.push({ directory: packageRoot });
  }
  return { files, packageSha256: packed.sha256, installed: digests };
}

export { packageDirectory };
