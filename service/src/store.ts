import { assertOrder, assertTuple, isolation, tuple } from "./isolation.js";
import { DurableObject } from "cloudflare:workers";
import { ok, ServiceError, toOutcome, type Outcome } from "./errors.js";
import { labelAddress, type LabelAddress } from "./address.js";
import { NOT_ONE_LINE, parseShipOrder, type ShipOrder } from "./order.js";
import { authorizeMerchant, buy, downloadPdf, findPurchase, newTransactionId, PitneyError, pitneyConfig, quote, voidLabel, type PbConfig, type PbLabel, type PbShipment } from "./pitney.js";
import { practiceLabelPdf } from "./practice-pdf.js";
import { DEFAULT_FROM, shippedEmail } from "./shipped-email.js";
import { GRACE_SECONDS, REFRESH_SECONDS } from "./session.js";
import type { Delivery } from "./delivery.js";
import { trackingIndex } from "./tracking.js";

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
  /** A free practice PDF made by Ship itself, never sent to Pitney Bowes. */
  practice: boolean;
  /** What Pitney Bowes charged (nothing is charged in its sandbox); null for practice labels. */
  priceCents: number | null;
  /** PB's refund state after a cancel ("INITIATED" or "APPROVED"); null otherwise. */
  refund: string | null;
  /** Where the carrier says a live label is (ship-tracking-001); null until its first scan, and always for sandbox and practice labels. */
  delivery: Delivery | null;
}
export interface Settings {
  shipFrom: ShipFrom | null; boxes: Box[]; storeName: string | null; replyTo: string | null;
  /** Whether Ship can buy labels from Pitney Bowes. */
  postageConnected: boolean;
  /** The store owner's own PB postage account, which pays for real orders' labels; null until they connect it. */
  postageAccount: PostageAccount | null;
  /** DinkusKit's PB developer id for the owner's sign-up link; null while Ship cannot connect owners' accounts. */
  signupDeveloperId: string | null;
  /** Whether TEST orders get free Pitney Bowes sandbox labels instead of practice labels. */
  testSandbox: boolean;
}
export type Quotes = Partial<Record<ServiceCode, number | null>>;
/** The owner's PB postage account as Ship keeps it: never their PB password. */
export interface PostageAccount {
  shipperId: string; company: string | null; email: string | null;
  /** The last four characters of PB's postage account number, for the owner to recognize it. */
  accountEnding: string | null;
  connectedBy: string; connectedAt: string;
}

/** A Pitney Bowes purchase Ship sent and has not finished recording. */
type Purchase = { transaction_id: string; order_id: string; version: number; test: number; service: string; box: string; weight_oz: number; state: string; created_by: string; created_at: number };
const NOT_CONNECTED = "Pitney Bowes is not connected to Ship yet, so only TEST orders can get labels: practice labels with no postage.";
/** How long a purchase counts as still in flight before another page may check on it. */
const IN_FLIGHT_MS = 60_000;
/** How long a forwarded "Create shipping label" waits for the store admin's Shipping page to open it. */
const ADMIN_OPEN_MS = 60_000;
/** A Shipping page, or an admin, the plugin has not called from in this long is forgotten: Commerce's button goes back to Ship's own page. */
const ADMIN_PAGE_FRESH_MS = 7 * 86_400_000;
/** Refresh a page's or an admin's last-seen time at most this often, so the plugin's every call does not write. */
const ADMIN_PAGE_TOUCH_MS = 60 * 60_000;
/** The most store admins Ship keeps the last-seen time of; the least recently seen make room. */
const ADMIN_USERS_MAX = 50;
/** Emails compare without case: EmDash's and DinkusKit.com's may spell the same address differently. */
const adminEmail = (email: string) => email.trim().toLowerCase();

/** Orders completed this long before the store first sent Ship anything get no email (clock differences aside). */
const BEFORE_CONNECT_MS = 15 * 60_000;
/** Waits between tries when the email service fails; after the last one the email is given up. */
const EMAIL_RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000];
/** A completion older than this is not emailed any more, however it got stuck. */
const EMAIL_MAX_AGE_MS = 3 * 24 * 3_600_000;
const EMAILS_PER_ALARM = 25;
/** Waits between tries when the tracking index cannot be reached; the last one repeats until it can. */
const TRACKING_RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
/** Waiting "open this order" handoffs kept per store, one per admin; the oldest make room. */
const ADMIN_OPEN_MAX = 50;
export interface OrderSummary { order: ShipOrder; labels: Label[]; address: LabelAddress }

type Fields = Record<string, unknown>;

function refuse(code: string, message: string, status = 400): never {
  throw new ServiceError(status, code, message);
}

function formText(fields: Fields, key: string, label: string, max: number, optional = false): string | undefined {
  const value = typeof fields[key] === "string" ? (fields[key] as string).trim() : "";
  if (!value) return optional ? undefined : refuse("INVALID_INPUT", `${label} is required.`);
  if (value.length > max || NOT_ONE_LINE.test(value)) refuse("INVALID_INPUT", `${label} must be one line of at most ${max} characters.`);
  return value;
}

function formNumber(fields: Fields, key: string, label: string, min: number, max: number): number {
  const raw = typeof fields[key] === "string" ? (fields[key] as string).trim() : fields[key];
  const value = typeof raw === "number" ? raw : raw === "" || raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) refuse("INVALID_INPUT", `${label} must be a number from ${min} to ${max}.`);
  return Math.round(value * 100) / 100;
}

/** Columns labels gained with Pitney Bowes postage; a store made before then gets them added once. */
const LABEL_COLUMNS = { price_cents: "INTEGER", shipment_id: "TEXT", pdf_url: "TEXT", refund: "TEXT", delivery_state: "TEXT", delivery_at: "TEXT", delivery_note: "TEXT" } as const;

/** Columns purchases gained when TEST orders got Pitney Bowes sandbox labels. */
const PURCHASE_COLUMNS = { test: "INTEGER NOT NULL DEFAULT 0" } as const;

