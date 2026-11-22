import { fileURLToPath, pathToFileURL } from "node:url";

// The authority-chain run: hosted Ship's own Worker and Durable Objects (service/wrangler.jsonc)
// in Cloudflare's Workers runtime, driven by the built plugin. Run from service/:
//   npx vitest run --config ../proof/shipping-settings-20261122/vitest.config.mts
const service = fileURLToPath(new URL("../../service/", import.meta.url));
// The service's own test plugin, from service/node_modules.
const { cloudflareTest } = await import(pathToFileURL(`${service}node_modules/@cloudflare/vitest-plugin/dist/pool/index.mjs`).href);
export default {
  root: service,
  plugins: [cloudflareTest({
    wrangler: { configPath: `${service}wrangler.jsonc` },
    // The Pitney Bowes sandbox settings Ship is deployed with; the run answers PB's calls itself.
    miniflare: { bindings: { PB_ENVIRONMENT: "sandbox", PB_API_KEY: "synthetic-key", PB_API_SECRET: "synthetic-value", PB_SHIPPER_ID: "DINKUSKIT-SANDBOX-SHIPPER", PB_DEVELOPER_ID: "synthetic-developer" } },
  })],
  test: { include: [fileURLToPath(new URL("./authority-chain.spec.ts", import.meta.url))], maxWorkers: 1 },
};
