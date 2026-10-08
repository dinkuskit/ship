const MAX_ID = 100;
const QUOTE_TTL_MS = 15 * 60 * 1000;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const PDF_CHUNK_BYTES = 512 * 1024;
const KEY_RE = /^[A-Za-z0-9_-]{1,25}$/;
const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
  "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY", "AS", "GU", "MP", "PR", "VI", "AA", "AE", "AP",
]);
const FIXED_MESSAGES = {
  auth_invalid: "Shipping authorization is invalid",
  unavailable: "Shipping dependencies are unavailable",
  validation: "Shipping request is invalid",
  unpaid: "The order is not paid",
  not_found: "Shipping operation was not found",
  conflict: "The shipping operation conflicts with existing state",
  quote_expired: "The shipping quote has expired",
  provider_failure: "The shipping provider could not complete the request",
  provider_unavailable: "The shipping provider is unavailable",
  purchase_unknown: "The shipping purchase outcome is unresolved",
  pdf_unavailable: "The label PDF is unavailable",
  pdf_invalid: "The label PDF is invalid",
};

export class ShipWorkflowError extends Error {
  constructor(code, message = FIXED_MESSAGES[code] || FIXED_MESSAGES.validation, status = 400) {
    super(message);
    this.name = "ShipWorkflowError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) {
  throw new ShipWorkflowError(code, FIXED_MESSAGES[code], status);
}

function clone(value) {
  if (value === undefined) return undefined;
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function text(value, max = 100) {
  return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim()
    ? value
    : null;
}

function id(value) {
  return text(value, MAX_ID) && /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

// Commerce default producer: `order:${crypto.randomUUID()}` (41 chars).
// Keep the local100-character request cap; do not invent a Commerce maximum or
// broaden actor/shop IDs. Alternate server attempt generators have no published
// maximum and must negotiate the port boundary before production mounting.
function orderIdentity(value) {
  if (!text(value, MAX_ID)) return null;
  return id(value) || (/^order:[A-Za-z0-9._-]+$/.test(value) ? value : null);
}

function validateAuth(auth) {
  if (!auth || id(auth.shopId) === null || id(auth.actorId) === null || auth.canManage !== true) {
    fail("auth_invalid", 403);
  }
  return { shopId: auth.shopId, actorId: auth.actorId, canManage: true };
}

function fixedKey(value) {
  if (typeof value !== "string" || !KEY_RE.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) {
    fail("validation");
  }
  return value;
}

function address(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("validation");
  const name = text(value.name);
  const company = value.company === undefined || value.company === "" ? undefined : text(value.company);
  if ((value.company !== undefined && value.company !== "" && !company)) fail("validation");
  const line1 = text(value.addressLine1);
  const line2 = value.addressLine2 === undefined || value.addressLine2 === "" ? undefined : text(value.addressLine2);
  if ((value.addressLine2 !== undefined && value.addressLine2 !== "" && !line2)) fail("validation");
  const city = text(value.city);
  const state = text(value.state, 2)?.toUpperCase();
  const postalCode = text(value.postalCode, 10);
  if ((!name && !company) || !line1 || !city || !state || !US_STATES.has(state) ||
      !postalCode || !/^\d{5}(?:-\d{4})?$/.test(postalCode) || value.country !== "US") {
    fail("validation");
  }
  for (const part of [name, company, line1, line2, city, state, postalCode]) {
    if (part != null && /[\u0000-\u001f\u007f\u2028\u2029]/.test(part)) fail("validation");
  }
  return {
    name: name || company,
    ...(company ? { company } : {}),
    addressLine1: line1,
    ...(line2 ? { addressLine2: line2 } : {}),
    city,
    state,
    postalCode,
    country: "US",
  };
}

function paidOrder(value, auth, orderId) {
  if (!value || value.shopId !== auth.shopId || value.orderId !== orderId ||
      value.paymentStatus !== "paid" || value.addressConsent !== true ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !value.paidTotals || value.paidTotals.currency !== "USD" ||
      typeof value.paidTotals.amount !== "string" || !/^(0|[1-9][0-9]{0,29})$/.test(value.paidTotals.amount)) {
    if (value?.paymentStatus !== "paid") fail("unpaid");
    fail("validation");
  }
  const destination = address(value.destination, "destination");
  const amount = value.paidTotals.amount;
  return clone({
    shopId: auth.shopId,
    orderId,
    revision: value.revision,
    paymentStatus: "paid",
    paidTotals: { amount, currency: "USD" },
    destination,
    addressConsent: true,
  });
}

function money(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(String(value))) fail('validation');
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isSafeInteger(Math.round(n * 100))) fail('validation');
  return n;
}

function matchesMoney(value, expected) {
  try { return money(value) === expected; } catch { return false; }
}

function positive(value) {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return (typeof value === "number" || (typeof value === "string" && value.length <= 30 && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))) && Number.isFinite(n) && n > 0 ? n : null;
}

