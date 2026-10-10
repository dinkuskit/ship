import { ServiceError } from "./errors.js";

/** The record Commerce's Orders sends for one order version (dinkuskit/commerce docs/contracts/commerce-handoffs.md). */
export const SHIP_ORDER_SCHEMA = "dinkuskit.commerce.ship-order/v1";

export interface ShipTo {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: "US";
}

export interface OrderLine {
  catalogItemId: string;
  name: string;
  quantity: number;
  weightOz?: number;
  /** Price paid per unit, before any order-level discount. Commerce adds it after commerce#98. */
  unitPrice?: { currency: "USD"; minor: string };
}

export interface ShipOrder {
  orderId: string;
  number: number | null;
  version: number;
  status: "processing" | "completed";
  test: boolean;
  shipTo: ShipTo;
  email: string | null;
  completed: { at: string; carrier?: string; tracking?: string } | null;
  lines: OrderLine[];
}

type Body = Record<string, unknown>;

function invalid(field: string, message: string): never {
  throw new ServiceError(422, "INVALID_ORDER", `${field}: ${message}`, { field });
}

function object(value: unknown, field: string): Body {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(field, "must be an object");
  return value as Body;
}

function text(value: unknown, field: string, max: number): string {
  // No line breaks or other control characters: these end up on labels, packing slips and emails.
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    invalid(field, `must be text of at most ${max} characters`);
  }
  return value;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : text(value, field, max);
}

function whole(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    invalid(field, `must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function shipTo(value: unknown): ShipTo {
  const address = object(value, "shipTo");
  const country = text(address.country, "shipTo.country", 2).toUpperCase();
  // Ship is US only in v1 (dinkuskit/.github ROADMAP). Commerce treats 422 as "never for this version".
  if (country !== "US") throw new ServiceError(422, "NOT_SERVED", "Ship labels US addresses only", { field: "shipTo.country" });
  const line2 = optionalText(address.line2, "shipTo.line2", 200);
  const region = optionalText(address.region, "shipTo.region", 200);
  return {
    name: text(address.name, "shipTo.name", 200),
    line1: text(address.line1, "shipTo.line1", 200),
    ...(line2 ? { line2 } : {}),
    city: text(address.city, "shipTo.city", 200),
    ...(region ? { region } : {}),
    postalCode: text(address.postalCode, "shipTo.postalCode", 20),
    country: "US",
  };
}

function line(value: unknown, index: number): OrderLine {
  const field = `lines[${index}]`;
  const entry = object(value, field);
  const result: OrderLine = {
    catalogItemId: text(entry.catalogItemId, `${field}.catalogItemId`, 200),
    name: text(entry.name, `${field}.name`, 200),
    quantity: whole(entry.quantity, `${field}.quantity`, 1, 1_000_000),
  };
  if (entry.weightOz !== undefined && entry.weightOz !== null) {
    if (typeof entry.weightOz !== "number" || !Number.isFinite(entry.weightOz) || entry.weightOz <= 0 || entry.weightOz > 100_000) {
      invalid(`${field}.weightOz`, "must be a positive number of ounces");
    }
    result.weightOz = entry.weightOz;
  }
  if (entry.unitPrice !== undefined && entry.unitPrice !== null) {
    const price = object(entry.unitPrice, `${field}.unitPrice`);
    if (price.currency !== "USD" || typeof price.minor !== "string" || !/^(0|[1-9][0-9]{0,14})$/.test(price.minor)) {
      invalid(`${field}.unitPrice`, "must be { currency: \"USD\", minor: whole cents as a string }");
    }
    result.unitPrice = { currency: "USD", minor: price.minor };
  }
  return result;
}

function completed(value: unknown, status: ShipOrder["status"]): ShipOrder["completed"] {
  if (status === "processing") {
    if (value !== null && value !== undefined) invalid("completed", "must be null while the order is processing");
    return null;
  }
  const record = object(value, "completed");
  const at = text(record.at, "completed.at", 40);
  if (Number.isNaN(Date.parse(at))) invalid("completed.at", "must be a date and time");
  const carrier = optionalText(record.carrier, "completed.carrier", 64);
  const tracking = optionalText(record.tracking, "completed.tracking", 64);
  return { at, ...(carrier ? { carrier } : {}), ...(tracking ? { tracking } : {}) };
}

/**
 * Reads one order version from Commerce. Ship keeps only the fields it needs and
 * drops anything else Commerce might add. A record Ship can never use is a 422,
 * which Commerce takes as "wait for the order to change"; an address Ship can use
 * but a label cannot (no state, say) is kept and shown to the owner instead.
 */
export function parseShipOrder(value: unknown): ShipOrder {
  const body = object(value, "body");
  if (body.schema !== SHIP_ORDER_SCHEMA) invalid("schema", `must be ${SHIP_ORDER_SCHEMA}`);
  if (body.status !== "processing" && body.status !== "completed") invalid("status", "must be processing or completed");
  if (typeof body.test !== "boolean") invalid("test", "must be true or false");
  if (!Array.isArray(body.lines) || body.lines.length > 500) invalid("lines", "must be a list of at most 500 lines");
  const status = body.status;
  const email = body.email === null || body.email === undefined ? null : text(body.email, "email", 254);
  if (email !== null && !/^[^\s@]+@[^\s@]+$/.test(email)) invalid("email", "must be an email address");
  return {
    orderId: text(body.orderId, "orderId", 200),
    number: body.number === null || body.number === undefined ? null : whole(body.number, "number", 1, Number.MAX_SAFE_INTEGER),
    version: whole(body.version, "version", 1, Number.MAX_SAFE_INTEGER),
    status,
    test: body.test,
    shipTo: shipTo(body.shipTo),
    email,
    completed: completed(body.completed, status),
    lines: body.lines.map(line),
  };
}
