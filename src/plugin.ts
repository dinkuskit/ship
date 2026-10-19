import type { SandboxedPlugin } from "emdash/plugin";
import { shippingAdmin } from "./admin.js";

/**
 * DinkusKit Ship for the EmDash store admin (GrillTrack ship-registry-plugin-001):
 * a Shipping page that buys, prints and cancels USPS labels through the hosted
 * Ship service at ship.dinkuskit.com. It keeps no label data of its own.
 */
const plugin: SandboxedPlugin = {
  routes: {
    // Editors and Administrators; lower roles do not see Shipping.
    admin: { public: false, permission: "content:edit_any", methods: ["POST"], handler: shippingAdmin },
  },
};

export default plugin;
