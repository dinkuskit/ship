import { DurableObject } from "cloudflare:workers";
import { ok, ServiceError, toOutcome, type Outcome } from "./errors.js";
import { labelAddress, type LabelAddress } from "./address.js";
import { NOT_ONE_LINE, parseShipOrder, type ShipOrder } from "./order.js";
import { practiceLabelPdf } from "./practice-pdf.js";

/** Commerce reads at most this many labels per call (dinkuskit/commerce src/features/orders/ship.ts). */
export const LABELS_PER_LIST = 100;

const EVENT_ID = /^[A-Za-z0-9._:-]{1,200}$/;

/** USPS services the owner can pick; Ground Advantage is the default (order-and-shipping-decisions answer 11). */
export const SERVICES = { GA: "USPS Ground Advantage", PM: "USPS Priority Mail", EM: "USPS Priority Mail Express" } as const;
export type ServiceCode = keyof typeof SERVICES;
/** USPS's heaviest package. */
export const MAX_WEIGHT_OZ = 70 * 16;
const MAX_BOXES = 50;

export interface ShipFrom { name: string; company?: string; line1: string; line2?: string; city: string; region: string; postalCode: string }
export interface Box { boxId: string; name: string; lengthIn: number; widthIn: number; heightIn: number; weightOz: number }
/** A label as the owner's pages show it; the PDF is fetched separately. */
export interface Label {
  labelId: string; orderId: string; version: number; test: boolean; service: ServiceCode; box: Box; weightOz: number;
  carrier: string; tracking: string; status: "bought" | "cancelled"; createdBy: string; createdAt: string; cancelledAt: string | null;
}
export interface Settings { shipFrom: ShipFrom | null; boxes: Box[]; storeName: string | null; replyTo: string | null }
export interface OrderSummary { order: ShipOrder; labels: Label[]; address: LabelAddress }

type Fields = Record<string, unknown>;

function refuse(code: string, message: string, status = 400): never {
  throw new ServiceError(status, code, message);
}

function formText(fields: Fields, key: string, label: string, max: number, optional = false): string | undefined {
  const value = typeof fields[key] === "string" ? (fields[key] as string).trim() : "";
  if (!value) return optional ? undefined : refuse("INVALID_INPUT", `${label} is required.`);
  if (value.length > max || /[\u0000-\u001f\u007f]/.test(value)) refuse("INVALID_INPUT", `${label} must be one line of at most ${max} characters.`);
  return value;
}

function formNumber(fields: Fields, key: string, label: string, min: number, max: number): number {
  const raw = typeof fields[key] === "string" ? (fields[key] as string).trim() : fields[key];
  const value = typeof raw === "number" ? raw : raw === "" || raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) refuse("INVALID_INPUT", `${label} must be a number from ${min} to ${max}.`);
  return Math.round(value * 100) / 100;
}

