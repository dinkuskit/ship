import { pluginResponse } from "emdash/plugin";

import { fixturePdf } from "./pdf.js";
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

export default {
  routes: {
    admin: {
      permission: "plugins:manage",
      methods: ["POST"],
      request: { body: "json", maxBytes: 16384 },
      handler: proof,
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
