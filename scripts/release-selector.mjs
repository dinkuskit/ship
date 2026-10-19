import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { effectiveSelector } from "./beta-release.mjs";

// Prints the selector the release lane would prepare for this checkout's version:
// `dinkus-ship@x.y.z` for a stable version, `dinkus-ship-beta@x.y.z-beta.N` for a
// prerelease, exactly as the publishing workflow routes it. CI's dry preparation
// and bin/verify-ship use it, so a beta version is checked the way it is published.
const [manifest, pkg] = await Promise.all([
  readFile(resolve("emdash-plugin.jsonc"), "utf8").then(JSON.parse),
  readFile(resolve("package.json"), "utf8").then(JSON.parse),
]);
if (pkg.version !== manifest.version) throw new Error("package.json and emdash-plugin.jsonc versions differ");
const selector = effectiveSelector(`${manifest.slug}@${manifest.version}`);
if (!selector) throw new Error(`No release selector for ${manifest.slug}@${manifest.version}`);
console.log(selector);
