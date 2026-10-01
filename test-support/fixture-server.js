import { createApp } from "../src/server.js";
import { FileStateStore } from "../src/state.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixturePdf } from "./fixture-pdf.js";

const pdf = createFixturePdf();
const unknown = process.env.FIXTURE_MODE === "unknown";
const stateDir = await mkdtemp(join(tmpdir(), "ship-pb-fixture-"));
const store = new FileStateStore(join(stateDir, "task-state.json"));
const adapter = {
  async quote() {
    return { service: "PM", serviceLabel: "USPS Priority Mail", currency: "USD", amount: 8.60 };
  },
  async createLabel() {
    if (unknown) throw new Error("fixture unknown outcome");
    return { shipmentId: "fixture-shipment", pdfUrl: "https://stg-labels-cls.gcs.pitneybowes.com/usps/fixture/outbound/label/fixture.pdf", price: 8.60 };
  },
};
const app = createApp({
  adapter,
  store,
  port: Number(process.env.PORT || 4328),
  fixtureBanner: true,
  pdfFetch: async () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(pdf.length) } }),
});
const port = Number(process.env.PORT || 4328);
app.listen(port, "127.0.0.1", () => {
  console.log(`Fixture proof server listening at http://127.0.0.1:${port}`);
  console.log("FIXTURE PROOF — NO LIVE PB API");
});
process.once("SIGINT", () => app.close());
process.once("SIGTERM", () => app.close());
