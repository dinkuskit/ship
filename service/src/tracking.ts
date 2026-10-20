import { DurableObject } from "cloudflare:workers";
import { deliveryFromScan, scanTime, TRACKING_NUMBER, type Delivery } from "./delivery.js";
import { pitneyConfig, trackParcel } from "./pitney.js";
import type { StoreShipping } from "./store.js";

/**
 * Where a tracking number leads (GrillTrack ship-tracking-001). Pitney Bowes's
 * updates arrive at one address for DinkusKit's whole developer account and name
 * only the tracking number, so Ship keeps one index from tracking number to the
 * store and label, written when a live label is bought and dropped when it is
 * cancelled. The daily check walks the same index for live labels not yet delivered.
 */
export const PB_TRACKING_PATH = "/v1/tracking/pitney";
/** How long Ship keeps asking after a label that never reports delivered. */
const TRACK_DAYS = 60;
/** Labels asked about per daily check; the rest wait for the next day. */
const CHECK_LIMIT = 500;
const MAX_EVENTS = 1000;
const MAX_BODY_BYTES = 1024 * 1024;

export const trackingIndex = (env: Env) => env.SHIP_TRACKING.get(env.SHIP_TRACKING.idFromName("pitney-bowes"));

export interface Tracked { tracking: string; site: string; labelId: string }

export class TrackingIndex extends DurableObject<Env> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS tracked (
      tracking TEXT PRIMARY KEY, site TEXT NOT NULL, label_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, checked_at INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS tracked_open ON tracked (done, checked_at)");
  }
  /** A live label's tracking number, from the moment it is bought. */
  async add(entry: Tracked): Promise<void> {
    this.sql.exec("INSERT OR REPLACE INTO tracked (tracking, site, label_id, created_at) VALUES (?, ?, ?, ?)", entry.tracking, entry.site, entry.labelId, Date.now());
  }
  /** A cancelled label's number is forgotten; nothing of it ships. */
  async remove(tracking: string): Promise<void> {
    this.sql.exec("DELETE FROM tracked WHERE tracking = ?", tracking);
  }
  async find(tracking: string): Promise<Tracked | null> {
    const row = this.sql.exec<{ site: string; label_id: string }>("SELECT site, label_id FROM tracked WHERE tracking = ?", tracking).toArray()[0];
    return row ? { tracking, site: row.site, labelId: row.label_id } : null;
  }
  /** Delivered, or too old to keep asking about: the daily check leaves it alone. */
  async markDone(tracking: string): Promise<void> {
    this.sql.exec("UPDATE tracked SET done = 1 WHERE tracking = ?", tracking);
  }
  async touch(tracking: string): Promise<void> {
    this.sql.exec("UPDATE tracked SET checked_at = ? WHERE tracking = ?", Date.now(), tracking);
  }
  /** Live labels still to ask about, least recently asked first. */
  async due(limit = CHECK_LIMIT): Promise<Tracked[]> {
    this.sql.exec("UPDATE tracked SET done = 1 WHERE done = 0 AND created_at < ?", Date.now() - TRACK_DAYS * 86_400_000);
    return this.sql.exec<{ tracking: string; site: string; label_id: string }>(
      "SELECT tracking, site, label_id FROM tracked WHERE done = 0 ORDER BY checked_at, created_at LIMIT ?", limit).toArray()
      .map(row => ({ tracking: row.tracking, site: row.site, labelId: row.label_id }));
  }
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