function packageValue(value) {
  if (!value || typeof value !== "object") fail("validation");
  const weightLb = positive(value.weightLb);
  const lengthIn = positive(value.lengthIn);
  const widthIn = positive(value.widthIn);
  const heightIn = positive(value.heightIn);
  if ([weightLb, lengthIn, widthIn, heightIn].includes(null) || weightLb > 70 ||
      Math.max(lengthIn, widthIn, heightIn) + 2 * (lengthIn + widthIn + heightIn - Math.max(lengthIn, widthIn, heightIn)) > 108) fail("validation");
  return {
    weightLb, lengthIn, widthIn, heightIn,
    weightOz: Number((weightLb * 16).toFixed(6)),
  };
}

function providerAddress(value) {
  const a = address(value, "provider address");
  return {
    name: a.name,
    ...(a.company ? { company: a.company } : {}),
    addressLines: [a.addressLine1, ...(a.addressLine2 ? [a.addressLine2] : [])],
    cityTown: a.city,
    stateProvince: a.state,
    postalCode: a.postalCode,
    country: "US",
  };
}

function shipmentFor(order, origin, parcel) {
  return {
    from: providerAddress(origin),
    to: providerAddress(order.destination),
    parcel: {
      weightOz: parcel.weightOz,
      lengthIn: parcel.lengthIn,
      widthIn: parcel.widthIn,
      heightIn: parcel.heightIn,
    },
    service: "PM",
  };
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

async function digestBytes(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") fail("unavailable", 503);
  const digest = await crypto.subtle.digest("SHA-256", value);
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fingerprint(value) {
  return digestBytes(new TextEncoder().encode(canonical(value)));
}

function defaultId() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(15);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 25);
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`.slice(0, 25);
}

function safeIdentity(value) {
  return typeof value === "string" && value.trim() !== "" && value.length <= 200 ? value : null;
}

function safePdfUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password &&
      !parsed.search && !parsed.hash ? value : null;
  } catch {
    return null;
  }
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (globalThis.Buffer?.isBuffer(value)) return new Uint8Array(value);
  return null;
}

function encodeBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function decodeBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createShipWorkflow({ store, orderPort, providerPort, clock = () => Date.now(), idFactory = defaultId }) {
  if (!store || typeof store.getOrigin !== "function" || typeof store.getVersioned !== "function" ||
      typeof store.compareAndSet !== "function" || !orderPort || typeof orderPort.getPaidOrder !== "function" ||
      !providerPort) {
    fail("unavailable", 503);
  }

  async function loadOrder(authInput, input) {
    const auth = validateAuth(authInput);
    const orderId = orderIdentity(input?.orderId);
    if (!orderId) fail("validation");
    let result;
    try {
      result = await orderPort.getPaidOrder({ shopId: auth.shopId, orderId, actorId: auth.actorId });
    } catch { fail("unavailable", 503); }
    if (!result) fail("unavailable", 503);
    return paidOrder(clone(result), auth, orderId);
  }

  function stateKey(auth, orderId) {
    return `ship:v1:${auth.shopId}:${orderId}`;
  }

  async function readState(auth, orderId) {
    try { return await store.getVersioned(stateKey(auth, orderId)); } catch { fail("unavailable", 503); }
  }

  async function writeState(auth, orderId, current, value) {
    try {
      const result = await store.compareAndSet(stateKey(auth, orderId), current?.revision ?? null, clone(value));
      if (!result?.applied) fail("conflict", 409);
      return { value: clone(value), revision: result.revision };
    } catch (error) {
      if (error instanceof ShipWorkflowError) throw error;
      fail("unavailable", 503);
    }
  }

  async function context(authInput, input, retries = 1) {
    const order = await loadOrder(authInput, input);
    const auth = validateAuth(authInput);
    let origin;
    try { origin = await store.getOrigin(auth); } catch { fail("unavailable", 503); }
    if (!origin) fail("unavailable", 503);
    const parcel = packageValue(input.packageValues);
    const shipment = shipmentFor(order, origin, parcel);
    const fingerprintValue = {
      shopId: order.shopId, orderId: order.orderId, orderRevision: order.revision,
      paidTotals: order.paidTotals, destination: order.destination, origin: shipment.from,
      package: shipment.parcel, service: "PM",
    };
    return { auth, order, shipment, fingerprint: await fingerprint(fingerprintValue), retries };
  }

  function publicQuote(record) {
    return clone(record.quote);
  }

  async function review(authInput, input) {
    const ctx = await context(authInput, input);
    const current = await readState(ctx.auth, ctx.order.orderId);
    if (current?.value?.operation?.status && !["not_started", "purchase_failed"].includes(current.value.operation.status)) fail("conflict", 409);
    const next = {
      ...(current?.value || {}),
      reviewed: { fingerprint: ctx.fingerprint, order: ctx.order, shipment: ctx.shipment, reviewedAt: clock() },
      quote: current?.value?.quote?.fingerprint === ctx.fingerprint ? current.value.quote : null,
    };
    await writeState(ctx.auth, ctx.order.orderId, current, next);
    return clone({ status: "reviewed", order: ctx.order, shipment: ctx.shipment, fingerprint: ctx.fingerprint });
  }

  async function quote(authInput, input) {
    const ctx = await context(authInput, input, 3);
    if (typeof providerPort.quote !== "function") fail("unavailable", 503);
    let quoted;
    try { quoted = await providerPort.quote(clone(ctx.shipment)); } catch { fail("provider_unavailable", 502); }
    const amount = money(quoted?.amount);
    if (quoted?.service !== "PM" || quoted?.currency !== "USD" || !text(quoted.serviceLabel, 100)) fail("provider_failure", 502);
    const quoteRecord = {
      fingerprint: ctx.fingerprint,
      quoteId: fixedKey(String(idFactory()).slice(0, 25)),
      service: "PM", serviceLabel: quoted.serviceLabel, currency: "USD", amount,
      expiresAt: clock() + QUOTE_TTL_MS,
    };
    let current = await readState(ctx.auth, ctx.order.orderId);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (current?.value?.operation?.status && !["not_started", "purchase_failed"].includes(current.value.operation.status)) fail("conflict", 409);
      const next = {
        ...(current?.value || {}),
        reviewed: { fingerprint: ctx.fingerprint, order: ctx.order, shipment: ctx.shipment, reviewedAt: clock() },
        quote: quoteRecord,
      };
      try {
        await writeState(ctx.auth, ctx.order.orderId, current, next);
        return publicQuote({ quote: quoteRecord });
      } catch (error) {
        if (error.code !== "conflict" || attempt === 2) throw error;
        current = await readState(ctx.auth, ctx.order.orderId);
      }
    }
    return publicQuote({ quote: quoteRecord });
  }

  function validateConfirmation(confirmation, quoteRecord) {
    if (!confirmation || confirmation.confirmed !== true || confirmation.service !== quoteRecord.service ||
        confirmation.currency !== quoteRecord.currency || money(confirmation.amount) !== quoteRecord.amount) fail("validation");
  }

  function providerErrorReason(error) {
    return error && (error.recoveryReason === "no_response" || error.recoveryReason === "http_500")
      ? error.recoveryReason : undefined;
  }

  async function buy(authInput, input) {
    const ctx = await context(authInput, input);
    const key = fixedKey(input?.idempotencyKey);
    const current = await readState(ctx.auth, ctx.order.orderId);
    const record = current?.value;
    const quoteRecord = record?.quote;
    if (!record?.reviewed || record.reviewed.fingerprint !== ctx.fingerprint || !quoteRecord ||
        quoteRecord.quoteId !== input.quoteId || quoteRecord.fingerprint !== ctx.fingerprint) fail("conflict", 409);
    validateConfirmation(input.confirmation, quoteRecord);
    if (record.operation) {
      if (record.operation.key === key && record.operation.fingerprint !== ctx.fingerprint) fail("conflict", 409);
      if (record.operation.key === key && record.operation.fingerprint === ctx.fingerprint &&
          record.operation.amount === quoteRecord.amount && record.operation.status === "label_created") {
        return clone(record.operation.result);
      }
      if (["purchase_pending", "purchase_unknown", "label_created"].includes(record.operation.status)) fail("conflict", 409);
    }
    if (clock() >= quoteRecord.expiresAt) fail("quote_expired");
    const operationId = fixedKey(String(idFactory()).slice(0, 25));
    const operation = {
      id: operationId, key, fingerprint: ctx.fingerprint, amount: quoteRecord.amount,
      status: "purchase_pending", createdAt: clock(),
      confirmation: { actorId: ctx.auth.actorId, confirmedAt: clock(), service: quoteRecord.service, amount: quoteRecord.amount, currency: quoteRecord.currency },
      request: {
        service: "PM", amount: quoteRecord.amount, currency: "USD",
      },
    };
    const pending = { ...record, operation };
    const claimed = await writeState(ctx.auth, ctx.order.orderId, current, pending);
    let label;
    try {
      if (typeof providerPort.createLabel !== "function") throw Object.assign(new Error(), { purchaseOutcome: "not_started" });
      label = await providerPort.createLabel(clone(ctx.shipment), operationId);
    } catch (error) {
      const reason = providerErrorReason(error);
      const failed = {
        ...claimed.value,
        operation: { ...operation, status: reason ? "purchase_unknown" : (error?.purchaseOutcome === "not_started" ? "purchase_failed" : "purchase_unknown"), ...(reason ? { recoveryReason: reason } : {}) },
      };
      await writeState(ctx.auth, ctx.order.orderId, claimed, failed);
      if (error?.purchaseOutcome === "not_started") fail("provider_failure", 502);
      fail("purchase_unknown", 409);
    }
    const price = label?.price;
    if (!safeIdentity(label?.shipmentId) || !safePdfUrl(label?.pdfUrl) || !matchesMoney(price, quoteRecord.amount)) {
      const unknown = { ...claimed.value, operation: { ...operation, status: "purchase_unknown" } };
      await writeState(ctx.auth, ctx.order.orderId, claimed, unknown);
      fail("purchase_unknown", 409);
    }
    const result = { status: "label_created", operationId, shipmentId: label.shipmentId, pdfUrl: label.pdfUrl, amount: quoteRecord.amount, currency: "USD" };
    const completed = { ...claimed.value, operation: { ...operation, status: "label_created", result }, label: { ...result } };
    await writeState(ctx.auth, ctx.order.orderId, claimed, completed);
    return clone(result);
  }

  async function reconcile(authInput, input) {
    const auth = validateAuth(authInput);
    const orderId = orderIdentity(input?.orderId);
    if (!orderId) fail("validation");
    const current = await readState(auth, orderId);
    const operation = current?.value?.operation;
    if (!operation || operation.status !== "purchase_unknown" || !operation.recoveryReason || operation.recoveryAttempted) fail("conflict", 409);
    const claimedValue = { ...current.value, operation: { ...operation, recoveryAttempted: true, recoveryClaimedAt: clock() } };
    const claimed = await writeState(auth, orderId, current, claimedValue);
    if (typeof providerPort.reconcileLabel !== "function") fail("unavailable", 503);
    let recovered;
    try {
      recovered = await providerPort.reconcileLabel(operation.id, { reason: operation.recoveryReason, createdAt: operation.createdAt });
    } catch { recovered = null; }
    if (!recovered || !safeIdentity(recovered.shipmentId) || !safePdfUrl(recovered.pdfUrl) || !matchesMoney(recovered.price, operation.amount)) {
      return clone({ status: "purchase_unknown", operationId: operation.id });
    }
    const result = { status: "label_created", operationId: operation.id, shipmentId: recovered.shipmentId, pdfUrl: recovered.pdfUrl, amount: operation.amount, currency: "USD" };
    const done = { ...claimed.value, operation: { ...claimed.value.operation, status: "label_created", result }, label: result };
    await writeState(auth, orderId, claimed, done);
    return clone(result);
  }

  async function label(authInput, input) {
    const auth = validateAuth(authInput);
    const orderId = orderIdentity(input?.orderId);
    if (!orderId) fail("validation");
    const current = await readState(auth, orderId);
    if (current?.value?.label?.status !== "label_created") fail("not_found", 404);
    return clone(current.value.label);
  }

  async function pdf(authInput, input) {
    const auth = validateAuth(authInput);
    const orderId = orderIdentity(input?.orderId);
    if (!orderId) fail('validation');
    const current = await readState(auth, orderId);
    const labelRecord = current?.value?.label;
    if (!labelRecord || labelRecord.status !== 'label_created') fail('not_found', 404);
    const operationId = current.value.operation.id;
    const prefix = digest => fingerprint({ shopId: auth.shopId, orderId, operationId, digest });
    const manifest = current.value.pdf;
    if (manifest) {
      if (manifest.shipmentId !== labelRecord.shipmentId || !Number.isInteger(manifest.byteLength) ||
          manifest.byteLength < 5 || manifest.byteLength > MAX_PDF_BYTES ||
          manifest.chunkCount !== Math.ceil(manifest.byteLength / PDF_CHUNK_BYTES) ||
          typeof manifest.digest !== 'string') fail('pdf_invalid', 502);
      const keyPrefix = await prefix(manifest.digest);
      const bytes = new Uint8Array(manifest.byteLength);
      for (let index = 0; index < manifest.chunkCount; index++) {
        let chunk;
        try { chunk = (await store.getVersioned(`ship:pdf:v1:${keyPrefix}:${index}`))?.value; }
        catch { fail('pdf_unavailable', 503); }
        const expectedLength = Math.min(PDF_CHUNK_BYTES, bytes.length - index * PDF_CHUNK_BYTES);
        if (!chunk || chunk.index !== index || chunk.shipmentId !== labelRecord.shipmentId ||
            typeof chunk.base64 !== 'string' || chunk.base64.length > Math.ceil(PDF_CHUNK_BYTES / 3) * 4) fail('pdf_invalid', 502);
        let part;
        try { part = decodeBytes(chunk.base64); } catch { fail('pdf_invalid', 502); }
        if (part.length !== expectedLength) fail('pdf_invalid', 502);
        bytes.set(part, index * PDF_CHUNK_BYTES);
      }
      if (await digestBytes(bytes) !== manifest.digest) fail('pdf_invalid', 502);
      return bytes;
    }
    if (typeof providerPort.fetchLabelPdf !== 'function' || !safePdfUrl(labelRecord.pdfUrl)) fail('pdf_unavailable', 503);
    let bytes;
    try { bytes = asBytes(await providerPort.fetchLabelPdf(labelRecord.pdfUrl)); } catch { fail('pdf_unavailable', 502); }
    if (!bytes || bytes.byteLength > MAX_PDF_BYTES || bytes.length < 5 ||
        String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') fail('pdf_invalid', 502);
    bytes = new Uint8Array(bytes);
    const digest = await digestBytes(bytes);
    const keyPrefix = await prefix(digest);
    const chunkCount = Math.ceil(bytes.length / PDF_CHUNK_BYTES);
    for (let index = 0; index < chunkCount; index++) {
      const key = `ship:pdf:v1:${keyPrefix}:${index}`;
      const chunk = { index, shipmentId: labelRecord.shipmentId,
        base64: encodeBytes(bytes.subarray(index * PDF_CHUNK_BYTES, (index + 1) * PDF_CHUNK_BYTES)) };
      try {
        const result = await store.compareAndSet(key, null, chunk);
        if (!result?.applied) {
          const existing = (await store.getVersioned(key))?.value;
          if (!existing || existing.index !== index || existing.shipmentId !== chunk.shipmentId || existing.base64 !== chunk.base64) fail('pdf_invalid', 502);
        }
      } catch (error) {
        if (error instanceof ShipWorkflowError) throw error;
        fail('pdf_unavailable', 503);
      }
    }
    const next = { ...current.value, pdf: { digest, chunkCount, byteLength: bytes.length,
      shipmentId: labelRecord.shipmentId, storedAt: clock() } };
    await writeState(auth, orderId, current, next);
    return bytes;
  }

  async function print(authInput, input) {
    const auth = validateAuth(authInput);
    const orderId = orderIdentity(input?.orderId);
    if (!orderId) fail("validation");
    const current = await readState(auth, orderId);
    if (current?.value?.label?.status !== "label_created") fail("not_found", 404);
    if (current.value.print?.status === "print_requested") return clone(current.value.print);
    const next = { ...current.value, print: { status: "print_requested", requestedAt: clock() } };
    await writeState(auth, orderId, current, next);
    return clone(next.print);
  }

  async function inspect(authInput, input) {
    const auth = validateAuth(authInput);
    const order = await loadOrder(auth, input);
    const current = await readState(auth, order.orderId);
    const record = current?.value;
    const parcel = record?.reviewed?.shipment?.parcel;
    return clone({ order, quote: record?.quote || null,
      shipment: record?.reviewed?.shipment || null,
      packageValues: parcel ? { weightLb: parcel.weightOz / 16, lengthIn: parcel.lengthIn, widthIn: parcel.widthIn, heightIn: parcel.heightIn } : null,
      labelStatus: record?.operation?.status || 'not_created',
      pdfStatus: record?.pdf ? 'stored' : 'not_stored',
      printStatus: record?.print?.status || 'not_requested',
      deliveryStatus: 'not_reported',
      canReconcile: record?.operation?.status === 'purchase_unknown' && Boolean(record.operation.recoveryReason) && !record.operation.recoveryAttempted,
    });
  }
  return { loadOrder, inspect, review, quote, buy, reconcile, label, pdf, print };
}
