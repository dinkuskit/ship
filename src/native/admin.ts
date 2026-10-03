import type { BlockInteraction, BlockResponse } from "@emdash-cms/blocks";
import { blocks, elements } from "@emdash-cms/blocks";

const ORDER = {
  number: "Order #1042",
  recipient: "Sample Recipient",
  destination: "100 Example Avenue · Anytown, CA 90210",
  total: "$48.00 USD · paid · Commerce total immutable",
};

const SETTINGS_LINKS = [
  ["Provider dashboard", "https://developerhub-sandbox.shippingapi.pitneybowes.com/"],
  ["Postage balance", "https://developerhub-sandbox.shippingapi.pitneybowes.com/shipping/postage-balance"],
  ["Transaction history", "https://developerhub-sandbox.shippingapi.pitneybowes.com/shipping/transaction-history"],
] as const;

type Page = "orders" | "order-detail" | "shipping" | "settings";

function response(page: Page, toast?: BlockResponse["toast"]): BlockResponse {
  if (page === "orders") {
    return {
      blocks: [
        blocks.header("Orders"),
        blocks.banner({
          title: "Synthetic proof data",
          description:
            "Commerce order-detail source is UNVERIFIED at the committed Commerce HEAD. This local package does not read Commerce.",
          variant: "alert",
        }),
        blocks.section("Ship starts from an existing Commerce order. Select a sample order to inspect the bounded seam."),
        blocks.fields([
          { label: "Order", value: ORDER.number },
          { label: "Status", value: "Paid · ready for shipment review" },
          { label: "Source", value: "Synthetic sample · not a Commerce read" },
        ]),
        blocks.actions([elements.button("open-order", `Open ${ORDER.number}`)]),
        blocks.context("No order is created, changed, or fetched. Inventory is not required."),
      ],
    };
  }

  if (page === "order-detail") {
    return {
      blocks: [
        blocks.header(ORDER.number),
        blocks.banner({
          title: "Synthetic order detail",
          description:
            "The trusted Commerce order snapshot and action permission seam remain UNVERIFIED. Values below are display-only sample data.",
          variant: "alert",
        }),
        blocks.fields([
          { label: "Order", value: ORDER.number },
          { label: "Recipient", value: ORDER.recipient },
          { label: "Delivery", value: ORDER.destination },
          { label: "Paid total", value: ORDER.total },
          { label: "Inventory", value: "Not linked · not required" },
        ]),
        blocks.section(
          "Commerce owns order identity, recipient data, and paid totals. Ship owns provider status and postage after a future trusted handoff.",
        ),
        blocks.actions([
          elements.button("make-postage-label", "Make a postage label"),
          elements.button("back-orders", "Back to Orders"),
        ]),
        blocks.context("This button opens Ship’s local review surface only; it does not quote, buy, retry, or read a provider."),
      ],
    };
  }

  if (page === "settings") {
    return {
      blocks: [
        blocks.header("Ship settings"),
        blocks.banner({
          title: "Not connected",
          description:
            "Ship-owned settings for the local package proof. No account, credential, secret, or provider call is configured.",
          variant: "alert",
        }),
        blocks.fields([
          { label: "Provider status", value: "Disabled · no provider account bound" },
          { label: "Environment", value: "Local package · EmDash 1.0.1 host" },
          { label: "Postage funding", value: "Merchant funds own postage · not configured" },
        ]),
        blocks.header("Provider dashboard links"),
        blocks.actions(SETTINGS_LINKS.map(([label, url]) => elements.link(label, { kind: "external", url }))),
        blocks.context("Links are references only. Opening them is outside this proof and does not change account state."),
        blocks.actions([elements.link("Back to Orders", { kind: "plugin-page", path: "/orders" })]),
      ],
    };
  }

  return {
    blocks: [
      blocks.header("Shipping"),
      blocks.banner({
        title: "Review postage label",
        description:
          "Local native UI proof only. Provider is disabled; no rate lookup, purchase, retry, PDF, or print action is available.",
        variant: "alert",
      }),
      blocks.fields([
        { label: "Order", value: ORDER.number },
        { label: "Recipient", value: `${ORDER.recipient} · ${ORDER.destination}` },
        { label: "Paid total", value: ORDER.total },
        { label: "Provider", value: "Disabled · unavailable" },
        { label: "Postage", value: "Unavailable · requires provider setup" },
        { label: "Label / print", value: "Not created / not available" },
      ]),
      blocks.section("Merchant-funded postage remains separate from the immutable paid Commerce total."),
      blocks.actions([
        elements.button("back-order-detail", `Back to ${ORDER.number}`),
        elements.link("Ship settings", { kind: "plugin-page", path: "/settings" }),
      ]),
      blocks.context("Synthetic sample only. No Commerce, Inventory, provider, account, or secret store is accessed."),
    ],
    ...(toast === undefined ? {} : { toast }),
  };
}

export function renderShipAdmin(input: unknown): BlockResponse {
  const interaction = isInteraction(input) ? input : null;
  if (interaction?.type === "page_load") {
    if (interaction.page.includes("settings")) return response("settings");
    if (interaction.page.includes("shipping")) return response("shipping");
    return response("orders");
  }
  if (interaction?.type === "block_action") {
    if (interaction.action_id === "open-order") return response("order-detail");
    if (interaction.action_id === "make-postage-label") {
      return response("shipping", { type: "info", message: "Opened Ship review; no provider action was requested." });
    }
    if (interaction.action_id === "back-orders") return response("orders");
    if (interaction.action_id === "back-order-detail") return response("order-detail");
  }
  return response("orders");
}

function isInteraction(input: unknown): input is BlockInteraction {
  if (typeof input !== "object" || input === null || !("type" in input)) return false;
  if (input.type === "page_load") return "page" in input && typeof input.page === "string";
  if (input.type === "block_action") return "action_id" in input && typeof input.action_id === "string";
  return false;
}
