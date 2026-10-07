#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join("/tmp", "dinkuskit-ship-sandbox-"));

try {
  const manifest = await readFile(join(root, "emdash-plugin.jsonc"), "utf8");
  for (const required of ['"storage"', '"preferences"', '"indexes"', '"admin"']) {
    if (!manifest.includes(required)) throw new Error(`manifest is missing ${required}`);
  }

  await writeFile(join(temp, "package.json"), '{"private":true,"type":"module"}\n');
  const packed = JSON.parse((await run("npm", [
    "pack", "--json", "--pack-destination", temp,
  ], { cwd: root })).stdout);
  const tarball = join(temp, packed[0].filename);
  await run("npm", ["install", "--ignore-scripts", "--no-save", tarball], { cwd: temp });

  const installedEntry = pathToFileURL(join(
    temp,
    "node_modules",
    "@dinkuskit",
    "ship",
    "src",
    "plugin.js",
  )).href;
  const backendBytes = (await readFile(new URL(installedEntry))).byteLength;
  if (backendBytes > 128 * 1024) throw new Error("standard backend exceeds the 128 KiB bundle cap");
  console.log(`backend_bytes=${backendBytes};cap_bytes=131072`);
  const installed = await import(installedEntry);
  if (!installed.default?.routes?.admin) throw new Error("installed sandbox entry has no admin route");
  const installedManifest = await readFile(join(temp, "node_modules/@dinkuskit/ship/emdash-plugin.jsonc"), "utf8");
  if (!installedManifest.includes('"preferences"')) throw new Error("installed manifest lost storage contract");

  const runnerModule = process.env.EMDASH_SANDBOX_RUNNER_MODULE;
  if (!runnerModule) {
    console.error("SANDBOX_GATE=blocked");
    console.error("reason=no supported EmDash runner configured");
    console.error("required=configure @emdash-cms/sandbox-workerd/sandbox with workerd");
    console.error("package_install=passed");
    console.error("sandbox_execution=not_claimed");
    process.exitCode = 2;
  } else {
    const runner = await import(runnerModule.startsWith(".")
      ? pathToFileURL(resolve(root, runnerModule)).href
      : runnerModule);
    if (typeof runner.createSandboxRunner !== "function") {
      throw new Error(`${runnerModule} does not export createSandboxRunner`);
    }
    console.log("package_install=passed");
    console.log(`runner_module=${runnerModule}`);
    if (!process.env.EMDASH_SANDBOX_HOST_URL) {
      throw new Error("runner factory alone is not execution proof; set EMDASH_SANDBOX_HOST_URL");
    }
    const base = process.env.EMDASH_SANDBOX_HOST_URL.replace(/\/$/, "");
    const url = new URL(base);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) {
      throw new Error("sandbox proof requires an HTTP loopback host");
    }
    const hostDirectory = process.env.EMDASH_SANDBOX_HOST_DIR;
    if (!hostDirectory) throw new Error("set EMDASH_SANDBOX_HOST_DIR to verify the host-installed package identity");
    for (const { path: file } of packed[0].files) {
      const fresh = await readFile(join(temp, "node_modules/@dinkuskit/ship", file));
      const actual = await readFile(join(hostDirectory, "node_modules/@dinkuskit/ship", file));
      if (!fresh.equals(actual)) throw new Error(`host-installed package differs: ${file}`);
    }
    console.log(`package_sha256=${createHash("sha256").update(await readFile(tarball)).digest("hex")}`);
    console.log("host_installed_package=matched");
    const denied = await fetch(`${base}/_emdash/api/plugins/dinkuskit-ship/admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-EmDash-Request": "1",
      },
      body: JSON.stringify({ page: "/orders", type: "page_load" }),
    });
    if (denied.status !== 401 && denied.status !== 403) {
      throw new Error(`unauthenticated admin request was not denied: ${denied.status}`);
    }
    console.log(`authorization_denial=passed:${denied.status}`);
    const bypass = await fetch(`${base}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`);
    const cookie = bypass.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("sandbox host did not issue a local admin session");
    const invoke = async (body, locale = "en-US") => {
      const response = await fetch(`${base}/_emdash/api/plugins/dinkuskit-ship/admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-EmDash-Request": "1",
          "Accept-Language": locale,
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`sandbox route returned ${response.status}`);
      const envelope = await response.json();
      if (envelope.success !== true || !Array.isArray(envelope.data?.blocks)) {
        throw new Error("sandbox host returned an invalid admin response envelope");
      }
      return envelope.data;
    };
    const orders = await invoke({ page: "/orders", type: "page_load" });
    const settingsAction = await invoke({ page: "/orders", type: "block_action", action_id: "open-settings" });
    if (settingsAction.blocks[0]?.text !== "Ship settings") throw new Error("settings navigation action did not reach settings");
    const detail = await invoke({ page: "/order-detail", type: "page_load" }, "en-US");
    const shipping = await invoke({ page: "/shipping", type: "page_load" }, "en-US");
    const fixtureDetail = await invoke({
      page: "/proof-fixture", type: "block_action", action_id: "open-order",
    });
    const fixtureShipping = await invoke({
      page: "/proof-fixture", type: "block_action", action_id: "make-postage-label",
    });
    const fixtureUpdated = await invoke({
      page: "/proof-fixture",
      type: "form_submit",
      action_id: "update-package",
      fixture: "synthetic-order-1042",
      values: { weightLb: "3.5", lengthIn: "12", widthIn: "9", heightIn: "5" },
    });
    await invoke({
      page: "/settings",
      type: "form_submit",
      action_id: "save-preferences",
      values: { showDashboardLinks: false },
    });
    const persisted = await invoke({ page: "/settings", type: "page_load" });
    const arabic = await invoke({ page: "/settings", type: "page_load" }, "ar-SA");
    const arabicFixture = await invoke({ page: "/proof-fixture", type: "block_action", action_id: "make-postage-label" }, "ar-SA");
    const arabicInvalid = await invoke({ page: "/proof-fixture", type: "form_submit", action_id: "update-package", values: { weightLb: "0", lengthIn: "10", widthIn: "8", heightIn: "4" } }, "ar-SA");
    const fallback = await invoke({ page: "/proof-fixture", type: "block_action", action_id: "make-postage-label" }, "fr-FR");
    const fallbackLabels = fallback.blocks.find(block => block.type === "form").fields.slice(1).map(field => field.label);
    if (JSON.stringify(fallbackLabels) !== JSON.stringify(["Length", "Width", "Height"])) throw new Error("unsupported host locale did not fall back to English");
    const afterInvalid = await invoke({ page: "/proof-fixture", type: "block_action", action_id: "make-postage-label" }, "en-US");
    const invalidStatus = arabicInvalid.blocks.find(block => block.type === "fields").fields.find(field => field.label === "التحقق من الطرد").value;
    if (invalidStatus !== "يحتاج الطرد إلى تصحيح · يجب أن يكون الوزن والأبعاد أكبر من الصفر.") throw new Error("installed invalid package message is not Arabic");
    const arabicLabels = arabicFixture.blocks.find(block => block.type === "form").fields.slice(1).map(field => field.label);
    if (JSON.stringify(arabicLabels) !== JSON.stringify(["الطول", "العرض", "الارتفاع"])) throw new Error("installed fixture dimension labels are not Arabic");
    const serialized = JSON.stringify({ orders, detail, shipping, fixtureDetail, fixtureShipping, fixtureUpdated, persisted, arabic, afterInvalid });
    if (/Order #1042|Sample Recipient|\$48\.00/.test(JSON.stringify({ orders, detail, shipping, persisted, arabic }))) {
      throw new Error("default sandbox UI exposed synthetic Commerce data");
    }
    if (!serialized.includes("Display-only isolated test fixture") ||
      !serialized.includes("Commerce order binding is not available") ||
      !serialized.includes("Original provider outcome unknown") ||
      !serialized.includes("3.5 lb")) {
      throw new Error("fixture package flow did not preserve its explicit fail-closed boundaries");
    }
    if (!serialized.includes("إعدادات الشحن") || !serialized.includes("اتجاه المضيف: rtl")) {
      throw new Error("host-attested Arabic RTL response was not translated");
    }
    if (persisted.blocks?.find((block) => block.type === "form")?.fields?.[0]?.initial_value !== false || persisted.blocks?.some((block) =>
      block.type === "actions" && block.elements?.some((element) =>
        element.label === "Provider dashboard"
      )
    )) {
      throw new Error("settings action did not persist through host storage");
    }
    const persistedPackage = afterInvalid.blocks?.find((block) => block.type === "fields")?.fields
      ?.find((field) => field.label === "Package")?.value;
    if (persistedPackage !== "3.5 lb · 12 × 9 × 5 in") {
      throw new Error(`invalid package submission overwrote valid persisted package: ${persistedPackage}`);
    }
    console.log("sandbox_execution=passed");
    console.log("host_route=admin");
    console.log("settings_persistence=passed");
    console.log("invalid_package_persistence=preserved");
    console.log("default_commerce_data=fail-closed");
    console.log("host_attested_arabic_rtl=passed");
    console.log("host_locale_fallback=passed");
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