function addColumns(sql: SqlStorage, table: "labels" | "purchases", columns: Record<string, string>): void {
  const present = new Set(sql.exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`).toArray().map(row => row.name));
  for (const [column, type] of Object.entries(columns)) {
    if (!present.has(column)) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function addLabelColumns(sql: SqlStorage): void {
  addColumns(sql, "labels", LABEL_COLUMNS);
}

export function addPurchaseColumns(sql: SqlStorage): void {
  addColumns(sql, "purchases", PURCHASE_COLUMNS);
}

/**
 * TEST orders get free Pitney Bowes sandbox labels only while Ship runs on PB's
 * sandbox, checked here by name so a live setup can never buy postage for one.
 */
export function testUsesSandbox(env: Env): boolean {
  return env.PB_ENVIRONMENT === "sandbox" && pitneyConfig(env) !== null;
}

/** Pitney Bowes failures become messages for the owner's page. */
function asServiceError(error: unknown): unknown {
  if (!(error instanceof PitneyError)) return error;
  if (error.kind === "refused") return new ServiceError(422, "PITNEY_BOWES_REFUSED", error.message);
  return new ServiceError(503, "PITNEY_BOWES_UNAVAILABLE", error.message);
}

function randomDigits(count: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(count)), byte => String(byte % 10)).join("");
}

/** A label Ship bought, as Commerce picks it up from GET /v1/labels. */
export interface LabelEvent {
  recipient?: "ship-sandbox"; generation?: string; mode?: "test";
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
    addLabelColumns(this.sql);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS purchases (
      transaction_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, version INTEGER NOT NULL, service TEXT NOT NULL, box TEXT NOT NULL,
      weight_oz REAL NOT NULL, state TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    addPurchaseColumns(this.sql);
    this.sql.exec("CREATE INDEX IF NOT EXISTS labels_by_order ON labels (order_id, created_at)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS shipped_emails (
      order_id TEXT NOT NULL, completed_at TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, sent_at INTEGER, PRIMARY KEY (order_id, completed_at))`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS shipped_emails_due ON shipped_emails (state, next_at)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS tracking_work (
      label_id TEXT PRIMARY KEY, tracking TEXT NOT NULL, action TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY, uid TEXT NOT NULL, email TEXT NOT NULL, refresh_token TEXT NOT NULL,
      checked_at INTEGER NOT NULL, refreshing_until INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
  }

  private checkIsolation(): void {
    const config = isolation(this.env), kept = this.meta("isolation_tuple");
    if (!config) { if (kept) throw new ServiceError(403, "FORBIDDEN", "isolated storage cannot serve legacy requests"); return; }
    const expected = JSON.stringify({ recipient: config.recipient, generation: config.generation, site: config.site });
    if (kept && kept !== expected) throw new ServiceError(403, "FORBIDDEN", "storage generation does not match");
    if (!kept) {
      if (this.sql.exec<{ n: number }>("SELECT (SELECT COUNT(*) FROM orders) + (SELECT COUNT(*) FROM sessions) + (SELECT COUNT(*) FROM labels) + (SELECT COUNT(*) FROM label_events) + (SELECT COUNT(*) FROM purchases) + (SELECT COUNT(*) FROM boxes) + (SELECT COUNT(*) FROM store_meta) + (SELECT COUNT(*) FROM shipped_emails) + (SELECT COUNT(*) FROM tracking_work) AS n").one().n) throw new ServiceError(403, "FORBIDDEN", "isolated storage must start empty");
      this.setMeta("isolation_tuple", expected);
    }
  }
  private admitStoredOrder(order: ShipOrder): void {
    this.checkIsolation();
    assertTuple(this.env, order as unknown as Record<string, unknown>);
    assertOrder(this.env, order.orderId, order.test);
  }
  private async admitLabel(labelId: string): Promise<void> {
    this.checkIsolation();
    if (!isolation(this.env)) return;
    const id = await this.labelOrder(labelId), order = id ? await this.getOrder(id) : null;
    if (!order) throw new ServiceError(404, "NOT_FOUND", "label not found");
    this.admitStoredOrder(order);
  }
  private meta(key: string): string | null {
    return this.sql.exec<{ value: string }>("SELECT value FROM store_meta WHERE key = ?", key).toArray()[0]?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec("INSERT INTO store_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value);
  }

  /**
   * A person signed in through DinkusKit.com. The refresh token stays here, never in
   * the browser. The first sign-in fills the reply-to address with their email.
   */
  async startSession(uid: string, email: string, refreshToken: string): Promise<string> {
    this.checkIsolation();
    const sessionId = crypto.randomUUID();
    this.sql.exec(`INSERT INTO sessions (session_id, uid, email, refresh_token, checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      sessionId, uid, email, refreshToken, Math.floor(Date.now() / 1000), new Date().toISOString());
    this.sql.exec("INSERT OR IGNORE INTO store_meta (key, value) VALUES ('reply_to', ?)", email);
    return sessionId;
  }

  /**
   * The session, and the refresh token when it is due for a check with DinkusKit.com.
   * Only one request at a time gets the token: a refresh token works once, and a
   * second use would end the person's sign-in. The others carry on in the grace window.
   */
  async readSession(sessionId: string): Promise<{ uid: string; email: string; refreshToken?: string; withinGrace: boolean } | null> {
    this.checkIsolation();
    const row = this.sql.exec<{ uid: string; email: string; refresh_token: string; checked_at: number; refreshing_until: number }>(
      "SELECT uid, email, refresh_token, checked_at, refreshing_until FROM sessions WHERE session_id = ?", sessionId).toArray()[0];
    if (!row) return null;
    const now = Math.floor(Date.now() / 1000);
    const withinGrace = now - row.checked_at < GRACE_SECONDS;
    if (now - row.checked_at < REFRESH_SECONDS) return { uid: row.uid, email: row.email, withinGrace };
    if (row.refreshing_until > now) return withinGrace ? { uid: row.uid, email: row.email, withinGrace } : null;
    this.sql.exec("UPDATE sessions SET refreshing_until = ? WHERE session_id = ?", now + 30, sessionId);
    return { uid: row.uid, email: row.email, refreshToken: row.refresh_token, withinGrace };
  }

  async refreshedSession(sessionId: string, refreshToken: string, email: string): Promise<void> {
    this.checkIsolation();
    this.sql.exec("UPDATE sessions SET refresh_token = ?, email = ?, checked_at = ?, refreshing_until = 0 WHERE session_id = ?",
      refreshToken, email, Math.floor(Date.now() / 1000), sessionId);
  }

  /** DinkusKit.com was busy or down: try again on a later page. */
  async refreshFailed(sessionId: string): Promise<void> {
    this.checkIsolation();
    this.sql.exec("UPDATE sessions SET refreshing_until = 0 WHERE session_id = ?", sessionId);
  }

  async endSession(sessionId: string): Promise<void> {
    this.checkIsolation();
    this.sql.exec("DELETE FROM sessions WHERE session_id = ?", sessionId);
  }

  /** Where shoppers' replies to the shipped email go. */
  async saveReplyTo(fields: Fields): Promise<Outcome> {
    try {
      this.checkIsolation();
      const replyTo = formText(fields, "replyTo", "Reply-to email", 254)!;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) refuse("INVALID_INPUT", "Reply-to email must be an email address.");
      this.setMeta("reply_to", replyTo);
      return ok(await this.getSettings());
    } catch (error) {
      return toOutcome(error);
    }
  }

  async getSettings(): Promise<Settings> {
    this.checkIsolation();
    const shipFrom = this.meta("ship_from");
    const boxes = this.sql.exec<{ box_id: string; name: string; length_in: number; width_in: number; height_in: number; weight_oz: number }>(
      "SELECT * FROM boxes ORDER BY created_at, box_id").toArray()
      .map(row => ({ boxId: row.box_id, name: row.name, lengthIn: row.length_in, widthIn: row.width_in, heightIn: row.height_in, weightOz: row.weight_oz }));
    return {
      shipFrom: shipFrom ? JSON.parse(shipFrom) as ShipFrom : null, boxes, storeName: this.meta("store_name"), replyTo: this.meta("reply_to"),
      postageConnected: pitneyConfig(this.env) !== null, testSandbox: testUsesSandbox(this.env),
      postageAccount: this.postageAccount(),
      signupDeveloperId: !isolation(this.env) && pitneyConfig(this.env) && this.env.PB_DEVELOPER_ID ? this.env.PB_DEVELOPER_ID : null,
    };
  }

  /** The one US address this store ships from, printed as the label's return address. */
  async saveShipFrom(fields: Fields): Promise<Outcome> {
    try {
      this.checkIsolation();
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
      this.checkIsolation();
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

  private postageAccount(): PostageAccount | null {
    const kept = this.meta("pb_account");
    return kept ? JSON.parse(kept) as PostageAccount : null;
  }

  /**
   * Connects the owner's own PB postage account (decision 2a). The username and password
   * go to PB once to find the account's Shipper ID; Ship keeps only what PostageAccount holds.
   */
  async connectPostage(fields: Fields, uid: string): Promise<Outcome> {
    try {
      this.checkIsolation();
      const config = pitneyConfig(this.env);
      const developerId = this.env.PB_DEVELOPER_ID;
      if (isolation(this.env)) refuse("FORBIDDEN", "owner postage connections are unavailable in the isolated test service", 403);
      if (!config || !developerId) refuse("POSTAGE_NOT_CONNECTED", "Ship cannot connect Pitney Bowes accounts yet.", 409);
      const username = formText(fields, "username", "Pitney Bowes username", 254)!;
      const password = typeof fields.password === "string" ? fields.password : "";
      if (!password || password.length > 200) refuse("INVALID_INPUT", "Enter your Pitney Bowes password.");
      const merchant = await authorizeMerchant(config, developerId, username, password);
      const account: PostageAccount = {
        shipperId: merchant.shipperId, company: merchant.company, email: merchant.email,
        accountEnding: merchant.accountNumber ? merchant.accountNumber.slice(-4) : null,
        connectedBy: uid, connectedAt: new Date().toISOString(),
      };
      this.setMeta("pb_account", JSON.stringify(account));
      return ok(account);
    } catch (error) {
      return toOutcome(asServiceError(error));
    }
  }

  /** Real orders cannot get labels again until an account is connected. Labels already bought stay, and can still be cancelled. */
  async disconnectPostage(): Promise<Outcome> {
    try {
      this.checkIsolation();
      if (isolation(this.env)) refuse("FORBIDDEN", "owner postage connections are unavailable in the isolated test service", 403);
      this.sql.exec("DELETE FROM store_meta WHERE key = 'pb_account'");
      return ok({ disconnected: true });
    } catch (error) {
      return toOutcome(error);
    }
  }

  /**
   * Who pays for a label: a TEST order's sandbox label is paid by PB's sandbox test
   * merchant; a real order's by the store's own connected postage account, never DinkusKit's.
   */
  private postageConfig(test: boolean): PbConfig {
    const config = pitneyConfig(this.env);
    if (!config) refuse("POSTAGE_NOT_CONNECTED", NOT_CONNECTED, 409);
    if (test) return config;
    const account = this.postageAccount();
    if (!account) refuse("NO_POSTAGE_ACCOUNT", "Connect your Pitney Bowes postage account in Settings before buying labels for real orders.", 409);
    return { ...config, shipperId: account.shipperId };
  }

  async removeBox(boxId: string): Promise<Outcome> {
    try {
      this.checkIsolation();
      this.sql.exec("DELETE FROM boxes WHERE box_id = ?", boxId);
      return ok({ boxId });
    } catch (error) {
      return toOutcome(error);
    }
  }

  private labelsFor(orderId: string): Label[] {
    return this.sql.exec<Record<string, string | number | null>>(
      "SELECT label_id, order_id, version, test, service, box, weight_oz, carrier, tracking, status, created_by, created_at, cancelled_at, price_cents, refund, shipment_id, delivery_state, delivery_at, delivery_note FROM labels WHERE order_id = ? ORDER BY created_at",
      orderId).toArray().map(row => ({
        labelId: row.label_id as string, orderId: row.order_id as string, version: row.version as number, test: row.test === 1,
        service: row.service as ServiceCode, box: JSON.parse(row.box as string) as Box, weightOz: row.weight_oz as number,
        carrier: row.carrier as string, tracking: row.tracking as string, status: row.status as Label["status"],
        createdBy: row.created_by as string, createdAt: row.created_at as string, cancelledAt: row.cancelled_at as string | null,
        practice: row.test === 1 && row.shipment_id === null, priceCents: row.price_cents as number | null, refund: row.refund as string | null,
        delivery: row.delivery_state && row.delivery_at ? { state: row.delivery_state as Delivery["state"], at: row.delivery_at as string, note: row.delivery_note as string | null } : null,
      }));
  }

  /**
   * The carrier's latest word on a live label, from Pitney Bowes's update or the
   * daily check. Updates can arrive out of order: a delivered label stays delivered,
   * and an older scan never replaces a newer one. Answers the state the label is
   * left in, which is what the tracking index goes by, or null for a label this
   * store does not have, or a sandbox or practice one, which never moves.
   */
  async recordDelivery(labelId: string, delivery: Delivery): Promise<Delivery["state"] | null> {
    this.checkIsolation();
    const row = this.sql.exec<{ delivery_state: Delivery["state"] | null; delivery_at: string | null }>(
      "SELECT delivery_state, delivery_at FROM labels WHERE label_id = ? AND test = 0", labelId).toArray()[0];
    if (!row) return null;
    if (row.delivery_state === "delivered" && delivery.state !== "delivered") return row.delivery_state;
    if (row.delivery_state && row.delivery_at && row.delivery_at > delivery.at) return row.delivery_state;
    this.sql.exec("UPDATE labels SET delivery_state = ?, delivery_at = ?, delivery_note = ? WHERE label_id = ?", delivery.state, delivery.at, delivery.note, labelId);
    return delivery.state;
  }

  /** Orders waiting to ship first, then the most recently changed; at most 200. */
  async listOrders(): Promise<OrderSummary[]> {
    this.checkIsolation();
    const rows = this.sql.exec<{ record: string }>(
      `SELECT record FROM orders ORDER BY CASE WHEN json_extract(record, '$.status') = 'processing' THEN 0 ELSE 1 END, updated_at DESC LIMIT 200`).toArray();
    return rows.map(row => {
      const order = JSON.parse(row.record) as ShipOrder;
      this.admitStoredOrder(order);
      return { order, labels: this.labelsFor(order.orderId), address: labelAddress(order.shipTo) };
    });
  }

  async orderSummary(orderId: string): Promise<OrderSummary | null> {
    const order = await this.getOrder(orderId);
    if (order) this.admitStoredOrder(order);
    return order ? { order, labels: this.labelsFor(orderId), address: labelAddress(order.shipTo) } : null;
  }

  /** Checks a label form against the order's latest version and the store's settings. */
  private async labelRequest(orderId: string, fields: Fields, needService: boolean) {
    const summary = await this.orderSummary(orderId);
    if (!summary) refuse("NOT_FOUND", "Ship has not received this order.", 404);
    const { order } = summary;
    this.admitStoredOrder(order);
    if (formNumber(fields, "version", "Order version", 1, Number.MAX_SAFE_INTEGER) !== order.version) {
      refuse("ORDER_CHANGED", "The order changed in Commerce since this page opened. Reload to see the latest.", 409);
    }
    if (order.status !== "processing") refuse("ALREADY_COMPLETED", "This order is already Completed in Commerce.", 409);
    this.refuseIfLabeled(order.orderId, order.version);
    if (!summary.address.ok) refuse("ADDRESS_PROBLEM", summary.address.problem, 409);
    const settings = await this.getSettings();
    if (!settings.shipFrom) refuse("NO_SHIP_FROM", "Add your ship-from address in Settings first.", 409);
    const service = fields.service;
    if (needService && (typeof service !== "string" || !(service in SERVICES))) refuse("INVALID_INPUT", "Pick a USPS service.");
    const box = settings.boxes.find(candidate => candidate.boxId === fields.boxId);
    if (!box) refuse("INVALID_INPUT", "Pick one of your box sizes. Add box sizes in Settings.");
    const weightOz = formNumber(fields, "weightOz", "Package weight (oz)", 0.1, MAX_WEIGHT_OZ);
    const to = summary.address as Extract<LabelAddress, { ok: true }>;
    const from = settings.shipFrom;
    const shipment = (code: ServiceCode): PbShipment => ({
      from: { name: from.name, ...(from.company ? { company: from.company } : {}), lines: [from.line1, from.line2].filter((line): line is string => Boolean(line)), city: from.city, state: from.region, zip: from.postalCode },
      to: { name: to.name, lines: to.lines, city: to.city, state: to.state, zip: to.zip },
      service: code, weightOz, lengthIn: box.lengthIn, widthIn: box.widthIn, heightIn: box.heightIn,
    });
    return { order, settings, from, to, box, weightOz, service: service as ServiceCode, shipment };
  }

  /** One live label per order version; a purchase still in flight counts too. */
  private refuseIfLabeled(orderId: string, version: number): void {
    const live = this.sql.exec("SELECT 1 FROM labels WHERE order_id = ? AND version = ? AND status = 'bought'", orderId, version).toArray().length;
    if (live) refuse("ALREADY_LABELED", "This order already has a label. Cancel it first to buy another.", 409);
  }

  private openPurchase(orderId: string): Purchase | undefined {
    return this.sql.exec<Purchase>("SELECT * FROM purchases WHERE order_id = ? ORDER BY created_at LIMIT 1", orderId).toArray()[0];
  }

  /** What each USPS service costs for this package, from the store's PB postage account (or PB's sandbox for a TEST order). */
  async quoteLabel(input: { orderId: string; fields: Fields }): Promise<Outcome> {
    try {
      const request = await this.labelRequest(input.orderId, input.fields, false);
      if (request.order.test && !testUsesSandbox(this.env)) refuse("TEST_ORDER", "Practice labels for TEST orders are free.", 409);
      const config = this.postageConfig(request.order.test);
      const codes = Object.keys(SERVICES) as ServiceCode[];
      const prices = await Promise.allSettled(codes.map(code => quote(config, request.shipment(code))));
      const unreachable = prices.find(result => result.status === "rejected" && !(result.reason instanceof PitneyError && result.reason.kind === "refused"));
      if (unreachable) throw unreachable.status === "rejected" && unreachable.reason instanceof PitneyError ? unreachable.reason : new Error("quote failed");
      const quotes: Quotes = {};
      codes.forEach((code, index) => {
        const result = prices[index]!;
        quotes[code] = result.status === "fulfilled" ? result.value : null;
      });
      return ok(quotes);
    } catch (error) {
      return toOutcome(asServiceError(error));
    }
  }

  /**
   * Buys one label for the order's latest version. A TEST order gets a free label
   * from Pitney Bowes's sandbox while Ship runs on it, and stays TEST; otherwise,
   * or when the owner asks for one, it gets a practice label: a PDF marked
   * "TEST - NOT POSTAGE" and a TEST tracking number, with no call to Pitney Bowes.
   * A real order's label is bought from Pitney Bowes and charged to the store's
   * own PB postage account. Either way the label is queued for Commerce, which
   * then marks the order Completed.
   */
  async buyLabel(input: { orderId: string; fields: Fields; uid: string }): Promise<Outcome> {
    try {
      const request = await this.labelRequest(input.orderId, input.fields, true);
      if (!request.order.test) return await this.postageLabel(request, input);
      return testUsesSandbox(this.env) && input.fields.kind !== "practice"
        ? await this.postageLabel(request, input) : this.practiceLabel(request, input.uid);
    } catch (error) {
      return toOutcome(asServiceError(error));
    }
  }

  private practiceLabel(request: Awaited<ReturnType<StoreShipping["labelRequest"]>>, uid: string): Outcome {
    const { order, from, to, box, weightOz, service } = request;
    if (this.openPurchase(order.orderId)) refuse("LABEL_IN_PROGRESS", "Ship is buying a sandbox label for this order. Reload the page in a moment.", 409);
    const now = new Date().toISOString();
    const label: Label = {
      labelId: `label_${crypto.randomUUID()}`, orderId: order.orderId, version: order.version, test: true,
      service, box, weightOz, carrier: "USPS", tracking: `TEST${randomDigits(18)}`,
      status: "bought", createdBy: uid, createdAt: now, cancelledAt: null, practice: true, priceCents: null, refund: null, delivery: null,
    };
    const pdf = practiceLabelPdf([
      `ORDER: ${order.number === null ? order.orderId : `#${order.number}`}   SERVICE: ${SERVICES[label.service]}`,
      `TRACKING: ${label.tracking}`,
      `FROM: ${from.name}, ${from.city} ${from.region} ${from.postalCode}`,
      `TO: ${to.name}`, ...to.lines.map(line => `    ${line}`), `    ${to.city} ${to.state} ${to.zip}`,
      `BOX: ${box.name} (${box.lengthIn} x ${box.widthIn} x ${box.heightIn} in)   WEIGHT: ${weightOz} oz`,
    ]);
    this.sql.exec(`INSERT INTO labels (label_id, order_id, version, test, service, box, weight_oz, carrier, tracking, pdf, status, created_by, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'bought', ?, ?)`,
      label.labelId, label.orderId, label.version, label.service, JSON.stringify(box), weightOz, label.carrier, label.tracking, pdf, label.createdBy, now);
    this.queueLabel({ orderId: order.orderId, version: order.version, carrier: label.carrier, tracking: label.tracking });
    return ok(label, 201);
  }

  /**
   * Pitney Bowes keeps a purchase's transaction id, so when its answer is lost
   * Ship looks the label up before buying again, and never buys a second label
   * for that order without the owner saying so.
   */
  private async postageLabel(request: Awaited<ReturnType<StoreShipping["labelRequest"]>>, input: { orderId: string; fields: Fields; uid: string }): Promise<Outcome> {
    const { order } = request;
    // Never buys postage for a TEST order outside Pitney Bowes's sandbox.
    if (order.test && !testUsesSandbox(this.env)) refuse("TEST_ORDER", "TEST orders get practice labels while Ship is not on the Pitney Bowes sandbox.", 409);
    const config = this.postageConfig(order.test);
    const earlier = this.openPurchase(order.orderId);
    if (earlier) {
      if (earlier.state === "pending" && Date.now() - earlier.created_at < IN_FLIGHT_MS) {
        refuse("LABEL_IN_PROGRESS", "Ship is buying a label for this order right now. Reload the page in a moment.", 409);
      }
      const found = await findPurchase(config, earlier.transaction_id);
      if (found) return ok(await this.finishPurchase(earlier, found), 201);
      if (input.fields.buyAgain !== "yes") {
        refuse("CHECK_PITNEY_BOWES", "Pitney Bowes did not answer the last time Ship bought a label for this order, and it has no record of that label. Tick \"Buy a new label\" to buy one now.", 409);
      }
      this.sql.exec("DELETE FROM purchases WHERE transaction_id = ? AND state = ?", earlier.transaction_id, earlier.state);
    }
    // Nothing above may have changed while Ship waited on Pitney Bowes.
    this.refuseIfLabeled(order.orderId, order.version);
    if (this.openPurchase(order.orderId)) refuse("LABEL_IN_PROGRESS", "Ship is buying a label for this order right now. Reload the page in a moment.", 409);
    const purchase: Purchase = {
      transaction_id: newTransactionId(), order_id: order.orderId, version: order.version, test: order.test ? 1 : 0, service: request.service,
      box: JSON.stringify(request.box), weight_oz: request.weightOz, state: "pending", created_by: input.uid, created_at: Date.now(),
    };
    this.sql.exec(`INSERT INTO purchases (transaction_id, order_id, version, test, service, box, weight_oz, state, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      purchase.transaction_id, purchase.order_id, purchase.version, purchase.test, purchase.service, purchase.box, purchase.weight_oz, purchase.state, purchase.created_by, purchase.created_at);
    let bought: PbLabel;
    try {
      bought = await buy(config, request.shipment(request.service), purchase.transaction_id);
    } catch (error) {
      if (error instanceof PitneyError && error.kind === "unknown") {
        this.sql.exec("UPDATE purchases SET state = 'unknown' WHERE transaction_id = ?", purchase.transaction_id);
        refuse("PITNEY_BOWES_NO_ANSWER", `Pitney Bowes did not confirm the label${error.detail ? ` (${error.detail})` : ""}, so Ship does not know yet whether it was bought. Press Buy label again: Ship checks with Pitney Bowes first and does not buy a second label without asking.`, 502);
      }
      this.sql.exec("DELETE FROM purchases WHERE transaction_id = ?", purchase.transaction_id);
      throw error;
    }
    return ok(await this.finishPurchase(purchase, bought), 201);
  }

  /** Keeps a label Pitney Bowes sold, with a copy of its PDF, and queues it for Commerce. */
  private async finishPurchase(purchase: Purchase, bought: PbLabel): Promise<Label> {
    let pdf: Uint8Array = new Uint8Array();
    try {
      pdf = await downloadPdf(bought.pdfUrl);
    } catch {
      // The label is bought either way; its page fetches the PDF again when opened.
    }
    this.sql.exec("DELETE FROM purchases WHERE transaction_id = ?", purchase.transaction_id);
    const kept = this.sql.exec<{ label_id: string }>("SELECT label_id FROM labels WHERE shipment_id = ?", bought.shipmentId).toArray()[0];
    // Another page recorded this purchase while the PDF downloaded.
    if (kept) return this.labelsFor(purchase.order_id).find(label => label.labelId === kept.label_id)!;
    const now = new Date().toISOString();
    const label: Label = {
      labelId: `label_${crypto.randomUUID()}`, orderId: purchase.order_id, version: purchase.version, test: purchase.test === 1,
      service: purchase.service as ServiceCode, box: JSON.parse(purchase.box) as Box, weightOz: purchase.weight_oz, carrier: "USPS",
      tracking: bought.tracking, status: "bought", createdBy: purchase.created_by, createdAt: now, cancelledAt: null,
      practice: false, priceCents: bought.priceCents, refund: null, delivery: null,
    };
    this.sql.exec(`INSERT INTO labels (label_id, order_id, version, test, service, box, weight_oz, carrier, tracking, pdf, status, created_by, created_at, price_cents, shipment_id, pdf_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bought', ?, ?, ?, ?, ?)`,
      label.labelId, label.orderId, label.version, purchase.test, label.service, purchase.box, label.weightOz, label.carrier, label.tracking, pdf,
      label.createdBy, now, label.priceCents, bought.shipmentId, bought.pdfUrl);
    this.queueLabel({ orderId: label.orderId, version: label.version, carrier: label.carrier, tracking: label.tracking });
    // A live label's number goes in the tracking index, so the carrier's updates find this store (ship-tracking-001).
    if (!label.test) await this.queueTracking(label.labelId, label.tracking, "add");
    return label;
  }

  /**
   * Work for the tracking index, kept beside the label until it is done: the
   * index is another Durable Object, and a label Pitney Bowes sold is bought
   * whether or not that object answers right now. The row is written in the
   * same step as the label, tried at once, and tried again from the alarm
   * until the index takes it. A later action on the same label replaces an
   * earlier one still waiting (a cancel after a buy leaves nothing to add).
   */
  private async queueTracking(labelId: string, tracking: string, action: "add" | "remove"): Promise<void> {
    const now = Date.now();
    this.sql.exec("INSERT OR REPLACE INTO tracking_work (label_id, tracking, action, attempts, next_at, created_at) VALUES (?, ?, ?, 0, ?, ?)",
      labelId, tracking, action, now, now);
    await this.syncTracking();
  }

  /** Tries the tracking work that is due; what fails waits for the alarm. */
  private async syncTracking(): Promise<void> {
    const now = Date.now();
    const due = this.sql.exec<{ label_id: string; tracking: string; action: string; attempts: number }>(
      "SELECT label_id, tracking, action, attempts FROM tracking_work WHERE next_at <= ? ORDER BY next_at LIMIT 100", now).toArray();
    for (const row of due) {
      try {
        const index = trackingIndex(this.env);
        if (row.action === "add") await index.add({ tracking: row.tracking, site: this.ctx.id.name ?? "", labelId: row.label_id });
        else await index.remove(row.tracking);
        this.sql.exec("DELETE FROM tracking_work WHERE label_id = ? AND action = ?", row.label_id, row.action);
      } catch (error) {
        console.error("ship tracking index unreachable", JSON.stringify({ action: row.action, attempts: row.attempts, message: error instanceof Error ? error.message : "unknown" }));
        const wait = TRACKING_RETRY_MS[Math.min(row.attempts, TRACKING_RETRY_MS.length - 1)]!;
        this.sql.exec("UPDATE tracking_work SET attempts = attempts + 1, next_at = ? WHERE label_id = ?", Date.now() + wait, row.label_id);
      }
    }
    await this.wakeForTracking();
  }

  private async wakeForTracking(): Promise<void> {
    const next = this.sql.exec<{ next_at: number | null }>("SELECT MIN(next_at) AS next_at FROM tracking_work").one().next_at;
    if (next !== null) await this.wakeAt(Math.max(next, Date.now() + 1000));
  }

  /**
   * Cancelling a label never changes the Commerce order (order-and-shipping-decisions answer 8).
   * A label from Pitney Bowes (sandbox ones too) is voided there first, and USPS refunds
   * the store's postage account. A practice label has nothing to void.
   */
  async cancelLabel(labelId: string): Promise<Outcome> {
    try {
      await this.admitLabel(labelId);
      const row = this.sql.exec<{ test: number; shipment_id: string | null; tracking: string }>(
        "SELECT test, shipment_id, tracking FROM labels WHERE label_id = ? AND status = 'bought'", labelId).toArray()[0];
      if (!row) refuse("NOT_FOUND", "No label to cancel.", 404);
      let refund: string | null = null;
      if (row.shipment_id || !row.test) {
        const config = pitneyConfig(this.env);
        if (!config || !row.shipment_id) refuse("POSTAGE_NOT_CONNECTED", "Pitney Bowes is not connected to Ship right now, so the label cannot be cancelled yet.", 503);
        refund = await voidLabel(config, row.shipment_id);
      }
      this.sql.exec("UPDATE labels SET status = 'cancelled', cancelled_at = ?, refund = ? WHERE label_id = ? AND status = 'bought'",
        new Date().toISOString(), refund, labelId);
      if (!row.test) await this.queueTracking(labelId, row.tracking, "remove");
      return ok({ labelId, refund });
    } catch (error) {
      return toOutcome(asServiceError(error));
    }
  }

  /** The order a label belongs to, for going back to its page. */
  async labelOrder(labelId: string): Promise<string | null> {
    this.checkIsolation();
    const orderId = this.sql.exec<{ order_id: string }>("SELECT order_id FROM labels WHERE label_id = ?", labelId).toArray()[0]?.order_id ?? null;
    if (orderId && isolation(this.env) && !(await this.getOrder(orderId))) {
      throw new ServiceError(403, "FORBIDDEN", "label order is not admitted");
    }
    return orderId;
  }

  /** The label's PDF; "not_ready" when Pitney Bowes's copy could not be downloaded yet. */
  async labelPdf(labelId: string): Promise<ArrayBuffer | Uint8Array | "not_ready" | null> {
    await this.admitLabel(labelId);
    const row = this.sql.exec<{ pdf: ArrayBuffer; pdf_url: string | null }>("SELECT pdf, pdf_url FROM labels WHERE label_id = ?", labelId).toArray()[0];
    if (!row) return null;
    if (row.pdf.byteLength > 0) return row.pdf;
    if (!row.pdf_url) return "not_ready";
    try {
      const pdf = await downloadPdf(row.pdf_url);
      this.sql.exec("UPDATE labels SET pdf = ? WHERE label_id = ?", pdf, labelId);
      return pdf;
    } catch {
      return "not_ready";
    }
  }

  /**
   * Keeps one order version from Commerce. A version older than the one Ship
   * already has changes nothing (a late retry); the same or a newer version
   * replaces it, since Commerce sends each product's current weight.
   */
  async receiveOrder(body: unknown, admission: Record<string, unknown> = {}): Promise<Outcome> {
    try {
      assertTuple(this.env, admission);
      const order = { ...parseShipOrder(body), ...tuple(this.env) };
      assertOrder(this.env, order.orderId, order.test);
      this.checkIsolation();
      const now = new Date().toISOString();
      const kept = this.sql.exec<{ version: number }>("SELECT version FROM orders WHERE order_id = ?", order.orderId).toArray()[0];
      if (kept && kept.version > order.version) return ok({ orderId: order.orderId, version: kept.version, ...tuple(this.env) });
      // When the store first sent Ship anything: orders completed before then never get a shipped email.
      this.sql.exec("INSERT OR IGNORE INTO store_meta (key, value) VALUES ('connected_at', ?)", now);
      this.sql.exec(`INSERT INTO orders (order_id, version, record, first_received_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (order_id) DO UPDATE SET version = excluded.version, record = excluded.record, updated_at = excluded.updated_at`,
        order.orderId, order.version, JSON.stringify(order), now, now);
      if (order.storeName) this.setMeta("store_name", order.storeName);
      await this.queueShippedEmail(order);
      await this.wakeForEmails();
      return ok({ orderId: order.orderId, version: order.version, ...tuple(this.env) });
    } catch (error) {
      return toOutcome(error);
    }
  }

  /**
   * One shipped email per completion: the order id plus the completion time, so a
   * retried or newer version of the same completion never sends twice, and an
   * order moved back to Processing and completed again sends a new one.
   */
  private async queueShippedEmail(order: ShipOrder): Promise<void> {
    if (isolation(this.env) || order.status !== "completed" || !order.completed) return;
    const completedAt = Date.parse(order.completed.at);
    const connectedAt = Date.parse(this.meta("connected_at") ?? "");
    if (!Number.isFinite(completedAt) || completedAt < connectedAt - BEFORE_CONNECT_MS) return;
    const now = Date.now();
    this.sql.exec(`INSERT OR IGNORE INTO shipped_emails (order_id, completed_at, state, next_at, created_at) VALUES (?, ?, 'pending', ?, ?)`,
      order.orderId, order.completed.at, now, now);
  }

  /**
   * Makes sure an alarm is set for waiting emails once sending is set up. Commerce
   * calls Ship on every sync, so emails queued before the deploy set up sending
   * go out on the first call after it does.
   */
  private async wakeForEmails(): Promise<void> {
    if (!this.emailSender()) return;
    const next = this.sql.exec<{ next_at: number | null }>("SELECT MIN(next_at) AS next_at FROM shipped_emails WHERE state = 'pending'").one().next_at;
    if (next !== null) await this.wakeAt(next);
  }

  /** The email binding, once the deploy has set it up; null leaves emails waiting. */
  protected emailSender(): SendEmail | null {
    if (isolation(this.env)) return null;
    return this.env.SHIP_EMAIL_FROM && this.env.EMAIL ? this.env.EMAIL : null;
  }

  private async wakeAt(when: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > when) await this.ctx.storage.setAlarm(when);
  }

  /**
   * Finishes tracking-index work the index was not there for, then sends the
   * shipped emails that are due and tries failed ones again later. A failed
   * email never changes an order.
   */
  override async alarm(): Promise<void> {
    this.checkIsolation();
    await this.syncTracking();
    const sender = this.emailSender();
    if (!sender) return;
    const now = Date.now();
    const due = this.sql.exec<{ order_id: string; completed_at: string; attempts: number; created_at: number }>(
      "SELECT order_id, completed_at, attempts, created_at FROM shipped_emails WHERE state = 'pending' AND next_at <= ? ORDER BY next_at LIMIT ?",
      now, EMAILS_PER_ALARM).toArray();
    const settings = await this.getSettings();
    for (const row of due) {
      const finish = (state: string) => this.sql.exec("UPDATE shipped_emails SET state = ?, sent_at = ? WHERE order_id = ? AND completed_at = ?",
        state, state === "sent" ? Date.now() : null, row.order_id, row.completed_at);
      const order = await this.getOrder(row.order_id);
      // The owner moved the order back to Processing, or completed it again, before the email went out.
      if (!order || order.status !== "completed" || order.completed?.at !== row.completed_at) { finish("superseded"); continue; }
      if (now - row.created_at > EMAIL_MAX_AGE_MS) { finish("expired"); continue; }
      // TEST orders email the store owner (the reply-to address), never the shopper.
      const to = order.test ? settings.replyTo : order.email;
      if (!to) { finish("no_recipient"); continue; }
      try {
        await sender.send(shippedEmail(order, { to, from: this.env.SHIP_EMAIL_FROM || DEFAULT_FROM, storeName: settings.storeName, replyTo: settings.replyTo }));
        finish("sent");
      } catch (error) {
        console.error("ship shipped email failed", error instanceof Error ? error.message : "unknown");
        const wait = EMAIL_RETRY_MS[row.attempts];
        if (wait === undefined) finish("failed");
        else this.sql.exec("UPDATE shipped_emails SET attempts = attempts + 1, next_at = ? WHERE order_id = ? AND completed_at = ?",
          Date.now() + wait, row.order_id, row.completed_at);
      }
    }
    const next = this.sql.exec<{ next_at: number | null }>("SELECT MIN(next_at) AS next_at FROM shipped_emails WHERE state = 'pending'").one().next_at;
    if (next !== null) await this.wakeAt(Math.max(next, Date.now() + 1000));
  }

  /**
   * The store admin's Shipping page, learned from the Ship plugin's calls
   * (ship-registry-plugin-001, question 4): once known, Commerce's "Create
   * shipping label" lands there instead of on Ship's own page.
   */
  async rememberAdminPage(url: string): Promise<void> {
    this.checkIsolation();
    const now = Date.now();
    const seen = Date.parse(this.meta("admin_page_at") ?? "");
    if (this.meta("admin_page") === url && Number.isFinite(seen) && now - seen < ADMIN_PAGE_TOUCH_MS) return;
    this.setMeta("admin_page", url);
    this.setMeta("admin_page_at", new Date(now).toISOString());
  }

  /**
   * A store admin the plugin has called for (their email, as EmDash attests it),
   * with when they were last seen: Commerce's button is forwarded only for an
   * owner Ship knows as one of the store's admins, so the order it queues can be
   * opened by that same person and nobody else.
   */
  async rememberAdminUser(email: string): Promise<void> {
    this.checkIsolation();
    const now = Date.now();
    const users = this.adminUsers(now);
    const seen = Date.parse(users[email] ?? "");
    if (Number.isFinite(seen) && now - seen < ADMIN_PAGE_TOUCH_MS) return;
    users[email] = new Date(now).toISOString();
    const kept = Object.entries(users).sort(([, a], [, b]) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, ADMIN_USERS_MAX);
    this.setMeta("admin_users", JSON.stringify(Object.fromEntries(kept)));
  }

  /** The store's admins seen in the last week, email to last-seen time. */
  private adminUsers(now: number): Record<string, string> {
    let users: Record<string, string> = {};
    try {
      const parsed: unknown = JSON.parse(this.meta("admin_users") ?? "{}");
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) users = parsed as Record<string, string>;
    } catch {
      users = {};
    }
    return Object.fromEntries(Object.entries(users).filter(([, at]) => typeof at === "string" && now - Date.parse(at) < ADMIN_PAGE_FRESH_MS));
  }

  /**
   * The store admin's Shipping page for this signed-in owner, or null: the page
   * must be fresh (adminPage) and the owner's DinkusKit.com email must be one the
   * plugin has called for in the last week. Anyone else gets Ship's own page.
   */
  async adminPageFor(email: string): Promise<string | null> {
    this.checkIsolation();
    const page = await this.adminPage();
    if (!page) return null;
    return Object.hasOwn(this.adminUsers(Date.now()), adminEmail(email)) ? page : null;
  }

  /**
   * Which order the next Shipping page load in the store admin should open, and
   * for whom: set when Ship forwards Commerce's "Create shipping label" there,
   * read once by that person's next list call, and forgotten after a minute.
   * Each admin has their own waiting order, so two people forwarding at once
   * never erase each other's. False, and nothing queued, when a different order
   * of this admin's is still waiting: a second button press before the first
   * page opened stays on Ship's own page rather than making either order vanish.
   */
  async queueAdminOpen(orderId: string, email: string): Promise<boolean> {
    this.checkIsolation();
    const now = Date.now();
    const waiting = this.adminOpens(now);
    const mine = waiting[adminEmail(email)];
    if (mine && mine.orderId !== orderId) return false;
    waiting[adminEmail(email)] = { orderId, at: now };
    const kept = Object.entries(waiting).sort(([, a], [, b]) => b.at - a.at).slice(0, ADMIN_OPEN_MAX);
    this.setMeta("admin_open", JSON.stringify(Object.fromEntries(kept)));
    return true;
  }

  /** The orders waiting to be opened, email to order, without the stale ones. */
  private adminOpens(now: number): Record<string, { orderId: string; at: number }> {
    let waiting: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(this.meta("admin_open") ?? "{}");
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) waiting = parsed as Record<string, unknown>;
    } catch {
      waiting = {};
    }
    const fresh: Record<string, { orderId: string; at: number }> = {};
    for (const [email, entry] of Object.entries(waiting)) {
      if (typeof entry !== "object" || entry === null) continue;
      const { orderId, at } = entry as { orderId?: unknown; at?: unknown };
      if (typeof orderId === "string" && typeof at === "number" && now - at <= ADMIN_OPEN_MS) fresh[email] = { orderId, at };
    }
    return fresh;
  }

  /**
   * The queued order to open, once, for the admin whose call this is; null when
   * none waits for them, theirs has gone stale, or the call names nobody. Other
   * admins' waiting orders stay for them.
   */
  async takeAdminOpen(email: string | null): Promise<string | null> {
    this.checkIsolation();
    if (email === null || !this.meta("admin_open")) return null;
    const waiting = this.adminOpens(Date.now());
    const mine = waiting[adminEmail(email)];
    if (!mine) return null;
    delete waiting[adminEmail(email)];
    if (Object.keys(waiting).length) this.setMeta("admin_open", JSON.stringify(waiting));
    else this.sql.exec("DELETE FROM store_meta WHERE key = 'admin_open'");
    return (await this.getOrder(mine.orderId)) ? mine.orderId : null;
  }

  /** The store admin's Shipping page, or null while no Ship plugin has called for this store in the last week. */
  async adminPage(): Promise<string | null> {
    this.checkIsolation();
    const seen = Date.parse(this.meta("admin_page_at") ?? "");
    return Number.isFinite(seen) && Date.now() - seen < ADMIN_PAGE_FRESH_MS ? this.meta("admin_page") : null;
  }

  /** Where each completion's shipped email stands, for the owner's order page. */
  async shippedEmailState(orderId: string): Promise<{ state: string; sentAt: number | null } | null> {
    this.checkIsolation();
    const row = this.sql.exec<{ state: string; sent_at: number | null }>(
      "SELECT state, sent_at FROM shipped_emails WHERE order_id = ? ORDER BY created_at DESC LIMIT 1", orderId).toArray()[0];
    return row ? { state: row.state, sentAt: row.sent_at } : null;
  }

  /** Labels Commerce has not acknowledged, oldest first. */
  async listLabels(admission: Record<string, unknown> = {}): Promise<Outcome> {
    try {
      assertTuple(this.env, admission);
      this.checkIsolation();
      await this.wakeForEmails();
      const rows = this.sql.exec<{ event_id: string; order_id: string; version: number; carrier: string; tracking: string }>(
        "SELECT event_id, order_id, version, carrier, tracking FROM label_events WHERE acked_at IS NULL ORDER BY seq LIMIT ?",
        LABELS_PER_LIST).toArray();
      if (isolation(this.env)) for (const row of rows) {
        if (!await this.getOrder(row.order_id)) throw new ServiceError(403, "FORBIDDEN", "label order is not admitted");
      }
      return ok(rows.map(row => ({ eventId: row.event_id, orderId: row.order_id, version: row.version, carrier: row.carrier, tracking: row.tracking, ...tuple(this.env) })));
    } catch (error) { return toOutcome(error); }
  }

  /** Commerce picked the label up. Legacy unknown IDs remain idempotent; isolation requires an admitted event. */
  async ackLabel(body: unknown, admission: Record<string, unknown> = {}): Promise<Outcome> {
    try {
      assertTuple(this.env, admission);
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ServiceError(400, "INVALID_INPUT", "body must be a JSON object");
      const eventId = (body as Record<string, unknown>).eventId;
      if (typeof eventId !== "string" || !EVENT_ID.test(eventId)) throw new ServiceError(400, "INVALID_INPUT", "eventId must be a label event id");
      this.checkIsolation();
      if (isolation(this.env)) {
        const event = this.sql.exec<{ order_id: string }>("SELECT order_id FROM label_events WHERE event_id = ?", eventId).toArray()[0];
        if (!event || !await this.getOrder(event.order_id)) throw new ServiceError(403, "FORBIDDEN", "label event is not admitted");
      }
      this.sql.exec("UPDATE label_events SET acked_at = ? WHERE event_id = ? AND acked_at IS NULL", new Date().toISOString(), eventId);
      return ok({ eventId, ...tuple(this.env) });
    } catch (error) {
      return toOutcome(error);
    }
  }

  /** The order as Ship last received it, or null. */
  async getOrder(orderId: string): Promise<ShipOrder | null> {
    this.checkIsolation();
    const row = this.sql.exec<{ record: string }>("SELECT record FROM orders WHERE order_id = ?", orderId).toArray()[0];
    const order = row ? JSON.parse(row.record) as ShipOrder : null;
    if (order) this.admitStoredOrder(order);
    return order;
  }

  /**
   * Queues a bought label for Commerce. The label page calls this once Pitney
   * Bowes confirms a purchase; carrier and tracking fit Commerce's 64-character,
   * single-line limit.
   */
  async recordLabel(label: Omit<LabelEvent, "eventId">): Promise<LabelEvent> {
    return this.queueLabel(label);
  }

  private queueLabel(label: Omit<LabelEvent, "eventId">): LabelEvent {
    this.checkIsolation();
    for (const value of [label.carrier, label.tracking]) {
      if (!value || value.length > 64 || NOT_ONE_LINE.test(value)) throw new Error("carrier and tracking must be one line of at most 64 characters");
    }
    if (isolation(this.env)) {
      const row = this.sql.exec<{ record: string }>("SELECT record FROM orders WHERE order_id = ?", label.orderId).toArray()[0];
      if (!row) throw new ServiceError(403, "FORBIDDEN", "label order is not admitted");
      this.admitStoredOrder(JSON.parse(row.record) as ShipOrder);
    }
    const event = { eventId: `lbl_${crypto.randomUUID()}`, ...label, ...tuple(this.env) };
    this.sql.exec("INSERT INTO label_events (event_id, order_id, version, carrier, tracking, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      event.eventId, event.orderId, event.version, event.carrier, event.tracking, new Date().toISOString());
    return event;
  }
}
