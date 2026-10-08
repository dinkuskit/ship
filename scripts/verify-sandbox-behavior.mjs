import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
const run = promisify(execFile);

// Exercise identical admin behavior through either installed source format.
export async function verifySandboxBehavior({ base, hostDirectory, root, pluginId = "dinkuskit-ship" }) {
    const denied = await fetch(`${base}/_emdash/api/plugins/${pluginId}/admin`, {
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
      const response = await fetch(`${base}/_emdash/api/plugins/${pluginId}/admin`, {
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
    const originValues = {
      name: "Fictional Merchant",
      company: "Example Goods",
      addressLine1: "42 Fictional Way",
      addressLine2: "Suite 7",
      city: "Anytown",
      state: "CA",
      postalCode: "90210",
      country: "US",
    };
    await invoke({
      page: "/settings",
      type: "form_submit",
      action_id: "save-origin",
      values: originValues,
    });
    const createdOrigin = await invoke({ page: "/settings", type: "page_load" });
    const editedOrigin = { ...originValues, city: "Example City", state: "NY", postalCode: "10001-1234", addressLine2: "" };
    await invoke({ page: "/settings", type: "form_submit", action_id: "save-origin", values: editedOrigin });
    await invoke({ page: "/settings", type: "form_submit", action_id: "save-preferences", values: { showDashboardLinks: false } });
    const persisted = await invoke({ page: "/settings", type: "page_load" });
    await invoke({
      page: "/settings",
      type: "form_submit",
      action_id: "save-origin",
      values: { ...editedOrigin, state: "ZZ" },
    });
    const afterInvalidOrigin = await invoke({ page: "/settings", type: "page_load" });
    const statusResponse = await fetch(`${base}/_emdash/api/plugins/${pluginId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-EmDash-Request": "1", Cookie: cookie },
      body: JSON.stringify({}),
    });
    if (!statusResponse.ok) throw new Error(`authenticated status route returned ${statusResponse.status}`);
    const statusEnvelope = await statusResponse.json();
    if (/Fictional Merchant|Example Goods|Fictional Way|10001|origin/.test(JSON.stringify(statusEnvelope))) {
      throw new Error("ship-from address leaked into public status");
    }
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
    const serialized = JSON.stringify({ orders, detail, shipping, fixtureDetail, fixtureShipping, fixtureUpdated, persisted, afterInvalidOrigin, arabic, afterInvalid });
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
    if (persisted.blocks?.find((block) => block.type === "form" && block.submit?.action_id === "save-preferences")
      ?.fields?.[0]?.initial_value !== false || persisted.blocks?.some((block) =>
      block.type === "actions" && block.elements?.some((element) =>
        element.label === "Provider dashboard"
      )
    )) {
      throw new Error("settings action did not persist through host storage");
    }
    const readOrigin = response => Object.fromEntries(response.blocks.find(block => block.type === "form" && block.submit?.action_id === "save-origin").fields.map(field => [field.action_id, field.initial_value]));
    if (JSON.stringify(readOrigin(createdOrigin)) !== JSON.stringify(originValues) ||
        JSON.stringify(readOrigin(persisted)) !== JSON.stringify(editedOrigin) ||
        JSON.stringify(readOrigin(afterInvalidOrigin)) !== JSON.stringify(editedOrigin)) {
      throw new Error("origin create/edit/reload or invalid-origin preservation failed");
    }
    for (const route of ["admin", "settings", "status"]) {
      const denied = await fetch(`${base}/_emdash/api/plugins/${pluginId}/${route}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
        body: JSON.stringify({ page: "/settings", type: "form_submit", action_id: "save-origin", values: editedOrigin }),
      });
      if (![401, 403].includes(denied.status)) throw new Error("unauthenticated private route was not denied");
      if (/Fictional|10001|addressLine/.test(await denied.text())) throw new Error("denied route disclosed origin data");
    }
    if (process.env.EMDASH_SANDBOX_PERMISSION_PROOF === "1") {
      // Only the synthetic dev user in this repository's disposable host may be changed.
      const ownedHost = resolve(root, "runs");
      if (!(await realpath(hostDirectory)).startsWith(await realpath(ownedHost) + "/")) throw new Error("permission proof requires a task-owned host under runs");
      const db = join(hostDirectory, ".emdash/proof.sqlite");
      const setRole = async role => run("python3", ["-c", `
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    row = db.execute("SELECT role FROM users WHERE email = 'dev@emdash.local'").fetchone()
    if row is None or row[0] != (50 if int(sys.argv[2]) == 20 else 20): raise SystemExit("unexpected disposable user role")
    db.execute("UPDATE users SET role = ? WHERE email = 'dev@emdash.local'", (int(sys.argv[2]),))
`, db, String(role)]);
      await setRole(20);
      try {
        for (const route of ["admin", "settings", "status"]) {
          const denied = await fetch(`${base}/_emdash/api/plugins/${pluginId}/${route}`, {
            method: "POST", headers: { "Content-Type": "application/json", "X-EmDash-Request": "1", Cookie: cookie },
            body: JSON.stringify({ page: "/settings", type: "form_submit", action_id: "save-origin", values: editedOrigin }),
          });
          if (denied.status !== 403) throw new Error("insufficient-role private route was not denied");
          if (/Fictional|10001|addressLine/.test(await denied.text())) throw new Error("denied role disclosed origin data");
        }
      } finally { await setRole(50); }
      if (JSON.stringify(readOrigin(await invoke({ page: "/settings", type: "page_load" }))) !== JSON.stringify(editedOrigin)) {
        throw new Error("unauthorized origin write changed saved data");
      }
      console.log("insufficient_role_denial=passed:403;synthetic_role=restored");
    } else console.log("insufficient_role_denial=not_run;requires=EMDASH_SANDBOX_PERMISSION_PROOF=1;task-owned-host");
    const persistedPackage = afterInvalid.blocks?.find((block) => block.type === "fields")?.fields
      ?.find((field) => field.label === "Package")?.value;
    if (persistedPackage !== "3.5 lb · 12 × 9 × 5 in") {
      throw new Error(`invalid package submission overwrote valid persisted package: ${persistedPackage}`);
    }
    console.log("sandbox_execution=passed");
    console.log("host_route=admin");
    console.log("settings_persistence=passed");
    console.log("origin_create_edit_reload=passed");
    console.log("invalid_origin_persistence=preserved");
    console.log("status_origin_privacy=passed");
    console.log("invalid_package_persistence=preserved");
    console.log("default_commerce_data=fail-closed");
    console.log("host_attested_arabic_rtl=passed");
    console.log("host_locale_fallback=passed");
}
