import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { PublicShipError, shipmentFingerprint } from "./pb-sandbox.js";

export const QUOTE_TTL_MS = 10 * 60 * 1000;

export function validateShipment(input) {
  const address = (value) => {
    if (!value || value.country !== "US" || typeof value.name !== "string" ||
      !Array.isArray(value.addressLines) || value.addressLines.length < 1 ||
      value.addressLines.some((line) => typeof line !== "string" || line.length < 1 || line.length > 100) ||
      typeof value.cityTown !== "string" || value.cityTown.length < 1 || value.cityTown.length > 50 ||
      !/^[A-Z]{2}$/.test(value.stateProvince) ||
      !/^\d{5}(?:-\d{4})?$/.test(value.postalCode)) {
      throw new PublicShipError("validation", "Shipment addresses are invalid");
    }
    return {
      name: value.name,
      addressLines: [...value.addressLines],
      cityTown: value.cityTown,
      stateProvince: value.stateProvince,
      postalCode: value.postalCode,
      country: "US",
    };
  };
  const shipment = { from: address(input?.from), to: address(input?.to), parcel: input?.parcel, service: "PM" };
  if (shipment.from.country !== "US" || shipment.to.country !== "US") {
    throw new PublicShipError("validation", "This lab supports US domestic shipments only");
  }
  const numbers = ["weightOz", "lengthIn", "widthIn", "heightIn"];
  if (!shipment.parcel || numbers.some((key) => typeof shipment.parcel[key] !== "number" ||
      !Number.isFinite(shipment.parcel[key]) || shipment.parcel[key] <= 0 || shipment.parcel[key] > 10_000)) {
    throw new PublicShipError("validation", "Weight and dimensions must be positive decimal values");
  }
  shipment.parcel = Object.fromEntries(numbers.map((key) => [key, shipment.parcel[key]]));
  return shipment;
}

export class FileStateStore {
  constructor(file) {
    this.file = file;
    this.lockFile = `${file}.owner`;
    this.queue = Promise.resolve();
    this.owner = false;
    this.ownerToken = randomUUID();
  }

  _run(fn) {
    const result = this.queue.then(fn, fn);
    this.queue = result.catch(() => {});
    return result;
  }

  async _acquire() {
    if (this.owner) return;
    await mkdir(dirname(this.file), { recursive: true });
    try {
      const handle = await open(this.lockFile, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token: this.ownerToken }));
      await handle.sync();
      await handle.close();
      this.owner = true;
    } catch {
      throw new PublicShipError(
        "state_owner",
        `Local task state is owned by another process or has a stale lock; inspect ${this.lockFile} and remove it only after confirming no owner is active`,
        503,
      );
    }
  }

  async _read() {
    await this._acquire();
    try { return JSON.parse(await readFile(this.file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return { quotes: {}, operations: {} }; throw error; }
  }

  async read() { return this._run(() => this._read()); }

  async _write(state) {
    await this._acquire();
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    const data = JSON.stringify(state, null, 2);
    const handle = await open(temp, "w", 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, this.file);
    const dir = await open(dirname(this.file), "r");
    try { await dir.sync(); } finally { await dir.close(); }
  }

  async write(state) { return this._run(() => this._write(state)); }

  async transact(fn) {
    return this._run(async () => {
      const state = await this._read();
      try {
        const result = await fn(state);
        if (result?.write !== false) await this._write(state);
        return result?.value ?? result;
      } catch (error) {
        try { await this._write(state); } catch { /* preserve the original operation failure */ }
        throw error;
      }
    });
  }

  async close() {
    return this._run(async () => {
      if (!this.owner) return;
      let contents;
      try {
        contents = JSON.parse(await readFile(this.lockFile, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") {
          this.owner = false;
          return;
        }
        throw error;
      }
      if (contents.pid !== process.pid || contents.token !== this.ownerToken) {
        throw new PublicShipError("state_owner", "Refusing to remove a lock owned by another process", 503);
      }
      await unlink(this.lockFile);
      this.owner = false;
    });
  }
}

export class SandboxTask {
  constructor({ adapter, store, now = () => Date.now(), id = "local-task" }) {
    this.adapter = adapter;
    this.store = store;
    this.now = now;
    this.id = id;
  }

  async quote(input) {
    if (!this.adapter) throw new PublicShipError("not_configured", "Credentials are not configured", 503);
    return this.store.transact(async (state) => {
      const shipment = validateShipment(input);
      const fingerprint = shipmentFingerprint(shipment);
      const previous = state.quotes[fingerprint];
      if (previous && previous.expiresAt > this.now()) return { value: previous, write: false };
      const rate = await this.adapter.quote(shipment);
      const quote = { quoteId: `${this.id}-${fingerprint.slice(0, 12)}`, fingerprint, ...rate, expiresAt: this.now() + QUOTE_TTL_MS };
      state.quotes[fingerprint] = quote;
      return quote;
    });
  }

  async createTestLabel({ input, quoteId, review, idempotencyKey }) {
    if (!this.adapter) throw new PublicShipError("not_configured", "Credentials are not configured", 503);
    if (!/^[A-Za-z0-9_-]{1,25}$/.test(idempotencyKey || "") ||
      ["__proto__", "constructor", "prototype"].includes(idempotencyKey)) throw new PublicShipError("validation", "The operation key is invalid");
    return this.store.transact(async (state) => {
      const shipment = validateShipment(input);
      const fingerprint = shipmentFingerprint(shipment);
      const existing = state.operations[idempotencyKey];
      if (existing && existing.fingerprint !== fingerprint) throw new PublicShipError("idempotency_conflict", "That operation key is bound to different shipment data", 409);
      if (existing?.status === "pending" || existing?.status === "unknown") throw new PublicShipError("unknown_operation", "This test-label operation is unresolved; reconcile it before retrying", 409);
      const unresolved = Object.values(state.operations).find((operation) =>
        operation.fingerprint === fingerprint && (operation.status === "pending" || operation.status === "unknown"));
      if (unresolved) throw new PublicShipError("unknown_operation", "This shipment has an unresolved test-label operation", 409);
      if (existing?.status === "label_created") return { value: existing.result, write: false };
      const quote = state.quotes[fingerprint];
      if (!quote || quote.quoteId !== quoteId || quote.expiresAt <= this.now()) throw new PublicShipError("quote_invalid", "Get a fresh quote before creating a test label", 409);
      if (!review?.confirmed || review.service !== "PM" || typeof review.amount !== "number" || review.amount !== quote.amount) throw new PublicShipError("review_invalid", "Confirm the reviewed Priority Mail service and exact price", 409);
      state.operations[idempotencyKey] = { fingerprint, status: "pending", quoteId, reviewedAmount: quote.amount, createdAt: this.now() };
      await this.store._write(state);
      try {
        const result = await this.adapter.createLabel(shipment, idempotencyKey);
        if (!result || result.price !== undefined && result.price !== quote.amount) {
          state.operations[idempotencyKey].status = "unknown";
          state.operations[idempotencyKey].anomaly = "provider_price_mismatch";
          throw new PublicShipError("unknown_operation", "The provider result did not confirm the reviewed price", 502);
        }
        state.operations[idempotencyKey] = { ...state.operations[idempotencyKey], status: "label_created", result, finishedAt: this.now() };
        return result;
      } catch (error) {
        if (state.operations[idempotencyKey]?.status === "pending") state.operations[idempotencyKey].status = "unknown";
        throw error;
      }
    });
  }
}
