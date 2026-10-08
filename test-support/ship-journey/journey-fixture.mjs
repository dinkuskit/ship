import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ORIGIN = "https://1.1.1.1";
const ORDER_IDS = Object.fromEntries(["order", "zero", "unknown", "ineligible", "stale", "corrupt", "missing", "large", "opaque", "malformed"].map((name, index) => [name, `order:00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]));
const ORDER = {
  shopId: "fixture-shop", orderId: ORDER_IDS.order, revision: 7, paymentStatus: "paid",
  paidTotals: { amount: "4800", currency: "USD" }, addressConsent: true,
  destination: {
    name: "Synthetic Recipient", addressLine1: "1 Example Street", city: "Austin",
    state: "TX", postalCode: "78701", country: "US",
  },
};
const SHIP_FROM = {
  name: "Synthetic Merchant", addressLine1: "2 Example Road", city: "Austin",
  state: "TX", postalCode: "78702", country: "US",
};
const PACKAGE = { weightLb: "1", lengthIn: "10", widthIn: "8", heightIn: "4" };
const PDF = new TextEncoder().encode("%PDF-1.4 ship journey fixture\n");

export function journeyEntrySource() {
  return `
import { createShipPlugin } from "@dinkuskit/ship/installed";
const origin = ${JSON.stringify(ORIGIN)};
const order = ${JSON.stringify(ORDER)};
const orderIds = ${JSON.stringify(ORDER_IDS)};
const shipFrom = ${JSON.stringify(SHIP_FROM)};
const base = {
  async json(ctx, path, init = {}) {
    const response = await ctx.http.fetch(origin + path, init);
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error("Fixture provider failure"), body.error ?? {});
    return body;
  },
  async bytes(ctx, path, init = {}) {
    const response = await ctx.http.fetch(origin + path, init);
    if (!response.ok) throw new Error("fixture transport " + response.status);
    return new Uint8Array(await response.arrayBuffer());
  },
};
function storeFor(ctx) {
  return {
    async getOrigin() { return shipFrom; },
    getVersioned: key => ctx.storage.operations.getVersioned(key),
    compareAndSet: (key, expected, value) => ctx.storage.operations.compareAndSet(key, expected, value),
  };
}
function ports(ctx) {
  return {
    async getPaidOrder({ shopId, orderId }) {
      if (shopId !== order.shopId) return null;
      if (orderId === orderIds.zero) return { ...order, orderId, paidTotals: { amount: "0", currency: "USD" } };
      if (!Object.values(orderIds).includes(orderId)) return null;
      return { ...order, orderId };
    },
    async quote(shipment) {
      return base.json(ctx, "/provider/quote", { method: "POST", body: JSON.stringify(shipment) });
    },
    async createLabel(shipment, operationId) {
      return base.json(ctx, "/provider/create", { method: "POST", body: JSON.stringify({ shipment, operationId }) });
    },
    async fetchLabelPdf(url) {
      if (url !== origin + "/provider/label.pdf") throw new Error("unapproved fixture URL");
      return base.bytes(ctx, "/provider/label.pdf");
    },
    async reconcileLabel(operationId, input) {
      return base.json(ctx, "/provider/reconcile", { method: "POST", body: JSON.stringify({ operationId, ...input }) });
    },
  };
}
const authorityPort = {
  async authorize({ user }) {
    if (!user) return { canManage: false };
    return { shopId: order.shopId, actorId: user.id, canManage: true };
  },
};
const plugin = createShipPlugin({
  authorityPort,
  workflowFactory: async (ctx) => {
    const { createShipWorkflow } = await import("@dinkuskit/ship/workflow");
    return createShipWorkflow({ store: storeFor(ctx), orderPort: ports(ctx), providerPort: ports(ctx) });
  },
});
plugin.routes.fixture = {
  permission: "plugins:manage", methods: ["POST"], request: { body: "json", maxBytes: 16384 },
  async handler({ input }, ctx) {
    if (input.action === "controls") return base.json(ctx, "/controls", { method: "PUT", body: JSON.stringify(input.controls ?? {}) });
    if (input.action === "oversize") {
      await ctx.storage.operations.compareAndSet("fixture-limit-probe", null, { value: "x".repeat(1100000) });
      return { unexpectedlyAccepted: true };
    }
    const key = input.key;
    if (typeof key !== "string" || !key.startsWith("ship:pdf:v1:") || key.length > 200) throw new Error("Invalid fixture chunk key");
    if (input.action === "missing") await ctx.storage.operations.delete(key);
    if (input.action === "restore") {
      const saved = await ctx.storage.operations.get("fixture-backup:" + key);
      if (!saved) throw new Error("Missing fixture reference");
      await ctx.storage.operations.put(key, saved);
    }
    if (input.action === "corrupt") {
      const record = await ctx.storage.operations.get(key);
      await ctx.storage.operations.put("fixture-backup:" + key, record);
      await ctx.storage.operations.put(key, { ...record, base64: "AAAA" + record.base64.slice(4) });
    }
    const record = await ctx.storage.operations.get(key);
    return { stored: Boolean(record), bytes: record ? new TextEncoder().encode(JSON.stringify(record)).length : 0 };
  },
};
const admin = plugin.routes.admin.handler;
plugin.routes.admin.handler = async (...args) => {
  const response = await admin(...args);
  response.blocks.splice(1, 0, { type: "banner", title: "Synthetic installed proof", description: "Synthetic order/provider; disposable EmDash CAS. No production Commerce or Registry integration.", variant: "alert" });
  return response;
};
export default plugin;
`;
}

export async function writeFixtureState(hostDirectory) {
  const directory = join(hostDirectory, ".emdash");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "ship-journey-fixture.json");
  if (!(await readFile(file, "utf8").catch(() => null))) await writeFile(file, "{}\n");
  return file;
}

export { ORIGIN, ORDER, ORDER_IDS, PACKAGE, PDF, SHIP_FROM };
