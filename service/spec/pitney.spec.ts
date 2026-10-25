import { afterEach, expect, test, vi } from "vitest";
import { buy, findPurchase, PitneyError, PB_SANDBOX_LABEL_HOST, PB_SANDBOX_ORIGIN, type PbShipment } from "../src/pitney";

afterEach(() => vi.restoreAllMocks());

test("malformed label documents and rates preserve purchase and lookup error kinds", async () => {
  const config = { apiKey: "synthetic-key", apiSecret: "synthetic-value", shipperId: "synthetic-shipper", origin: PB_SANDBOX_ORIGIN };
  const address = { name: "Test", lines: ["1 Example St"], city: "Testville", state: "CA", zip: "90000" };
  const shipment: PbShipment = { from: address, to: address, service: "GA", weightOz: 8, lengthIn: 4, widthIn: 4, heightIn: 4 };
  let answerBody: unknown = {
    shipmentId: "shipment-1", parcelTrackingNumber: "tracking-1",
    rates: [{ totalCarrierCharge: 5 }], documents: [null, false, 42, "invalid"],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(new Request(input, init).url);
    if (url.pathname === "/oauth/token") return Response.json({ access_token: "synthetic-pb-pass", expiresIn: 3600 });
    expect(url.pathname).toBe("/shippingservices/v1/shipments");
    return Response.json(answerBody);
  });
  await expect(buy(config, shipment, "transaction-1")).rejects.toBeInstanceOf(PitneyError);
  await expect(buy(config, shipment, "transaction-2")).rejects.toMatchObject({ kind: "unknown", detail: "it gave no PDF label link" });
  await expect(findPurchase(config, "transaction-1")).rejects.toBeInstanceOf(PitneyError);
  await expect(findPurchase(config, "transaction-1")).rejects.toMatchObject({ kind: "not_started" });

  answerBody = {
    shipmentId: "shipment-2", parcelTrackingNumber: "tracking-2",
    rates: [null],
    documents: [{ contentType: "URL", fileFormat: "PDF", contents: `https://${PB_SANDBOX_LABEL_HOST}/usps/sample/outbound/label/sample.pdf` }],
  };
  await expect(buy(config, shipment, "transaction-3")).rejects.toMatchObject({ kind: "unknown", detail: "it gave no price" });
});
