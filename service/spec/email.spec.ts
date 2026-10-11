import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import type { StoreShipping } from "../src/store";

let site: string;
const store = () => env.SHIP_STORES.get(env.SHIP_STORES.idFromName(site));

beforeEach(() => {
  site = `site-${crypto.randomUUID()}`;
});

const order = (overrides: Record<string, unknown> = {}) => ({
  schema: "dinkuskit.commerce.ship-order/v1",
  orderId: "order:abc", number: 1001, version: 1, status: "processing", test: false, storeName: "Demo Site Title",
  shipTo: { name: "Demo Shopper", line1: "1 Example Way", city: "Testville", region: "CA", postalCode: "90000", country: "US" },
  email: "shopper@example.test", completed: null,
  lines: [{ catalogItemId: "item_demo", name: "Demo Mug", quantity: 2 }],
  ...overrides,
});

const completed = (version: number, at: string, extra: Record<string, unknown> = {}) =>
  order({ version, status: "completed", completed: { at, carrier: "USPS", tracking: "SANDBOX-TRACKING-A" }, ...extra });

async function receive(body: Record<string, unknown>) {
  const outcome = await store().receiveOrder(body) as { ok: boolean };
  expect(outcome.ok).toBe(true);
}

/** Runs the store's email alarm with a stand-in for Cloudflare's email binding. */
async function sendDue(answer: (message: EmailMessageBuilder) => Promise<unknown> = async () => ({ messageId: "synthetic" })) {
  const sent: EmailMessageBuilder[] = [];
  await runInDurableObject(store(), async (instance: StoreShipping) => {
    (instance as unknown as { emailSender: () => SendEmail }).emailSender = () => ({
      send: async (message: EmailMessageBuilder) => (sent.push(message), answer(message)),
    }) as unknown as SendEmail;
    await instance.alarm();
  });
  return sent;
}

async function rows() {
  return runInDurableObject(store(), async (_, state) =>
    state.storage.sql.exec<{ completed_at: string; state: string; attempts: number }>("SELECT completed_at, state, attempts FROM shipped_emails ORDER BY created_at").toArray());
}

test("a completed order emails the shopper once, under the store's name, with replies to the owner", async () => {
  await receive(order());
  await store().saveReplyTo({ replyTo: "help@example.test" });
  const at = new Date().toISOString();
  await receive(completed(2, at));
  await receive(completed(2, at));
  await receive(completed(3, at)); // A newer version of the same completion (for example a weight change).
  const [email, ...more] = await sendDue();
  expect(more).toEqual([]);
  expect(email).toMatchObject({
    to: "shopper@example.test", from: { email: "orders@dinkuskit.com", name: "Demo Site Title" }, replyTo: "help@example.test",
    subject: "Your order #1001 has shipped",
  });
  expect(email!.text).toContain("Good news: your order #1001 from Demo Site Title has shipped.");
  expect(email!.text).toContain("Tracking number: SANDBOX-TRACKING-A");
  expect(email!.text).toContain("https://tools.usps.com/go/TrackConfirmAction?tLabels=SANDBOX-TRACKING-A");
  expect(email!.text).not.toContain("Demo Mug");
  expect(email!.text).not.toContain("delivered");
  // Commerce sending the same completion again after the email went out sends nothing.
  await receive(completed(4, at));
  expect(await sendDue()).toEqual([]);
  expect(await rows()).toMatchObject([{ state: "sent" }]);
});

test("completing an order again after moving it back to Processing sends a new email", async () => {
  await receive(order());
  await receive(completed(2, new Date(Date.now() - 60_000).toISOString()));
  expect(await sendDue()).toHaveLength(1);
  await receive(order({ version: 3 }));
  await receive(completed(4, new Date().toISOString(), { completed: { at: new Date().toISOString(), carrier: "UPS", tracking: "SANDBOX-TRACKING-B" } }));
  const [again] = await sendDue();
  expect(again!.text).toContain("Carrier: UPS");
  expect(again!.text).not.toContain("tools.usps.com");
});

test("an order moved back to Processing before the email went out gets none", async () => {
  await receive(order());
  await receive(completed(2, new Date().toISOString()));
  await receive(order({ version: 3 }));
  expect(await sendDue()).toEqual([]);
  expect(await rows()).toMatchObject([{ state: "superseded" }]);
});

test("a TEST order emails the store owner, never the shopper", async () => {
  await receive(order({ test: true }));
  await store().saveReplyTo({ replyTo: "owner@example.test" });
  await receive(completed(2, new Date().toISOString(), { test: true }));
  const [email] = await sendDue();
  expect(email).toMatchObject({ to: "owner@example.test", subject: "[TEST] Your order #1001 has shipped" });
  expect(email!.text).toContain("This is a TEST order.");
});

test("orders completed before the store connected to Ship get no email", async () => {
  await receive(completed(2, "2026-01-01T00:00:00.000Z"));
  expect(await rows()).toEqual([]);
  expect(await sendDue()).toEqual([]);
});

test("an order with no email address is skipped, and a failing email service is tried again later", async () => {
  await receive(completed(2, new Date().toISOString(), { email: null }));
  expect(await sendDue()).toEqual([]);
  expect(await rows()).toMatchObject([{ state: "no_recipient" }]);

  site = `site-${crypto.randomUUID()}`;
  await receive(order());
  await receive(completed(2, new Date().toISOString()));
  expect(await sendDue(async () => { throw new Error("service busy"); })).toHaveLength(1);
  expect(await rows()).toMatchObject([{ state: "pending", attempts: 1 }]);
  // Not due again until the retry wait passes.
  expect(await sendDue()).toEqual([]);
  await runInDurableObject(store(), async (_, state) => { state.storage.sql.exec("UPDATE shipped_emails SET next_at = 0"); });
  expect(await sendDue()).toHaveLength(1);
  expect(await rows()).toMatchObject([{ state: "sent" }]);
  // The order itself never changed because of the email.
  expect((await store().getOrder("order:abc"))!.status).toBe("completed");
});

test("emails queued before sending was set up go out on Commerce's next call after it is", async () => {
  await receive(order());
  await receive(completed(2, new Date().toISOString()));
  // Sending is not set up in these tests, so nothing is scheduled yet.
  expect(await runInDurableObject(store(), async (_, state) => state.storage.getAlarm())).toBeNull();
  const scheduled = await runInDurableObject(store(), async (instance: StoreShipping, state) => {
    (instance as unknown as { emailSender: () => SendEmail }).emailSender = () => ({ send: async () => ({}) }) as unknown as SendEmail;
    await instance.listLabels();
    return state.storage.getAlarm();
  });
  expect(scheduled).not.toBeNull();
  expect(await sendDue()).toHaveLength(1);
});
