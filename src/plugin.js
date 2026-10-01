// Minimal sandbox-plugin route seam. EmDash supplies authentication, CSRF,
// permissions, JSON parsing, and the standard { success, data } envelope.
// The local package deliberately does not import the host runtime or blocks.

const settings = Object.freeze({
  surface: "ship-pb-sandbox-interface",
  mode: "synthetic-usps-pm-only",
  live: false,
  testWorkflow: "fixture-only",
  commerce: "read-only handoff",
});

const jsonPost = (permission, handler) => ({
  permission,
  methods: ["POST"],
  request: { body: "json", maxBytes: 1024 * 1024 },
  handler,
});

const plugin = {
  routes: {
    admin: jsonPost("plugins:manage", async (routeCtx, ctx) => ({
      ok: true,
      plugin: ctx.plugin.id,
      version: ctx.plugin.version,
      settings,
      inputReceived: routeCtx.input !== undefined,
    })),
    settings: jsonPost("plugins:manage", async () => ({
      ok: true,
      settings,
      writable: false,
    })),
    status: jsonPost("plugins:read", async () => ({
      ok: true,
      settings,
      operations: [],
    })),
  },
};

export { settings };
export default plugin;
