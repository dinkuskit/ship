import type { Block, BlockResponse, FormField } from "@emdash-cms/blocks/server";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import type { Interaction } from "./admin.js";
import { connectionState, type ConnectView } from "./connect.js";
import { banner, context, day, header, link, pageLink, section, SHIPMENTS_PATH, weight, type Toast } from "./pages.js";
import { adminPageFrom, adminUserFrom, ship, ShipError, shipPages, type SettingsForm, type ShipSettingsPage } from "./ship.js";

/**
 * The Shipping settings page (ship-settings-in-admin-129, Store folder, Administrators only): Ship's
 * ship-from address, Pitney Bowes postage account, shipped email and box sizes, read and saved on hosted
 * Ship through the plugin's ship:admin pass. Ship keeps them for every order; nothing is kept here.
 */
/** What the Shipping settings page shows besides Ship's settings: a refusal to show, and the box form as typed. */
export interface SettingsView { failure?: string; typed?: Partial<Record<string, string>> }

const field = (action_id: string, label: string, initial_value?: string | null, placeholder?: string): FormField =>
  ({ type: "text_input", action_id, label, ...(initial_value ? { initial_value } : {}), ...(placeholder ? { placeholder } : {}) });

/** "Acme Co · postage account ending 4321 · owner@example.com", the way Ship's own Settings names the account. */
function accountLine(account: NonNullable<ShipSettingsPage["postageAccount"]>): string {
  const parts = [account.company, account.accountEnding ? `postage account ending ${account.accountEnding}` : null, account.email].filter(Boolean);
  return `Connected to Pitney Bowes: ${parts.length ? parts.join(" · ") : "your postage account"}. Connected ${day(account.connectedAt)}.`;
}

/**
 * Real orders' labels are paid from the owner's own Pitney Bowes postage account. Signing up stays on
 * Pitney Bowes' site, like Stripe's; connecting the account it made happens here, and the password goes
 * to Pitney Bowes once through Ship, which keeps neither it nor the username.
 */
function postageBlocks(settings: ShipSettingsPage): Block[] {
  const blocks: Block[] = [header("Pitney Bowes postage")];
  if (!settings.postageConnected) blocks.push(context("Ship cannot reach Pitney Bowes right now, so only TEST orders get labels."));
  if (settings.postageAccount) {
    return [...blocks, section(accountLine(settings.postageAccount)),
      context("Labels for real orders are paid from this account. Pitney Bowes charges your card there, not DinkusKit."),
      { type: "actions", elements: [{ type: "button", label: "Disconnect Pitney Bowes", action_id: "disconnect_postage", style: "danger",
        confirm: { title: "Disconnect Pitney Bowes?", text: "Ship stops buying labels for real orders until you connect a Pitney Bowes account again. Labels already bought stay as they are.", confirm: "Disconnect", deny: "Keep connected", style: "danger" } }] }];
  }
  blocks.push(section("To buy USPS labels for real orders, you need your own Pitney Bowes postage account. Pitney Bowes charges postage to the card you add there, not DinkusKit. TEST orders don't need one."));
  if (!settings.signupUrl) return [...blocks, context("Connecting a Pitney Bowes account isn't available in Ship yet.")];
  if (settings.testSandbox) blocks.push(context("Ship is on the Pitney Bowes sandbox, so this makes a test account and nothing is charged."));
  return [...blocks,
    { type: "section", text: "1. Create your account on Pitney Bowes' site, with your ship-from address and email filled in. Add a card there; Pitney Bowes refills your postage balance automatically. Use this link: an account made elsewhere may not connect.",
      accessory: link("Create your Pitney Bowes account", settings.signupUrl) },
    section("2. Come back here and connect it. Ship sends your username and password to Pitney Bowes once to find your account, and never keeps your password."),
    { type: "form", block_id: "postage", fields: [
      field("username", "Pitney Bowes username"),
      { type: "secret_input", action_id: "password", label: "Pitney Bowes password" },
    ], submit: { label: "Connect Pitney Bowes", action_id: "save:postage" } }];
}

