import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import worker from "../src/worker";
import { checkDeliveries, trackingIndex } from "../src/tracking";
import type { StoreShipping } from "../src/store";

// Where a live label is (ship-tracking-001): Pitney Bowes's tracking updates at
// /v1/tracking/pitney, and the daily Track a Parcel check, both landing on the label.

const ORIGIN = "https://ship.example.invalid";
const PB = "https://shipping-api-sandbox.pitneybowes.com";
const USER = "dinkus-tracking", PASSWORD = "synthetic-tracking-word";
let site: string;
let trackCalls: string[];
let trackAnswer: (tracking: string) => Response;

const configured = (extra: Record<string, string | undefined> = {}) => ({ ...env, PB_TRACKING_USER: USER, PB_TRACKING_PASSWORD: PASSWORD, ...extra }) as unknown as Env;
const shipStore = (name = site) => env.SHIP_STORES.get(env.SHIP_STORES.idFromName(name));
const index = () => trackingIndex(env as unknown as Env);

beforeEach(async () => {
  site = `site-${crypto.randomUUID()}`;
  // One index serves every store, so each test starts it empty.
  await runInDurableObject(index(), async (_, state) => state.storage.sql.exec("DELETE FROM tracked"));
  trackCalls = [];
  trackAnswer = () => Response.json({ errors: [{ message: "No tracking information" }] }, { status: 404 });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(new Request(input, init).url);
    if (url.origin !== PB) throw new Error(`unexpected fetch ${url}`);
    if (url.pathname === "/oauth/token") return Response.json({ access_token: "synthetic-pb-pass", tokenType: "BearerToken", expiresIn: 36000 });
    const found = /^\/shippingservices\/v1\/tracking\/([^/]+)$/.exec(url.pathname);
    if (!found) throw new Error(`unexpected Pitney Bowes call ${url.pathname}`);
    expect(url.searchParams.get("packageIdentifierType")).toBe("TrackingNumber");
    trackCalls.push(decodeURIComponent(found[1]!));
    return trackAnswer(decodeURIComponent(found[1]!));
  });
});
afterEach(() => vi.restoreAllMocks());

/** A bought label in the store, live unless said otherwise, as buying one leaves it. */
async function soldLabel(tracking: string, options: { test?: boolean; labelId?: string; orderId?: string } = {}): Promise<string> {
  const labelId = options.labelId ?? `label_${crypto.randomUUID()}`, orderId = options.orderId ?? "order:abc";
  await runInDurableObject(shipStore(), async (instance: StoreShipping) => {
    const sql = (instance as unknown as { sql: SqlStorage }).sql;
    sql.exec("INSERT OR IGNORE INTO orders (order_id, version, record, first_received_at, updated_at) VALUES (?, 1, ?, ?, ?)", orderId,
      JSON.stringify({ orderId, number: 1001, version: 1, status: "processing", test: options.test ?? false, lines: [], shipTo: { name: "Demo Shopper", line1: "1 Example Way", city: "Testville", region: "CA", postalCode: "90000", country: "US" }, email: "shopper@example.test", completed: null }),
      "2026-10-20T00:00:00.000Z", "2026-10-20T00:00:00.000Z");
    sql.exec(`INSERT INTO labels (label_id, order_id, version, test, service, box, weight_oz, carrier, tracking, pdf, status, created_by, created_at, price_cents, shipment_id)
      VALUES (?, ?, 1, ?, 'PM', '{"boxId":"b","name":"Small","lengthIn":8,"widthIn":6,"heightIn":4,"weightOz":3}', 28, 'USPS', ?, X'00', 'bought', 'owner', ?, 935, ?)`,
      labelId, orderId, options.test ? 1 : 0, tracking, "2026-10-20T00:00:00.000Z", `SHIP-${tracking}`);
  });
  if (!options.test) await index().add({ tracking, site, labelId });
  return labelId;
}

async function labelOf(tracking: string, name = site) {
  const labels = await runInDurableObject(shipStore(name), async (instance: StoreShipping) =>
    (instance as unknown as { labelsFor(orderId: string): unknown[] }).labelsFor("order:abc")) as { tracking: string; delivery: unknown }[];
  return labels.find(label => label.tracking === tracking)!;
}

