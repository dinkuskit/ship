import { definePlugin } from "emdash";
import { renderShipAdmin } from "./admin.js";

export function createPlugin() {
  return definePlugin({
    id: "dinkuskit-ship",
    version: "0.0.0",
    routes: {
      admin: {
        permission: "plugins:manage",
        handler: async (ctx) => renderShipAdmin(ctx.input),
      },
    },
    admin: {
      pages: [
        { path: "/orders", label: "Orders", icon: "receipt" },
        { path: "/settings", label: "Ship settings", icon: "settings" },
      ],
      settingsSchema: {
        connection_status: {
          type: "select",
          label: "Provider connection",
          description: "Display-only local proof state; no credentials are entered.",
          options: [{ value: "not_connected", label: "Not connected" }],
          default: "not_connected",
        },
        environment: {
          type: "select",
          label: "Environment",
          description: "Local package proof only. Production is not enabled.",
          options: [{ value: "local", label: "Local package" }],
          default: "local",
        },
      },
    },
  });
}
