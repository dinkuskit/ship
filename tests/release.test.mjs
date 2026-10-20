import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { effectiveSelector } from "../scripts/beta-release.mjs";
import { syncPluginVersion } from "../.github/scripts/release-version.mjs";

// The Ship plugin shipped betas first (release-beta-cut-071) while .changeset/pre.json
// was in pre mode. Every Running journey passed on the beta store, so pre mode was
// exited: the release bot's version step must propose a final x.y.z, which the publish
// routes to dinkus-ship itself. While pre.json still exists it must say "exit" (the
// final's own release PR removes it, along with the beta changesets it folds into the
// changelog); after that the checkout's version is already stable and stays so. With no
// changeset waiting, Changesets v3 exits 1 rather than versioning, so the step is skipped.
test("the next release PR proposes the final version that publishes under dinkus-ship", () => {
  const checkout = mkdtempSync(join(tmpdir(), "ship-version-"));
  try {
    for (const name of ["package.json", "emdash-plugin.jsonc", ".changeset", "CHANGELOG.md"]) cpSync(name, join(checkout, name), { recursive: true });
    // The GitHub changelog writer needs a token the test has no business holding; the version is what matters here.
    const config = JSON.parse(readFileSync(join(checkout, ".changeset/config.json"), "utf8"));
    writeFileSync(join(checkout, ".changeset/config.json"), JSON.stringify({ ...config, changelog: false }));
    const prePath = join(checkout, ".changeset/pre.json");
    if (existsSync(prePath)) {
      const pre = JSON.parse(readFileSync(prePath, "utf8"));
      assert.deepEqual({ mode: pre.mode, tag: pre.tag }, { mode: "exit", tag: "beta" });
    }
    const waiting = readdirSync(join(checkout, ".changeset")).filter((name) => name.endsWith(".md") && name !== "README.md");
    if (waiting.length > 0) execFileSync(process.execPath, [join(process.cwd(), "node_modules", "@changesets", "cli", "bin.js"), "version"], { cwd: checkout, stdio: "pipe" });
    const version = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8")).version;
    assert.match(version, /^0\.\d+\.\d+$/);
    assert.equal(effectiveSelector(`dinkus-ship@${version}`), `dinkus-ship@${version}`);
    assert.ok(!existsSync(prePath), "pre.json is gone once the final version step has run");
    const manifest = syncPluginVersion(readFileSync(join(checkout, "emdash-plugin.jsonc"), "utf8"), version);
    assert.equal(JSON.parse(manifest).version, version);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});
