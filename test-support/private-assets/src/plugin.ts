import { pluginResponse } from "emdash/plugin";

import { fixturePdf } from "./pdf.js";
import { createProviderPdfLink, PROVIDER_PDF_TTL_MS } from "../../../src/provider-pdf-link.js";
const pdf = () => pluginResponse({
  headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="qualification.pdf"' },
  body: { kind: "bytes", value: fixturePdf() },
});

const proof = (routeCtx: { request: { url: string } }) => {
  const requestUrl = new URL(routeCtx.request.url);
  const routePath = requestUrl.pathname.replace(/\/admin$/, "/private-pdf");
  return {
    blocks: [
      { type: "header", text: "Private asset qualification" },
      {
        type: "context",
        text: "Synthetic bytes only; no Ship, order, provider, or print state.",
      },
      {
        type: "actions",
        elements: [{
          type: "link",
          label: "Open private PDF",
          target: { kind: "external", url: new URL(routePath, requestUrl).href },
        }],
      },
    ],
  };
};

// Fixture-only storage: never a Commerce/Ship authority binding.
const fixtureUrl = "https://stg-labels-cls.gcs.pitneybowes.com/usps/fixture/outbound/label/fixture.pdf";
const providerProof = async (routeCtx, ctx) => {
  const stored = await ctx.storage.preferences.get("provider-proof");
  const values = routeCtx.input?.values ?? {};
  const authorized = stored?.actorId === routeCtx.user?.id &&
    (!values.orderId || values.orderId === "fixture-order") &&
    (!values.operationId || values.operationId === "fixture-operation");
  const link = authorized ? createProviderPdfLink({ operation: stored }) : null;
  return { blocks: [
    { type: "header", text: "Provider PDF link qualification" },
    { type: "context", text: "Synthetic stored operation. The PB-shaped URL is not a live label. No provider request is made." },
    ...(link ? [{ type: "actions", elements: [link] }] : [{ type: "context", text: "Provider PDF unavailable or expired." }]),
  ] };
};

export default {
  routes: {
    admin: {
      permission: "plugins:manage",
      methods: ["POST"],
      request: { body: "json", maxBytes: 16384 },
      handler: (routeCtx, ctx) => routeCtx.input?.page === "/provider-proof" ? providerProof(routeCtx, ctx) : proof(routeCtx),
    },
    "seed-provider-proof": {
      permission: "plugins:manage", methods: ["POST"], request: { body: "json", maxBytes: 1024 },
      async handler(routeCtx, ctx) {
        await ctx.storage.preferences.put("provider-proof", {
          actorId: routeCtx.user.id, status: "label_created", operationId: "fixture-operation",
          pdfUrl: fixtureUrl, createdAt: Date.now() - (routeCtx.input?.expired === true ? PROVIDER_PDF_TTL_MS : 0),
        });
        return { seeded: true };
      },
    },
    "private-pdf": {
      permission: "plugins:manage",
      methods: ["GET"],
      request: { body: "none" },
      response: "raw",
      handler: pdf,
    },
  },
};