/** PB's Basic credentials against Ship's, compared without leaking how far they matched. */
async function credentialsMatch(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ") || header.length > 1024) return false;
  let given: string;
  try {
    given = atob(header.slice(6).trim());
  } catch {
    return false;
  }
  const digest = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(given), digest(`${env.PB_TRACKING_USER}:${env.PB_TRACKING_PASSWORD}`)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

interface Parsed { tracking: string; delivery: Delivery | null }

/** One of PB's trackingEvents, or null when it cannot be read. */
function parseEvent(event: unknown): Parsed | null {
  if (typeof event !== "object" || event === null) return null;
  const { trackingNumber, packageStatus, eventDescription, eventDate, eventTime, eventTimeOffset } = event as Record<string, unknown>;
  if (typeof trackingNumber !== "string" || !TRACKING_NUMBER.test(trackingNumber)) return null;
  return { tracking: trackingNumber, delivery: deliveryFromScan(packageStatus, eventDescription, scanTime(eventDate, eventTime, eventTimeOffset)) };
}

/**
 * Lands a scan on its label and answers whether the label took it. The index
 * stops asking about a label only once the store has it stored as delivered,
 * whatever the scan said: an older "delivered" after a newer problem scan, say,
 * leaves the label on problem and still being asked about.
 */
async function recordDelivery(env: Env, where: Tracked, delivery: Delivery): Promise<boolean> {
  const store: DurableObjectStub<StoreShipping> = env.SHIP_STORES.get(env.SHIP_STORES.idFromName(where.site));
  const stored = await store.recordDelivery(where.labelId, delivery);
  if (stored === "delivered") await trackingIndex(env).markDone(where.tracking);
  return stored !== null;
}

/**
 * POST /v1/tracking/pitney: Pitney Bowes's tracking updates for every label bought
 * under DinkusKit's developer account, signed in with the username and password
 * Ronald gave PB (secrets PB_TRACKING_USER and PB_TRACKING_PASSWORD). Answers 2xx
 * once the body is read, so PB does not resend it; each event's own answer says
 * what became of it. PB retries any other status for 16 hours.
 */
export async function handleTrackingWebhook(request: Request, env: Env): Promise<Response> {
  const reference = request.headers.get("x-pb-referenceid");
  const echo: Record<string, string> = reference && /^[A-Za-z0-9._:-]{1,200}$/.test(reference) ? { "x-pb-referenceid": reference } : {};
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "method not allowed" } }, 405, { allow: "POST", ...echo });
  if (!env.PB_TRACKING_USER || !env.PB_TRACKING_PASSWORD) return json({ error: { code: "NOT_CONFIGURED", message: "tracking updates are not set up" } }, 503, echo);
  if (!await credentialsMatch(request, env)) return json({ error: { code: "UNAUTHORIZED", message: "unauthorized" } }, 401, { "www-authenticate": 'Basic realm="DinkusKit Ship"', ...echo });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return json({ error: { code: "TOO_LARGE", message: "too large" } }, 413, echo);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: { code: "TOO_LARGE", message: "too large" } }, 413, echo);
    body = JSON.parse(text);
  } catch {
    return json({ error: { code: "BAD_REQUEST", message: "the body is not JSON" } }, 400, echo);
  }
  const events = typeof body === "object" && body !== null ? (body as { trackingEvents?: unknown }).trackingEvents : undefined;
  if (!Array.isArray(events) || events.length > MAX_EVENTS) return json({ error: { code: "BAD_REQUEST", message: "trackingEvents must be a list" } }, 400, echo);
  const responses: { statusCode: number; errors: { message: string }[] }[] = [];
  for (const event of events) {
    const parsed = parseEvent(event);
    if (!parsed) { responses.push({ statusCode: 400, errors: [{ message: "unreadable tracking event" }] }); continue; }
    const where = await trackingIndex(env).find(parsed.tracking);
    if (!where) { responses.push({ statusCode: 404, errors: [{ message: "not a label Ship sold" }] }); continue; }
    const recorded = parsed.delivery === null ? true : await recordDelivery(env, where, parsed.delivery);
    responses.push(recorded ? { statusCode: 200, errors: [] } : { statusCode: 404, errors: [{ message: "label not found" }] });
  }
  return json({ responses }, 200, echo);
}

/**
 * The daily check: Track a Parcel for every live label not yet delivered, so a
 * missed update still shows within a day. Runs from the Worker's cron trigger.
 * Every label in the batch counts as checked whether or not Pitney Bowes
 * answered for it, so the ones it keeps failing on go to the back of the line
 * and the rest of the queue gets its turn the next day.
 */
export async function checkDeliveries(env: Env): Promise<{ asked: number; moved: number; failed: number }> {
  const config = pitneyConfig(env);
  const result = { asked: 0, moved: 0, failed: 0 };
  if (!config) return result;
  const index = trackingIndex(env);
  for (const entry of await index.due()) {
    await index.touch(entry.tracking);
    let delivery: Delivery | null;
    try {
      delivery = await trackParcel(config, entry.tracking);
    } catch {
      result.failed += 1; // Pitney Bowes is not answering for it; its turn comes round again.
      continue;
    }
    result.asked += 1;
    if (delivery && await recordDelivery(env, entry, delivery)) result.moved += 1;
  }
  if (result.failed) console.error("ship tracking check", JSON.stringify(result));
  return result;
}
