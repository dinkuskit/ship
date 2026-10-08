// Fixture-only transport. Every request is intercepted; there is no live fallback.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createSandboxRunner as official } from '@emdash-cms/sandbox-workerd/sandbox';
import { createFixturePdf } from './fixture-pdf.js';
const origin = 'https://1.1.1.1';
const file = process.env.SHIP_JOURNEY_FIXTURE_FILE;
if (!file) throw new Error('Fixture state path is required');
let queue = Promise.resolve();
let sequence = 0;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
async function readState() {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function saveState(state) {
  const temp = `${file}.${process.pid}.${++sequence}.tmp`;
  await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
  await rename(temp, file);
}
async function handle(url, init = {}) {
  const parsed = new URL(url);
  if (parsed.origin !== origin || parsed.username || parsed.password) throw new Error('Non-fixture transport denied');
  const path = parsed.pathname;
  const method = init.method ?? 'GET';
  const state = await readState();
  if (path === '/controls' && method === 'PUT') {
    state.__controls = JSON.parse(init.body);
    await saveState(state);
    return json({ updated: true });
  }
  const controls = state.__controls ?? {};
  if (path === "/controls" && method === "GET") return json(controls);
  if (path === '/provider/quote') return json({ service: 'PM', serviceLabel: 'Fixture USPS Priority Mail', currency: 'USD', amount: 8.6 });
  if (path === '/provider/create') {
    const { operationId } = JSON.parse(init.body);
    state.__creates ??= [];
    state.__creates.push(operationId);
    await saveState(state);
    if (controls.create) {
      const error = { purchaseOutcome: 'unknown' };
      if (['no_response', 'http_500'].includes(controls.create)) error.recoveryReason = controls.create;
      // These are normalized provider-port fixtures, not actual PB classification.
      if (controls.create === 'malformed') return json({ malformed: true });
      return json({ error }, controls.create === 'http_400' ? 400 : 500);
    }
    return json({ shipmentId: `fixture-${operationId}`, pdfUrl: `${origin}/provider/label.pdf`, price: 8.6 });
  }
  if (path === '/provider/reconcile') {
    const { operationId, reason, createdAt } = JSON.parse(init.body);
    state.__reconciles ??= [];
    state.__reconciles.push({ operationId, reason, createdAt });
    await saveState(state);
    return json({ shipmentId: `fixture-${operationId}`, pdfUrl: `${origin}/provider/label.pdf`, price: 8.6 });
  }
  if (path === '/provider/label.pdf') {
    state.__pdfFetches = (state.__pdfFetches ?? 0) + 1;
    await saveState(state);
    if (controls.pdfUnavailable) return json({ error: {} }, 404);
    const bytes = new Uint8Array(controls.pdfBytes ?? 700000).fill(32);
    bytes.set(createFixturePdf());
    return new Response(bytes, { headers: { 'content-type': 'application/pdf' } });
  }
  throw new Error('Unknown fixture endpoint');
}
async function interceptAll(input, init) {
  let url;
  if (input instanceof Request) {
    url = input.url;
    init = { method: input.method, headers: input.headers, body: await input.text() };
  } else url = String(input);
  if (init?.body != null && typeof init.body !== "string") {
    init = { ...init, body: await new Response(init.body).text() };
  }
  const next = queue.then(() => handle(url, init), () => handle(url, init));
  queue = next.catch(() => {});
  return next;
}
export function createSandboxRunner(options) { return official({ ...options, httpFetch: interceptAll }); }
