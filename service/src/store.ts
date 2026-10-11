import { DurableObject } from "cloudflare:workers";
import { ok, ServiceError, toOutcome, type Outcome } from "./errors.js";
import { NOT_ONE_LINE, parseShipOrder, type ShipOrder } from "./order.js";

/** Commerce reads at most this many labels per call (dinkuskit/commerce src/features/orders/ship.ts). */
export const LABELS_PER_LIST = 100;

const EVENT_ID = /^[A-Za-z0-9._:-]{1,200}$/;

/** A label Ship bought, as Commerce picks it up from GET /v1/labels. */
export interface LabelEvent {
  eventId: string;
  orderId: string;
  version: number;
  carrier: string;
  tracking: string;
}

/**
 * One store's shipping: the latest version of each Commerce order and the
 * labels Commerce has not picked up yet. One Durable Object per store id, so
 * stores never share data.
 */
export class StoreShipping extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY, version INTEGER NOT NULL, record TEXT NOT NULL,
      first_received_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS label_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL,
      version INTEGER NOT NULL, carrier TEXT NOT NULL, tracking TEXT NOT NULL,
      created_at TEXT NOT NULL, acked_at TEXT)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS label_events_waiting ON label_events (acked_at, seq)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  /**
   * Keeps one order version from Commerce. A version older than the one Ship
   * already has changes nothing (a late retry); the same or a newer version
   * replaces it, since Commerce sends each product's current weight.
   */
  async receiveOrder(body: unknown): Promise<Outcome> {
    try {
      const order = parseShipOrder(body);
      const now = new Date().toISOString();
      const kept = this.sql.exec<{ version: number }>("SELECT version FROM orders WHERE order_id = ?", order.orderId).toArray()[0];
      if (kept && kept.version > order.version) return ok({ orderId: order.orderId, version: kept.version });
      // When the store first sent Ship anything: orders completed before then never get a shipped email.
      this.sql.exec("INSERT OR IGNORE INTO store_meta (key, value) VALUES ('connected_at', ?)", now);
      this.sql.exec(`INSERT INTO orders (order_id, version, record, first_received_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (order_id) DO UPDATE SET version = excluded.version, record = excluded.record, updated_at = excluded.updated_at`,
        order.orderId, order.version, JSON.stringify(order), now, now);
      return ok({ orderId: order.orderId, version: order.version });
    } catch (error) {
      return toOutcome(error);
    }
  }

  /** Labels Commerce has not acknowledged, oldest first. */
  async listLabels(): Promise<Outcome> {
    const rows = this.sql.exec<{ event_id: string; order_id: string; version: number; carrier: string; tracking: string }>(
      "SELECT event_id, order_id, version, carrier, tracking FROM label_events WHERE acked_at IS NULL ORDER BY seq LIMIT ?",
      LABELS_PER_LIST).toArray();
    return ok(rows.map(row => ({ eventId: row.event_id, orderId: row.order_id, version: row.version, carrier: row.carrier, tracking: row.tracking })));
  }

  /** Commerce picked the label up; it is not listed again. A repeat, or an id Ship never issued, is still a success. */
  async ackLabel(body: unknown): Promise<Outcome> {
    try {
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ServiceError(400, "INVALID_INPUT", "body must be a JSON object");
      const eventId = (body as Record<string, unknown>).eventId;
      if (typeof eventId !== "string" || !EVENT_ID.test(eventId)) throw new ServiceError(400, "INVALID_INPUT", "eventId must be a label event id");
      this.sql.exec("UPDATE label_events SET acked_at = ? WHERE event_id = ? AND acked_at IS NULL", new Date().toISOString(), eventId);
      return ok({ eventId });
    } catch (error) {
      return toOutcome(error);
    }
  }

  /** The order as Ship last received it, or null. */
  async getOrder(orderId: string): Promise<ShipOrder | null> {
    const row = this.sql.exec<{ record: string }>("SELECT record FROM orders WHERE order_id = ?", orderId).toArray()[0];
    return row ? JSON.parse(row.record) as ShipOrder : null;
  }

  /**
   * Queues a bought label for Commerce. The label page calls this once Pitney
   * Bowes confirms a purchase; carrier and tracking fit Commerce's 64-character,
   * single-line limit.
   */
  async recordLabel(label: Omit<LabelEvent, "eventId">): Promise<LabelEvent> {
    for (const value of [label.carrier, label.tracking]) {
      if (!value || value.length > 64 || NOT_ONE_LINE.test(value)) throw new Error("carrier and tracking must be one line of at most 64 characters");
    }
    const event = { eventId: `lbl_${crypto.randomUUID()}`, ...label };
    this.sql.exec("INSERT INTO label_events (event_id, order_id, version, carrier, tracking, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      event.eventId, event.orderId, event.version, event.carrier, event.tracking, new Date().toISOString());
    return event;
  }
}
