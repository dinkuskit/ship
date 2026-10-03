import node from "@astrojs/node";
import react from "@astrojs/react";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  vite: {
    resolve: { dedupe: ["emdash", "@emdash-cms/blocks"] },
    ssr: { noExternal: ["emdash", "@emdash-cms/admin", "@emdash-cms/blocks"] },
  },
  server: { host: "127.0.0.1", port: 4343, strictPort: true },
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: "file:./.emdash/proof.sqlite" }),
      storage: local({ directory: "./.emdash/uploads", baseUrl: "/_emdash/api/media/file" }),
      sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
      sandboxed: [{
        id: "dinkuskit-ship",
        version: "0.0.0",
        entrypoint: "@dinkuskit/ship",
        format: "standard",
        capabilities: [],
        allowedHosts: [],
        storage: { preferences: { indexes: ["locale"] } },
        adminPages: [
          { path: "/orders", label: "Orders", icon: "receipt" },
          { path: "/settings", label: "Ship settings", icon: "settings" },
        ],
      }],
    }),
  ],
});
