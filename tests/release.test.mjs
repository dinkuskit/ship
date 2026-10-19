import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { effectiveSelector } from "../scripts/beta-release.mjs";
import { syncPluginVersion } from "../.github/scripts/release-version.mjs";

// The Ship plugin ships betas first (release-beta-cut-071): while .changeset/pre.json
// is committed, the release bot's version step must propose x.y.z-beta.N, which the
// publish routes to dinkus-ship-beta; only `npx changeset pre exit` ends that.
test("the next release PR proposes a beta version that publishes under dinkus-ship-beta", () => {
  const checkout = mkdtempSync(join(tmpdir(), "ship-version-"));
  try {
    for (const name of ["package.json", "emdash-plugin.jsonc", ".changeset"]) cpSync(name, join(checkout, name), { recursive: true });
    // The GitHub changelog writer needs a token the test has no business holding; the version is what matters here.
    const config = JSON.parse(readFileSync(join(checkout, ".changeset/config.json"), "utf8"));
    writeFileSync(join(checkout, ".changeset/config.json"), JSON.stringify({ ...config, changelog: false }));
    const pre = JSON.parse(readFileSync(join(checkout, ".changeset/pre.json"), "utf8"));
    assert.deepEqual({ mode: pre.mode, tag: pre.tag }, { mode: "pre", tag: "beta" });
    execFileSync(process.execPath, [join(process.cwd(), "node_modules", "@changesets", "cli", "bin.js"), "version"], { cwd: checkout, stdio: "pipe" });
    const version = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8")).version;
    assert.match(version, /^0\.\d+\.\d+-beta\.\d+$/);
    assert.equal(effectiveSelector(`dinkus-ship@${version}`), `dinkus-ship-beta@${version}`);
    const manifest = syncPluginVersion(readFileSync(join(checkout, "emdash-plugin.jsonc"), "utf8"), version);
    assert.equal(JSON.parse(manifest).version, version);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});
