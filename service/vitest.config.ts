import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    // Stand-in Pitney Bowes sandbox settings; the tests answer PB's calls themselves.
    miniflare: { bindings: { PB_ENVIRONMENT: "sandbox", PB_API_KEY: "synthetic-key", PB_API_SECRET: "synthetic-value", PB_SHIPPER_ID: "synthetic-shipper", PB_DEVELOPER_ID: "synthetic-developer" } },
  })],
  test: { include: ["spec/**/*.spec.ts"], maxWorkers: 1 },
});