function randomDigits(count: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(count)), byte => String(byte % 10)).join("");
}

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
    this.sql.exec(`CREATE TABLE IF NOT EXISTS boxes (
      box_id TEXT PRIMARY KEY, name TEXT NOT NULL, length_in REAL NOT NULL, width_in REAL NOT NULL,
      height_in REAL NOT NULL, weight_oz REAL NOT NULL, created_at TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS labels (
      label_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, version INTEGER NOT NULL, test INTEGER NOT NULL,
      service TEXT NOT NULL, box TEXT NOT NULL, weight_oz REAL NOT NULL, carrier TEXT NOT NULL, tracking TEXT NOT NULL,
      pdf BLOB NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, cancelled_at TEXT)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS labels_by_order ON labels (order_id, created_at)");
  }

  private meta(key: string): string | null {
    return this.sql.exec<{ value: string }>("SELECT value FROM store_meta WHERE key = ?", key).toArray()[0]?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec("INSERT INTO store_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value);
  }

  /** Keeps the store name and reply address DinkusKit.com sent at the latest sign-in, for the shipped email. */
  async rememberStore(profile: { storeName?: string; replyTo?: string }): Promise<void> {
    if (profile.storeName) this.setMeta("store_name", profile.storeName);
    if (profile.replyTo) this.setMeta("reply_to", profile.replyTo);
  }

  async getSettings(): Promise<Settings> {
    const shipFrom = this.meta("ship_from");
    const boxes = this.sql.exec<{ box_id: string; name: string; length_in: number; width_in: number; height_in: number; weight_oz: number }>(
      "SELECT * FROM boxes ORDER BY created_at, box_id").toArray()
      .map(row => ({ boxId: row.box_id, name: row.name, lengthIn: row.length_in, widthIn: row.width_in, heightIn: row.height_in, weightOz: row.weight_oz }));
    return { shipFrom: shipFrom ? JSON.parse(shipFrom) as ShipFrom : null, boxes, storeName: this.meta("store_name"), replyTo: this.meta("reply_to") };
  }

  /** The one US address this store ships from, printed as the label's return address. */
  async saveShipFrom(fields: Fields): Promise<Outcome> {
    try {
      const company = formText(fields, "company", "Company", 200, true);
      const line2 = formText(fields, "line2", "Address line 2", 200, true);
      const shipFrom: ShipFrom = {
        name: formText(fields, "name", "Name", 200)!, ...(company ? { company } : {}),
        line1: formText(fields, "line1", "Address", 200)!, ...(line2 ? { line2 } : {}),
        city: formText(fields, "city", "City", 200)!, region: formText(fields, "region", "State", 200)!,
        postalCode: formText(fields, "postalCode", "ZIP code", 20)!,
      };
      const checked = labelAddress(shipFrom);
      if (!checked.ok) refuse("INVALID_INPUT", checked.problem.replace(/ (Add|Fix) .*$/, ""));
      this.setMeta("ship_from", JSON.stringify({ ...shipFrom, region: checked.state, postalCode: checked.zip }));
      return ok(await this.getSettings());
    } catch (error) {
      return toOutcome(error);
    }
  }

  /** Box sizes are the owner's own; none are built in (order-and-shipping-decisions answer 11). */
  async addBox(fields: Fields): Promise<Outcome> {
    try {
      const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM boxes").one().n;
      if (count >= MAX_BOXES) refuse("INVALID_INPUT", `A store can keep at most ${MAX_BOXES} box sizes.`);
      const box: Box = {
        boxId: `box_${crypto.randomUUID()}`, name: formText(fields, "name", "Box name", 60)!,
        lengthIn: formNumber(fields, "lengthIn", "Length (in)", 0.1, 108), widthIn: formNumber(fields, "widthIn", "Width (in)", 0.1, 108),
        heightIn: formNumber(fields, "heightIn", "Height (in)", 0.1, 108), weightOz: formNumber(fields, "weightOz", "Empty box weight (oz)", 0, MAX_WEIGHT_OZ),
      };
      this.sql.exec("INSERT INTO boxes (box_id, name, length_in, width_in, height_in, weight_oz, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        box.boxId, box.name, box.lengthIn, box.widthIn, box.heightIn, box.weightOz, new Date().toISOString());
      return ok(box, 201);
    } catch (error) {
      return toOutcome(error);
    }
  }

  async removeBox(boxId: string): Promise<Outcome> {
    this.sql.exec("DELETE FROM boxes WHERE box_id = ?", boxId);
    return ok({ boxId });
  }

  private labelsFor(orderId: string): Label[] {
    return this.sql.exec<Record<string, string | number | null>>(
      "SELECT label_id, order_id, version, test, service, box, weight_oz, carrier, tracking, status, created_by, created_at, cancelled_at FROM labels WHERE order_id = ? ORDER BY created_at",
      orderId).toArray().map(row => ({
        labelId: row.label_id as string, orderId: row.order_id as string, version: row.version as number, test: row.test === 1,
        service: row.service as ServiceCode, box: JSON.parse(row.box as string) as Box, weightOz: row.weight_oz as number,
        carrier: row.carrier as string, tracking: row.tracking as string, status: row.status as Label["status"],
        createdBy: row.created_by as string, createdAt: row.created_at as string, cancelledAt: row.cancelled_at as string | null,
      }));
  }

  /** Orders waiting to ship first, then the most recently changed; at most 200. */
  async listOrders(): Promise<OrderSummary[]> {
    const rows = this.sql.exec<{ record: string }>(
      `SELECT record FROM orders ORDER BY CASE WHEN json_extract(record, '$.status') = 'processing' THEN 0 ELSE 1 END, updated_at DESC LIMIT 200`).toArray();
    return rows.map(row => {
      const order = JSON.parse(row.record) as ShipOrder;
      return { order, labels: this.labelsFor(order.orderId), address: labelAddress(order.shipTo) };
    });
  }

  async orderSummary(orderId: string): Promise<OrderSummary | null> {
    const order = await this.getOrder(orderId);
    return order ? { order, labels: this.labelsFor(orderId), address: labelAddress(order.shipTo) } : null;
  }

  /**
   * Buys one label for the order's latest version. A TEST order gets a practice
   * label: a PDF marked "TEST - NOT POSTAGE" and a TEST tracking number, with no
   * call to Pitney Bowes. Either way the label is queued for Commerce, which then
   * marks the order Completed.
   */
  async buyLabel(input: { orderId: string; fields: Fields; uid: string }): Promise<Outcome> {
    try {
      const summary = await this.orderSummary(input.orderId);
      if (!summary) refuse("NOT_FOUND", "Ship has not received this order.", 404);
      const { order, labels } = summary;
      if (formNumber(input.fields, "version", "Order version", 1, Number.MAX_SAFE_INTEGER) !== order.version) {
        refuse("ORDER_CHANGED", "The order changed in Commerce since this page opened. Reload to see the latest.", 409);
      }
      if (order.status !== "processing") refuse("ALREADY_COMPLETED", "This order is already Completed in Commerce.", 409);
      if (labels.some(label => label.status === "bought" && label.version === order.version)) {
        refuse("ALREADY_LABELED", "This order already has a label. Cancel it first to buy another.", 409);
      }
      if (!summary.address.ok) refuse("ADDRESS_PROBLEM", summary.address.problem, 409);
      const settings = await this.getSettings();
      if (!settings.shipFrom) refuse("NO_SHIP_FROM", "Add your ship-from address in Settings first.", 409);
      const service = input.fields.service;
      if (typeof service !== "string" || !(service in SERVICES)) refuse("INVALID_INPUT", "Pick a USPS service.");
      const box = settings.boxes.find(candidate => candidate.boxId === input.fields.boxId);
      if (!box) refuse("INVALID_INPUT", "Pick one of your box sizes. Add box sizes in Settings.");
      const weightOz = formNumber(input.fields, "weightOz", "Package weight (oz)", 0.1, MAX_WEIGHT_OZ);
      if (!order.test) {
        refuse("POSTAGE_NOT_CONNECTED", "Buying real postage through Pitney Bowes comes in the next Ship update. TEST orders can use practice labels now.", 409);
      }
      const now = new Date().toISOString();
      const label: Label = {
        labelId: `label_${crypto.randomUUID()}`, orderId: order.orderId, version: order.version, test: true,
        service: service as ServiceCode, box, weightOz, carrier: "USPS", tracking: `TEST${randomDigits(18)}`,
        status: "bought", createdBy: input.uid, createdAt: now, cancelledAt: null,
      };
      const to = summary.address as Extract<LabelAddress, { ok: true }>;
      const pdf = practiceLabelPdf([
        `ORDER: ${order.number === null ? order.orderId : `#${order.number}`}   SERVICE: ${SERVICES[label.service]}`,
        `TRACKING: ${label.tracking}`,
        `FROM: ${settings.shipFrom.name}, ${settings.shipFrom.city} ${settings.shipFrom.region} ${settings.shipFrom.postalCode}`,
        `TO: ${to.name}`, ...to.lines.map(line => `    ${line}`), `    ${to.city} ${to.state} ${to.zip}`,
        `BOX: ${box.name} (${box.lengthIn} x ${box.widthIn} x ${box.heightIn} in)   WEIGHT: ${weightOz} oz`,
      ]);
      this.sql.exec(`INSERT INTO labels (label_id, order_id, version, test, service, box, weight_oz, carrier, tracking, pdf, status, created_by, created_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'bought', ?, ?)`,
        label.labelId, label.orderId, label.version, label.service, JSON.stringify(box), weightOz, label.carrier, label.tracking, pdf, label.createdBy, now);
      await this.recordLabel({ orderId: order.orderId, version: order.version, carrier: label.carrier, tracking: label.tracking });
      return ok(label, 201);
    } catch (error) {
      return toOutcome(error);
    }
  }

  /** Cancelling a label never changes the Commerce order (order-and-shipping-decisions answer 8). */
  async cancelLabel(labelId: string): Promise<Outcome> {
    const changed = this.sql.exec("UPDATE labels SET status = 'cancelled', cancelled_at = ? WHERE label_id = ? AND status = 'bought'",
      new Date().toISOString(), labelId).rowsWritten;
    return changed ? ok({ labelId }) : toOutcome(new ServiceError(404, "NOT_FOUND", "No label to cancel."));
  }

  /** The order a label belongs to, for going back to its page. */
  async labelOrder(labelId: string): Promise<string | null> {
    return this.sql.exec<{ order_id: string }>("SELECT order_id FROM labels WHERE label_id = ?", labelId).toArray()[0]?.order_id ?? null;
  }

  async labelPdf(labelId: string): Promise<ArrayBuffer | null> {
    return this.sql.exec<{ pdf: ArrayBuffer }>("SELECT pdf FROM labels WHERE label_id = ?", labelId).toArray()[0]?.pdf ?? null;
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
