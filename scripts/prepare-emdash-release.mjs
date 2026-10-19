import { execFileSync } from "node:child_process";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BETA_SLUG_SUFFIX, betaManifest, isPrereleaseVersion } from "./beta-release.mjs";

// Official release preparation for the repository's root plugin, staged in a
// temporary directory so the hosted service under service/ and this checkout's
// own files never reach the Registry bundle. Copied from Commerce's release lane
// (dinkuskit/dinkuskit release-beta-cut-071): prereleases publish under the
// dinkus-ship-beta slug, stable versions under dinkus-ship, nothing else.
const root = process.cwd();
const selector = process.argv[2];
const manifestSource = await readFile(resolve(root, "emdash-plugin.jsonc"), "utf8");
const packageSource = await readFile(resolve(root, "package.json"), "utf8");
const manifest = JSON.parse(manifestSource);
const pkg = JSON.parse(packageSource);
const selectorAt = selector?.lastIndexOf("@") ?? -1;
const selectorSlug = selectorAt > 0 ? selector.slice(0, selectorAt) : "";
const selectorVersion = selectorAt > 0 ? selector.slice(selectorAt + 1) : "";
const beta = selectorSlug === `${manifest.slug}${BETA_SLUG_SUFFIX}`;
if (
  pkg.version !== manifest.version ||
  selectorVersion !== manifest.version ||
  (!beta && selectorSlug !== manifest.slug) ||
  beta !== isPrereleaseVersion(manifest.version)
) {
  throw new Error("Release selector must match the package and plugin version (prereleases use the beta slug)");
}
const effectiveManifest = beta ? betaManifest(manifest) : manifest;

const directory = await mkdtemp(join(tmpdir(), "ship-release-"));
try {
  await mkdir(join(directory, "src"));
  await copyFile(resolve(root, "package.json"), join(directory, "package.json"));
  await copyFile(resolve(root, "tsconfig.json"), join(directory, "tsconfig.json"));
  await writeFile(join(directory, "emdash-plugin.jsonc"), beta ? `${JSON.stringify(effectiveManifest, null, 2)}\n` : manifestSource);
  for (const name of await readdir(resolve(root, "src"))) {
    if (name.endsWith(".ts")) await copyFile(resolve(root, "src", name), join(directory, "src", name));
  }
  const receipt = join(directory, "github-output");
  const cli = fileURLToPath(new URL("../node_modules/@emdash-cms/plugin-cli/dist/index.mjs", import.meta.url));
  execFileSync(process.execPath, [cli, "release", "prepare", selector, "--dir", directory, "--out-dir", ".emdash-release"], {
    cwd: directory,
    env: { ...process.env, GITHUB_OUTPUT: receipt },
    stdio: "inherit",
  });
  const fields = Object.fromEntries((await readFile(receipt, "utf8")).trim().split("\n").map(line => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  const bundle = `.emdash-release/${effectiveManifest.slug}-${manifest.version}.tar.gz`;
  if (fields["package-slug"] !== effectiveManifest.slug || fields.version !== manifest.version ||
      fields["publisher-did"] !== manifest.publisher || fields["plugin-directory"] !== "." ||
      fields["bundle-file"] !== bundle) {
    throw new Error("Official release preparation returned unexpected metadata");
  }
  const output = resolve(root, ".emdash-release", basename(bundle));
  await mkdir(resolve(root, ".emdash-release"), { recursive: true });
  await copyFile(join(directory, bundle), output);
  fields["bundle-file"] = output;
  if (Object.values(fields).some(value => /[\r\n]/.test(value))) throw new Error("Invalid release output");
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(fields).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
  console.log(`Prepared ${selector}: ${output}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
