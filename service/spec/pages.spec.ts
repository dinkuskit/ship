import { expect, test } from "vitest";
import { orderPage } from "../src/pages";
import type { Label, OrderSummary, Settings } from "../src/store";

const box = { boxId: "box-1", name: "Small <box>", lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 3 };
const label: Label = {
  labelId: "label:one", orderId: "order:one", version: 2, test: true, practice: false,
  service: "GA", box, weightOz: 16, carrier: "USPS", tracking: "9400100000000000000001",
  status: "bought", createdBy: "owner@example.test", createdAt: "2026-11-11T00:00:00Z",
  cancelledAt: null, priceCents: 510, refund: null, delivery: null,
};
const settings: Settings = {
  shipFrom: { name: "Demo Store", line1: "1 Example Way", city: "Testville", region: "NY", postalCode: "10001" },
  boxes: [box], storeName: "Demo Store", replyTo: "owner@example.test", postageConnected: true,
  postageAccount: null, signupDeveloperId: null, testSandbox: true,
};
const summary: OrderSummary = {
  order: {
    orderId: "order:one", number: 1001, version: 2, status: "completed", test: true,
    shipTo: { name: "Demo Shopper", line1: "2 Example Way", city: "Testville", region: "NY", postalCode: "10001", country: "US" },
    email: "shopper@example.test", completed: { at: "2026-11-11T00:00:00Z", carrier: "USPS", tracking: label.tracking },
    lines: [{ catalogItemId: "item-1", name: "Demo Mug", quantity: 1, weightOz: 13 }],
  },
  labels: [label], address: { ok: true, name: "Demo Shopper", lines: ["2 Example Way"], city: "Testville", state: "NY", zip: "10001" },
};
const render = (labels: Label[]) => orderPage("site:one", "owner@example.test", { ...summary, labels }, settings);

test("In the box shows the options the shopper chose under each item's name, escaped, and nothing extra without them", () => {
  const lines = [{ catalogItemId: "tee-m", name: "Wrong Turn Tee", quantity: 1, options: "Size: M <tall>" }, { catalogItemId: "tee-l", name: "Wrong Turn Tee", quantity: 1, options: "Size: L" },
    { catalogItemId: "item-1", name: "Demo Mug", quantity: 1, weightOz: 13 }];
  const html = orderPage("site:one", "owner@example.test", { ...summary, order: { ...summary.order, lines } }, settings);
  expect(html).toContain('<td>Wrong Turn Tee<br><span class="muted">Size: M &lt;tall&gt;</span></td>');
  expect(html).toContain('<td>Wrong Turn Tee<br><span class="muted">Size: L</span></td>');
  expect(html).toContain("<td>Demo Mug</td>");
});

test("label history keeps table semantics and field names when rows reflow on phones", () => {
  const html = render([label]);
  expect(html).toContain('<h2 id="labels-heading">Labels</h2><table class="label-history" role="table" aria-labelledby="labels-heading">');
  for (const field of ["Service", "Tracking", "Package", "Postage", "Actions"]) {
    expect(html).toContain(`<th role="columnheader" scope="col">${field}</th>`);
    expect(html).toContain(`<span class="label-field" aria-hidden="true">${field}</span>`);
  }
  expect(html).toContain('<tbody role="rowgroup"><tr role="row"><td role="cell">');
  expect(html).toContain(label.tracking);
  expect(html).toContain("Small &lt;box&gt;, 16 oz");
  expect(html).toContain("$5.10");
  expect(html).toContain("TEST SANDBOX");
  expect(html).toContain("(sandbox, not charged)");
  expect(html).toContain('href="/stores/site%3Aone/labels/label%3Aone.pdf" target="_blank" rel="noopener">Open PDF to print</a>');
  expect(html).toContain('method="post" action="/stores/site%3Aone/labels/label%3Aone/cancel"');
  expect(html).not.toContain("Make sandbox label");
});

test("reflow preserves older cancelled labels, practice markers, delivery details and live refund text", () => {
  const html = render([
    label,
    { ...label, labelId: "practice-old", version: 1, practice: true, priceCents: null, status: "cancelled" },
    { ...label, labelId: "live-old", version: 1, test: false, status: "cancelled", refund: "INITIATED",
      tracking: "9400100000000000000002", delivery: { state: "problem", at: "2026-11-10T12:30:00Z", note: "Address <check>" } },
  ]);
  const table = html.split('<tbody role="rowgroup">')[1]!.split("</tbody>")[0]!;
  expect(table.match(/<tr role="row">/g)).toHaveLength(3);
  expect(table.match(/Open PDF to print/g)).toHaveLength(1);
  expect(table.match(/Cancel label<\/button>/g)).toHaveLength(1);
  expect(table.match(/older order version/g)).toHaveLength(2);
  expect(table).toContain("PRACTICE");
  expect(table).toContain("Cancelled. USPS refunds your postage account, which can take up to 14 days.");
  expect(table).toContain("Problem: Address &lt;check&gt;, 2026-11-10 12:30 UTC");
  expect(table).toContain("9400100000000000000002");
  expect(render([])).not.toContain('id="labels-heading"');
});