const basic = (user = USER, password = PASSWORD) => `Basic ${btoa(`${user}:${password}`)}`;
async function update(body: unknown, options: { authorization?: string | null; env?: Env; reference?: string; method?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-pb-referenceid": options.reference ?? "ref-1" };
  if (options.authorization !== null) headers.authorization = options.authorization ?? basic();
  const response = await worker.fetch(new Request(`${ORIGIN}/v1/tracking/pitney`, {
    method: options.method ?? "POST", headers, ...(options.method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  }), options.env ?? configured());
  return { status: response.status, headers: response.headers, json: await response.json() as any };
}
const event = (trackingNumber: string, packageStatus: string, extra: Record<string, unknown> = {}) =>
  ({ trackingNumber, carrier: "USPS", packageStatus, eventDescription: `${packageStatus} scan`, eventDate: "2026-10-21", eventTime: "09:15:00", eventTimeOffset: "-04:00", eventCode: "01", ...extra });

test("Pitney Bowes's updates need Ship's username and password, and nothing else gets in", async () => {
  expect((await update({ trackingEvents: [] }, { env: configured({ PB_TRACKING_USER: undefined }) })).status).toBe(503);
  expect((await update({ trackingEvents: [] }, { authorization: null })).status).toBe(401);
  expect((await update({ trackingEvents: [] }, { authorization: basic(USER, "wrong") })).status).toBe(401);
  expect((await update({ trackingEvents: [] }, { authorization: "Bearer nope" })).status).toBe(401);
  const refused = await update({ trackingEvents: [] }, { authorization: basic("someone", PASSWORD) });
  expect(refused.status).toBe(401);
  expect(refused.headers.get("www-authenticate")).toContain("Basic");
  expect((await update({}, { method: "GET" })).status).toBe(405);
  expect((await update("not json")).status).toBe(400);
  expect((await update({ trackingEvents: "x" })).status).toBe(400);
  // A well-signed empty update is fine, and carries PB's reference back.
  const ok = await update({ trackingEvents: [] }, { reference: "ref-42" });
  expect(ok.status).toBe(200);
  expect(ok.headers.get("x-pb-referenceid")).toBe("ref-42");
  expect(ok.json).toEqual({ responses: [] });
});

test("an update lands on the label it names, in the store that sold it, and a delivered label stops being asked about", async () => {
  await soldLabel("9400100000000000000001");
  const other = `site-${crypto.randomUUID()}`;
  const result = await update({ trackingEvents: [
    event("9400100000000000000001", "InTransit", { eventDescription: "Arrived at USPS Regional Facility" }),
    event("9400100000000000000009", "Delivered"),
    { trackingNumber: "bad number!", packageStatus: "Delivered" },
    event("9400100000000000000001", "Manifest"),
  ] });
  expect(result.status).toBe(200);
  expect(result.json.responses.map((r: { statusCode: number }) => r.statusCode)).toEqual([200, 404, 400, 200]);
  expect((await labelOf("9400100000000000000001")).delivery).toEqual({ state: "in_transit", at: "2026-10-21T13:15:00.000Z", note: "Arrived at USPS Regional Facility" });
  expect(await index().due()).toMatchObject([{ tracking: "9400100000000000000001", site }]);
  expect(other).not.toBe(site);

  await update({ trackingEvents: [event("9400100000000000000001", "OutForDelivery", { eventDate: "2026-10-22", eventTime: "08:00:00" })] });
  expect((await labelOf("9400100000000000000001")).delivery).toMatchObject({ state: "out_for_delivery" });
  await update({ trackingEvents: [event("9400100000000000000001", "Delivered", { eventDate: "2026-10-22", eventTime: "14:02:00", eventDescription: "Delivered, In/At Mailbox" })] });
  expect((await labelOf("9400100000000000000001")).delivery).toEqual({ state: "delivered", at: "2026-10-22T18:02:00.000Z", note: "Delivered, In/At Mailbox" });
  expect(await index().due()).toEqual([]);
  // Updates can arrive out of order: an older scan after a newer one changes nothing, and delivered stays delivered.
  await update({ trackingEvents: [event("9400100000000000000001", "InTransit", { eventDate: "2026-10-21" })] });
  expect((await labelOf("9400100000000000000001")).delivery).toMatchObject({ state: "delivered" });
});

test("a problem scan shows its reason, and a sandbox label never gets a delivery", async () => {
  await soldLabel("9400100000000000000002");
  await update({ trackingEvents: [event("9400100000000000000002", "DeliveryAttempt", { eventDescription: "" })] });
  expect((await labelOf("9400100000000000000002")).delivery).toMatchObject({ state: "problem", note: "Delivery attempted" });
  // A scan from the future of an earlier one with a crafted description stays one short line.
  await update({ trackingEvents: [event("9400100000000000000002", "Exception", { eventDate: "2026-10-23", eventDescription: "Weather\u0000delay\n<b>x</b>" + "y".repeat(300) })] });
  const problem = (await labelOf("9400100000000000000002")).delivery as { note: string };
  expect(problem.note.startsWith("Weather delay <b>x</b>")).toBe(true);
  expect(problem.note.length).toBe(120);
  // A "delivered" from before that problem changes nothing, and the label is still asked about: only a stored delivered stops that.
  await update({ trackingEvents: [event("9400100000000000000002", "Delivered", { eventDate: "2026-10-22" })] });
  expect((await labelOf("9400100000000000000002")).delivery).toMatchObject({ state: "problem" });
  expect(await index().due()).toMatchObject([{ tracking: "9400100000000000000002" }]);
  await update({ trackingEvents: [event("9400100000000000000002", "Delivered", { eventDate: "2026-10-24" })] });
  expect((await labelOf("9400100000000000000002")).delivery).toMatchObject({ state: "delivered" });
  expect(await index().due()).toEqual([]);

  const sandbox = await soldLabel("SANDBOXTRACKING000003", { test: true, orderId: "order:abc" });
  expect(sandbox).toMatch(/^label_/);
  // Not indexed, so PB's update finds nothing; and even a direct record is refused.
  expect((await update({ trackingEvents: [event("SANDBOXTRACKING000003", "Delivered")] })).json.responses[0].statusCode).toBe(404);
  expect(await shipStore().recordDelivery(sandbox, { state: "delivered", at: "2026-10-22T00:00:00.000Z", note: null })).toBeNull();
  expect((await labelOf("SANDBOXTRACKING000003")).delivery).toBeNull();
});

test("the daily check asks Pitney Bowes about live labels not yet delivered, and takes its word", async () => {
  await soldLabel("9400100000000000000004");
  await soldLabel("9400100000000000000005", { labelId: "label_five" });
  trackAnswer = tracking => tracking === "9400100000000000000004"
    ? Response.json({ trackingNumber: tracking, status: "Delivered", deliveryDate: "2026-10-22", deliveryTime: "11:30:00", scanDetailsList: [
        { packageStatus: "InTransit", eventDate: "2026-10-21", eventTime: "09:15:00", scanDescription: "Arrived at USPS Facility" },
        { packageStatus: "Delivered", eventDate: "2026-10-22", eventTime: "11:30:00", scanDescription: "Delivered, Front Door" },
      ] })
    : Response.json({ trackingNumber: tracking, status: "InTransit", scanDetailsList: [{ packageStatus: "Acceptance", eventDate: "2026-10-21", eventTime: "07:00:00", scanDescription: "USPS in possession of item" }] });
  expect(await checkDeliveries(env as unknown as Env)).toEqual({ asked: 2, moved: 2, failed: 0 });
  expect(trackCalls.sort()).toEqual(["9400100000000000000004", "9400100000000000000005"]);
  expect((await labelOf("9400100000000000000004")).delivery).toEqual({ state: "delivered", at: "2026-10-22T11:30:00.000Z", note: "Delivered, Front Door" });
  expect((await labelOf("9400100000000000000005")).delivery).toEqual({ state: "in_transit", at: "2026-10-21T07:00:00.000Z", note: "USPS in possession of item" });
  // Delivered is done; the other is asked again tomorrow; nothing known yet changes nothing.
  trackCalls = [];
  trackAnswer = () => Response.json({ errors: [] }, { status: 404 });
  expect(await checkDeliveries(env as unknown as Env)).toEqual({ asked: 1, moved: 0, failed: 0 });
  expect(trackCalls).toEqual(["9400100000000000000005"]);
  expect((await labelOf("9400100000000000000005")).delivery).toMatchObject({ state: "in_transit" });
  // Pitney Bowes down: nothing recorded, nothing thrown, and the labels it failed on still count as checked,
  // so they go to the back of the line instead of heading every day's batch.
  await soldLabel("9400100000000000000006", { labelId: "label_six" });
  const checkedAt = async () => runInDurableObject(index(), async (_, state) =>
    Object.fromEntries(state.storage.sql.exec<{ tracking: string; checked_at: number }>("SELECT tracking, checked_at FROM tracked").toArray().map(row => [row.tracking, row.checked_at])));
  const before = await checkedAt();
  expect(before["9400100000000000000006"]).toBe(0);
  trackAnswer = () => new Response("down", { status: 503 });
  expect(await checkDeliveries(env as unknown as Env)).toEqual({ asked: 0, moved: 0, failed: 2 });
  const after = await checkedAt();
  expect(after["9400100000000000000005"]).toBeGreaterThan(before["9400100000000000000005"]!);
  expect(after["9400100000000000000006"]).toBeGreaterThan(0);
  expect((await labelOf("9400100000000000000005")).delivery).toMatchObject({ state: "in_transit" });
  // Without the sandbox keys nothing is asked at all.
  expect(await checkDeliveries({ ...env, PB_API_KEY: undefined } as unknown as Env)).toEqual({ asked: 0, moved: 0, failed: 0 });
});