/**
 * Ship's settings inside EmDash (ship-settings-in-admin-129), in the order of Ship's own Settings page:
 * the ship-from address, the Pitney Bowes postage account, the shipped email's reply-to, then box sizes.
 * Every save goes straight to hosted Ship, which keeps them for every order; nothing is kept here.
 */
export function settingsPage(siteId: string, settings: ShipSettingsPage, view: SettingsView = {}, toast?: Toast): BlockResponse {
  const from = settings.shipFrom, typed = view.typed ?? {};
  const blocks: Block[] = [header("Shipping settings")];
  if (view.failure) blocks.push(banner("error", "Not saved", view.failure));
  blocks.push(header("Ship from"), context("The return address printed on every label."), { type: "form", block_id: "ship-from", fields: [
    field("name", "Name", from?.name), field("company", "Company (optional)", from?.company),
    field("line1", "Address", from?.line1), field("line2", "Address line 2 (optional)", from?.line2),
    field("city", "City", from?.city), field("region", "State", from?.region, "NY"), field("postalCode", "ZIP code", from?.postalCode),
  ], submit: { label: "Save ship-from address", action_id: "save:ship-from" } }, { type: "divider" });
  blocks.push(...postageBlocks(settings), { type: "divider" });
  const sender = settings.storeName ? `the name ${settings.storeName} (your store's Site title)` : "your store's Site title";
  blocks.push(header("Shipped email"), context(`Sent from orders@dinkuskit.com under ${sender} when a label is bought. When a shopper replies, the reply goes to this address.`),
    { type: "form", block_id: "reply-to", fields: [field("replyTo", "Reply-to email", settings.replyTo, "you@example.com")],
      submit: { label: "Save reply-to email", action_id: "save:reply-to" } }, { type: "divider" });
  blocks.push(header("Box sizes"), { type: "table", page_action_id: "boxes", empty_text: "No box sizes yet. Labels need at least one.",
    columns: [{ key: "name", label: "Name" }, { key: "size", label: "Size" }, { key: "empty", label: "Empty weight" }, { key: "remove", label: "", format: "element" }],
    rows: settings.boxes.map(box => ({ name: box.name, size: `${box.lengthIn} × ${box.widthIn} × ${box.heightIn} in`, empty: weight(box.weightOz),
      remove: { type: "button", label: "Remove", action_id: "remove_box", value: box.boxId,
        confirm: { title: `Remove ${box.name}?`, text: "Labels already bought in this box stay as they are.", confirm: "Remove", deny: "Keep", style: "danger" } } })) },
    { type: "form", block_id: "boxes", fields: [
      field("name", "Box name", typed.name, "Small mailer"), field("lengthIn", "Length (in)", typed.lengthIn), field("widthIn", "Width (in)", typed.widthIn),
      field("heightIn", "Height (in)", typed.heightIn), field("weightOz", "Empty weight (oz)", typed.weightOz ?? "0"),
    ], submit: { label: "Add box size", action_id: "save:boxes" } });
  blocks.push({ type: "actions", elements: [pageLink("Shipments", SHIPMENTS_PATH), link("Ship's own Settings", shipPages(siteId).settings)] });
  return { blocks, ...(toast ? { toast } : {}) };
}

/** The Shipping settings page for a role, a connection or a Ship that cannot show settings here. */
export function settingsNotice(title: string, description: string, siteId: string | null = null, variant: "default" | "alert" | "error" = "default"): BlockResponse {
  return { blocks: [header("Shipping settings"), banner(variant, title, description), { type: "actions", elements: [
    pageLink("Shipments", SHIPMENTS_PATH), ...(siteId ? [link("Ship's own Settings", shipPages(siteId).settings)] : []),
  ] }] };
}

/** Each settings form's fields as hosted Ship takes them; anything else typed into the page is not sent. */
const SETTINGS_FIELDS: Record<SettingsForm, string[]> = {
  "ship-from": ["name", "company", "line1", "line2", "city", "region", "postalCode"],
  "reply-to": ["replyTo"],
  boxes: ["name", "lengthIn", "widthIn", "heightIn", "weightOz"],
  postage: ["username", "password"],
};
const TOASTS: Record<SettingsForm, string> = {
  "ship-from": "Ship-from address saved.", "reply-to": "Reply-to email saved.", boxes: "Box size added.", postage: "Pitney Bowes connected.",
};

