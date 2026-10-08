// Official Registry entry shares the tested npm sandbox implementation.
import type { RouteOptions } from "@emdash-cms/plugin-types";
import plugin from "./plugin.js";

const registryEntry: { routes: Record<string, RouteOptions & { handler: unknown }> } = plugin;
export default registryEntry;
