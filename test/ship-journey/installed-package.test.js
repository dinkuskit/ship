import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupDisposableRun,
  comparePackedFileBytes,
  createDisposableRun,
  installPackedPackage,
  validateLoopbackUrl,
} from "../../test-support/ship-journey/package-install.mjs";
import { prepareInstalledEmdashHost } from "../../test-support/ship-journey/host.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("packed package identity and advertised root export import from node_modules", async () => {
  const runDirectory = await createDisposableRun();
  try {
    const installed = await installPackedPackage({ repoRoot, runDirectory });
    assert.equal(installed.packed.name, "@dinkuskit/ship");
    assert.equal(installed.packed.version, "0.0.0");
    assert.equal(installed.imported.default.routes.admin.permission, "plugins:manage");
    assert.match(installed.entry, /node_modules[\\/]+@dinkuskit[\\/]+ship/);
    const manifest = JSON.parse(await readFile(join(installed.installedDirectory, "package.json"), "utf8"));
    assert.equal(manifest.exports["."], "./src/plugin.js");
    assert.equal(manifest.exports["./plugin"], "./src/plugin.js");
    assert.equal((await comparePackedFileBytes({
      packed: installed.packed,
      installedDirectories: [installed.installedDirectory],
    })).packageSha256, installed.packed.sha256);
  } finally {
    await cleanupDisposableRun(runDirectory);
  }
});

test("complete packed-file comparison rejects a tampered installed byte", async () => {
  const runDirectory = await createDisposableRun();
  try {
    const installed = await installPackedPackage({ repoRoot, runDirectory });
    const tampered = join(runDirectory, "tampered-package");
    await cp(installed.installedDirectory, tampered, { recursive: true });
    // A tampered first/only candidate must fail against the tarball too.
    const entry = join(tampered, "src", "plugin.js");
    await writeFile(entry, `${await readFile(entry, "utf8")}\n// tampered\n`);
    await assert.rejects(
      comparePackedFileBytes({
        packed: installed.packed,
        installedDirectories: [tampered],
      }),
      /installed package differs|file set differs/,
    );
  } finally {
    await cleanupDisposableRun(runDirectory);
  }
});

test("loopback URL validation is exact and credential-free", () => {
  for (const value of ["http://127.0.0.1:4343", "http://[::1]:4343", "http://localhost:4343"]) {
    assert.equal(validateLoopbackUrl(value).protocol, "http:");
  }
  for (const value of [
    "https://127.0.0.1:4343",
    "http://127.0.0.2:4343",
    "http://[::2]:4343",
    "http://user:pass@127.0.0.1:4343",
    "http://10.0.0.1:4343",
  ]) {
    assert.throws(() => validateLoopbackUrl(value), /loopback|valid URL/);
  }
});

test("config-managed EmDash host installs pinned dependencies and Ship package", {
  skip: process.env.SHIP_JOURNEY_HOST_PROOF !== "1" ? "opt in with SHIP_JOURNEY_HOST_PROOF=1" : false,
}, async () => {
  const host = await prepareInstalledEmdashHost({ repoRoot });
  try {
    assert.equal(host.imported.default.routes.admin.permission, "plugins:manage");
    assert.equal(host.packed.name, "@dinkuskit/ship");
    assert.match(host.hostDirectory, /ship-journey-host-/);
    const identity = await comparePackedFileBytes({
      packed: host.packed, installedDirectories: [host.installedDirectory],
    });
    assert.equal(identity.packageSha256, host.packed.sha256);
    // Host acceptance must detect tampering beyond the advertised entry.
    await writeFile(join(host.installedDirectory, "src", "state.js"), "// synthetic altered host file\n");
    await assert.rejects(comparePackedFileBytes({
      packed: host.packed, installedDirectories: [host.installedDirectory],
    }), /installed package differs: src[/\\]state\.js/);
    assert.equal((await readFile(join(host.hostDirectory, "package.json"), "utf8"))
      .includes('"emdash": "1.2.0"'), true);
  } finally {
    await host.cleanup();
  }
});

test("cleanup refuses a directory not created by this process", async () => {
  await assert.rejects(cleanupDisposableRun("/tmp"), /not created/);
});
