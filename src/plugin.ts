import type { SandboxedPlugin } from "emdash/plugin";
import { shippingAdmin } from "./admin.js";
import { cancelKey, storeProof } from "./connect.js";

/**
 * DinkusKit Ship for the EmDash store admin (GrillTrack ship-registry-plugin-001):
 * a Shipping page that buys, prints and cancels USPS labels through the hosted
 * Ship service at ship.dinkuskit.com. It keeps no label data of its own.
 */
const plugin: SandboxedPlugin = {
  hooks: {
    // Uninstall cancels only this plugin's DinkusKit key (connect-uninstall-cancels-key-134); the store and the other plugins' keys stay.
    "plugin:uninstall": async (_event, ctx) => { await cancelKey(ctx); },
  },
  routes: {
    // Editors and Administrators; lower roles do not see Shipping.
    admin: { public: false, permission: "content:edit_any", methods: ["POST"], handler: shippingAdmin },
    // DinkusKit.com reads a waiting Connect's receipt here on the store's own web address (store-connect-flow-081).
    "store-proof": { public: true, methods: ["GET"], response: "raw", request: { body: "none" }, handler: (route, ctx) => storeProof(route.input, ctx) },
  },
};

export default plugin;
