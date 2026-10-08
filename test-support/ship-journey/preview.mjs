#!/usr/bin/env node
import { configureJourneyHost, prepareInstalledEmdashHost, startJourneyHost, stopJourneyHost } from "./host.mjs";
import { ORDER } from "./journey-fixture.mjs";
const stopped = new Promise(accept => { process.once("SIGINT", accept); process.once("SIGTERM", accept); });
const host = await prepareInstalledEmdashHost();
try {
  await configureJourneyHost(host);
  await startJourneyHost(host);
  console.log("Synthetic fixture only: no live provider, production handoff or Registry.");
  console.log(`${host.base}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin/plugins/dinkuskit-ship/journey`);
  console.log(`Order: ${ORDER.orderId}`);
  console.log("Stop with Ctrl-C to close this task-owned server and clean its directory.");
  await stopped;
} finally { await stopJourneyHost(host); await host.cleanup(); }