/** A form's values as strings, trimmed of nothing: Ship checks each one and says what is wrong in the store's words. */
function settingsValues(form: SettingsForm, values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of SETTINGS_FIELDS[form]) {
    const value = values[name];
    if (typeof value === "string" && value.length <= 300) out[name] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[name] = String(value);
  }
  return out;
}

/**
 * The Shipping settings page (ship-settings-in-admin-129): Ship's ship-from address, box sizes,
 * shipped email and Pitney Bowes postage account, read and saved through the same ship:admin pass
 * as the Shipments page. Administrators only, as Ship's own Settings is the business owner's.
 */
export async function settingsAdmin(input: Interaction, isAdmin: boolean, route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  if (!isAdmin) return settingsNotice("Shipping settings are for Administrators", "Ask an Administrator of this site to change the ship-from address, box sizes or Pitney Bowes account.");
  let connection: ConnectView;
  try {
    connection = await connectionState(ctx, false);
  } catch (error) {
    ctx.log.error("Connect state failed", { message: error instanceof Error ? error.message : String(error) });
    return settingsNotice("Ship could not be used", "Try again in a moment.", null, "error");
  }
  if (connection.state !== "connected") return settingsNotice("Connect Ship first", "Connect this plugin to DinkusKit.com on the Shipments page; its settings show here once it is connected.", null, "alert");
  const hosted = ship(ctx, connection.siteId, connection.key, adminPageFrom(route.request?.url), adminUserFrom(route.user?.email));
  const shown = async (pending: Promise<ShipSettingsPage>, toast?: Toast) => settingsPage(hosted.siteId, await pending, {}, toast);
  try {
    if (input.type === "form_submit" && input.action_id.startsWith("save:")) {
      const form = input.action_id.slice("save:".length) as SettingsForm;
      if (!(form in SETTINGS_FIELDS)) return { blocks: [] };
      const values = settingsValues(form, input.values);
      try {
        return await shown(hosted.saveSettings(form, values), { type: "success", message: TOASTS[form] });
      } catch (error) {
        if (!(error instanceof ShipError) || error.code === "RECONNECT" || error.status === 404 || error.status === 0 || error.status >= 500) throw error;
        // Ship said what is wrong; the page keeps the box being added, never the password.
        const view: SettingsView = { failure: error.message, ...(form === "boxes" ? { typed: values } : {}) };
        return settingsPage(hosted.siteId, await hosted.settings(), view);
      }
    }
    if (input.type === "block_action" && input.action_id === "remove_box" && typeof input.value === "string") {
      return await shown(hosted.removeBox(input.value), { type: "success", message: "Box size removed." });
    }
    if (input.type === "block_action" && input.action_id === "disconnect_postage") {
      return await shown(hosted.disconnectPostage(), { type: "success", message: "Pitney Bowes disconnected." });
    }
    return await shown(hosted.settings());
  } catch (error) {
    if (error instanceof ShipError) {
      if (error.code === "RECONNECT") return settingsNotice("Connect Ship again", `${error.message} Connect is on the Shipments page.`, null, "error");
      // Until ship.dinkuskit.com has these routes, Ship's own Settings page is where they are changed.
      if (error.status === 404) return settingsNotice("Shipping settings are on Ship's page for now", "Ship has not been updated to show its settings here yet. Change them on Ship's own Settings page.", hosted.siteId);
      return settingsNotice(error.code === "NETWORK" ? "Ship could not be reached" : "Ship could not be used", error.message, hosted.siteId, "error");
    }
    ctx.log.error("Shipping settings failed", { message: error instanceof Error ? error.message : String(error) });
    return settingsNotice("Something went wrong", "The Shipping settings page could not finish that. Try again, or open Ship's own Settings.", hosted.siteId, "error");
  }
}
