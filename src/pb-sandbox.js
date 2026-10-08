import { createHash } from "node:crypto";

export const SANDBOX_API_ORIGIN = "https://shipping-api-sandbox.pitneybowes.com";
export const SANDBOX_OAUTH_ORIGIN = SANDBOX_API_ORIGIN;
export const LABEL_HOST = "stg-labels-cls.gcs.pitneybowes.com";
const MAX_PROVIDER_BODY = 1_000_000;
const MAX_PDF_BODY = 5 * 1024 * 1024;
const RECONCILIATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export class PublicShipError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    Object.assign(this, details);
  }
}

export function loadSandboxCredentials(env = process.env) {
  const credentials = {
    apiKey: env.PB_SANDBOX_API_KEY,
    apiSecret: env.PB_SANDBOX_API_SECRET,
    shipperId: env.PB_SANDBOX_SHIPPER_ID,
  };
  if (!credentials.apiKey || !credentials.apiSecret || !credentials.shipperId) {
    throw new Error(
      "PB sandbox credentials are not configured. An approved wrapper must provide the API key, API secret, and shipper ID.",
    );
  }
  return credentials;
}

function assertFixedOrigin(value, expected, name) {
  if (value !== expected) {
    throw new Error(`${name} must use the fixed Pitney Bowes sandbox origin`);
  }
}

function rejectRedirect(response, operation) {
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    throw new PublicShipError("provider_failure", `${operation} could not be completed`, 502);
  }
}

async function readResponseBytes(response, operation, maxBytes) {
  rejectRedirect(response, operation);
  const reader = response.body?.getReader();
  const chunks = [];
  let size = 0;
  try {
    if (!reader) {
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error("response too large");
      }
      const value = new Uint8Array(await response.arrayBuffer());
      if (value.byteLength > maxBytes) throw new Error("response too large");
      chunks.push(value);
      size = value.byteLength;
    } else {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error("response too large");
        }
        chunks.push(value);
      }
    }
  } catch {
    throw new PublicShipError("provider_malformed", `${operation} returned malformed data`, 502);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readBody(response, operation) {
  const text = new TextDecoder().decode(await readResponseBytes(response, operation, MAX_PROVIDER_BODY));
  let body;
  try { body = JSON.parse(text); } catch {
    throw new PublicShipError("provider_malformed", `${operation} returned malformed data`, 502, {
      providerStatus: response.status,
    });
  }
  if (!response.ok) {
    // Only a recognizable standard error response can qualify a 500 lookup.
    // Throttling follows different PB troubleshooting steps; opaque errors stay
    // unknown without a recovery reason. No error payload escapes the adapter.
    const qualified500 = response.status === 500 && Array.isArray(body?.errors) &&
      body.errors.length > 0 && body.errors.every((error) =>
        typeof error?.errorCode === "string" && error.errorCode.length > 0 &&
        error.errorCode !== "PB-APIM-ERR-1006");
    throw new PublicShipError(
      response.status === 401 || response.status === 403 ? "provider_auth" : "provider_failure",
      `${operation} could not be completed`, 502, { providerStatus: response.status, ...(qualified500 ? { recoveryReason: "http_500" } : {}) },
    );
  }
  return body;
}

function normalizeRate(body) {
  const rate = Array.isArray(body?.rates) && body.rates.find(
    (item) => typeof item?.carrier === "string" && item.carrier.toUpperCase() === "USPS" && item?.serviceId === "PM" &&
      item?.parcelType === "PKG",
  );
  const currency = rate?.currency ?? rate?.currencyCode;
  const amount = rate?.totalCarrierCharge;
  if (!rate || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
      (rate.currency !== undefined && rate.currencyCode !== undefined && rate.currency !== rate.currencyCode) ||
      (currency !== undefined && currency !== "USD")) {
    throw new PublicShipError("provider_malformed", "The sandbox returned an unusable USPS rate", 502);
  }
  return {
    service: "PM",
    serviceLabel: typeof rate.serviceDescription === "string" ? rate.serviceDescription : "USPS Priority Mail",
    currency: "USD",
    amount: Number(amount.toFixed(2)),
  };
}

function normalizeLabel(body) {
  const documents = Array.isArray(body?.documents) ? body.documents : [];
  const document = documents.find((item) =>
    (item?.type === undefined || item?.type === "SHIPPING_LABEL") &&
    item?.contentType === "URL" &&
    item?.fileFormat === "PDF" &&
    (item?.size === undefined || item?.size === "DOC_8X11") &&
    typeof item?.contents === "string");
  if (!document || !isSafePdfUrl(document.contents)) {
    throw new PublicShipError("provider_malformed", "The sandbox returned no usable PDF label", 502);
  }
  const rate = Array.isArray(body?.rates) && body.rates.find(
    (item) => typeof item?.carrier === "string" && item.carrier.toUpperCase() === "USPS" && item?.serviceId === "PM" &&
      item?.parcelType === "PKG",
  );
  const rawPrice = rate?.totalCarrierCharge ?? body?.totalCarrierCharge ?? body?.price;
  const currency = rate?.currencyCode ?? rate?.currency ?? body?.currencyCode ?? body?.currency;
  if (typeof body?.shipmentId !== "string" || body.shipmentId.trim() === "" ||
      typeof rawPrice !== "number" || !Number.isFinite(rawPrice) || rawPrice <= 0 ||
      (rate?.currency !== undefined && rate?.currencyCode !== undefined && rate.currency !== rate.currencyCode) ||
      currency !== "USD") {
    throw new PublicShipError("provider_malformed", "The sandbox returned an unusable label price", 502);
  }
  return {
    shipmentId: body.shipmentId,
    pdfUrl: document.contents,
    price: Number(rawPrice.toFixed(2)),
  };
}

function withOutcome(error, purchaseOutcome, recoveryReason) {
  if (!(error instanceof PublicShipError)) {
    error = new PublicShipError("provider_malformed", "The sandbox returned unusable data", 502);
  }
  error.purchaseOutcome = purchaseOutcome;
  if (recoveryReason) error.recoveryReason = recoveryReason;
  return error;
}

function validateTransactionId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,25}$/.test(value)) {
    throw new PublicShipError("validation", "The operation key is invalid");
  }
}

function validateReconciliationTime(value, now) {
  if (!Number.isFinite(value) || value < 0 || value > now ||
      now - value > RECONCILIATION_WINDOW_MS) {
    throw new PublicShipError("validation", "The reconciliation timestamp is invalid");
  }
}

function providerShipment(shipment, forLabel = false) {
  const address = (value) => ({
    name: value.name,
    addressLines: value.addressLines,
    cityTown: value.cityTown,
    stateProvince: value.stateProvince,
    postalCode: value.postalCode,
    countryCode: "US",
  });
  const payload = {
    fromAddress: address(shipment.from),
    toAddress: address(shipment.to),
    parcel: {
      weight: { unitOfMeasurement: "OZ", weight: shipment.parcel.weightOz },
      dimension: {
        unitOfMeasurement: "IN",
        length: shipment.parcel.lengthIn,
        width: shipment.parcel.widthIn,
        height: shipment.parcel.heightIn,
      },
    },
    rates: [{
      carrier: "USPS",
      serviceId: "PM",
      parcelType: "PKG",
      specialServices: [{ specialServiceId: "DelCon" }],
    }],
    shipmentOptions: [{ name: "SHIPPER_ID", value: shipment.shipperId }],
  };
  if (forLabel) {
    payload.documents = [{
      type: "SHIPPING_LABEL",
      contentType: "URL",
      size: "DOC_8X11",
      fileFormat: "PDF",
      printDialogOption: "NO_PRINT_DIALOG",
    }];
  }
  return payload;
}

export function isSafePdfUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === LABEL_HOST && url.port === "" &&
      !url.username && !url.password &&
      !url.search && !url.hash &&
      /^\/usps\/[^/]+\/outbound\/label\/[^/]+\.pdf$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function shipmentFingerprint(shipment) {
  return createHash("sha256").update(JSON.stringify(shipment)).digest("hex");
}

export function createSandboxAdapter({
  credentials,
  fetchImpl = fetch,
  apiOrigin = SANDBOX_API_ORIGIN,
  oauthOrigin = SANDBOX_OAUTH_ORIGIN,
  clock = () => Date.now(),
  timeoutMs = 15_000,
}) {
  assertFixedOrigin(apiOrigin, SANDBOX_API_ORIGIN, "apiOrigin");
  assertFixedOrigin(oauthOrigin, SANDBOX_OAUTH_ORIGIN, "oauthOrigin");
  let token;
  let tokenExpiresAt = 0;

  async function accessToken() {
    if (token && tokenExpiresAt > clock() + 30_000) return token;
    let response;
    try {
      response = await fetchImpl(`${oauthOrigin}/oauth/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PublicShipError("network", "The sandbox could not be reached", 502);
    }
    const body = await readBody(response, "Sandbox authentication");
    const accessTokenValue = body?.access_token;
    const tokenType = body?.tokenType ?? body?.token_type;
    const expiresIn = Number(body?.expiresIn ?? body?.expires_in);
    if (typeof accessTokenValue !== "string" || accessTokenValue.length === 0 ||
        !["BearerToken", "Bearer"].includes(tokenType) ||
        !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new PublicShipError("provider_malformed", "Sandbox authentication returned malformed data", 502);
    }
    token = accessTokenValue;
    tokenExpiresAt = clock() + expiresIn * 1000;
    return token;
  }

  async function request(path, payload, operation) {
    let bearer;
    try {
      bearer = await accessToken();
    } catch (error) {
      throw withOutcome(error, "not_started");
    }
    let response;
    try {
      response = await fetchImpl(`${apiOrigin}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw withOutcome(new PublicShipError("network", "The sandbox could not be reached", 502), "not_started");
    }
    return readBody(response, operation);
  }

  async function authorizedGet(path, operation) {
    let bearer;
    try {
      bearer = await accessToken();
    } catch (error) {
      throw error;
    }
    let response;
    try {
      response = await fetchImpl(`${apiOrigin}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${bearer}` },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PublicShipError("network", "The sandbox could not be reached", 502);
    }
    return readBody(response, operation);
  }

  async function fetchPdf(pdfUrl) {
    if (!isSafePdfUrl(pdfUrl)) {
      throw new PublicShipError("validation", "The label URL is invalid");
    }
    let response;
    try {
      response = await fetchImpl(pdfUrl, {
        method: "GET",
        headers: {},
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PublicShipError("network", "The label could not be downloaded", 502);
    }
    try {
      rejectRedirect(response, "Sandbox label download");
      if (!response.ok || !/^application\/pdf(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
        throw new PublicShipError("provider_malformed", "The sandbox returned an unusable PDF label", 502);
      }
      const bytes = await readResponseBytes(response, "Sandbox label download", MAX_PDF_BODY);
      if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
        throw new PublicShipError("provider_malformed", "The sandbox returned an unusable PDF label", 502);
      }
      return Buffer.from(bytes);
    } catch (error) {
      if (error instanceof PublicShipError) throw error;
      throw new PublicShipError("provider_malformed", "The sandbox returned an unusable PDF label", 502);
    }
  }

  return {
    async quote(shipment) {
      return normalizeRate(await request("/shippingservices/v1/rates", providerShipment({ ...shipment, shipperId: credentials.shipperId }), "Sandbox rate request"));
    },
    async createLabel(shipment, transactionId) {
      if (typeof transactionId !== "string" || !/^[A-Za-z0-9_-]{1,25}$/.test(transactionId)) {
        throw withOutcome(new PublicShipError("validation", "The operation key is invalid"), "not_started");
      }
      let payload;
      try {
        payload = JSON.stringify(providerShipment({ ...shipment, shipperId: credentials.shipperId }, true));
      } catch {
        throw withOutcome(new PublicShipError("validation", "The shipment is invalid"), "not_started");
      }
      let bearer;
      try {
        bearer = await accessToken();
      } catch (error) {
        throw withOutcome(error, "not_started");
      }
      let response;
      try {
        response = await fetchImpl(`${apiOrigin}/shippingservices/v1/shipments`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
            "X-PB-TransactionId": transactionId,
            "X-PB-UnifiedErrorStructure": "true",
          },
          body: payload,
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw withOutcome(new PublicShipError("network", "The sandbox could not be reached", 502), "unknown", "no_response");
      }
      try {
        return normalizeLabel(await readBody(response, "Sandbox test-label request"));
      } catch (error) {
        // PB cautions against resubmitting failed creates without checking the
        // original label. An HTTP error alone never proves a safe second buy.
        if (error instanceof PublicShipError && error.recoveryReason === "http_500") {
          throw withOutcome(error, "unknown", "http_500");
        }
        throw withOutcome(error, "unknown");
      }
    },
    async retrieveLabel(shipmentId) {
      // The caller must own the durable shipment identity before using PB's
      // restricted lost/spoilt-label reprint lookup; local views/prints do not.
      if (typeof shipmentId !== "string" || shipmentId.trim() === "" || shipmentId === "." || shipmentId === "..") {
        throw new PublicShipError("validation", "The shipment ID is invalid");
      }
      const body = await authorizedGet(
        `/shippingservices/v1/shipments/${encodeURIComponent(shipmentId)}?carrier=USPS`,
        "Sandbox label lookup",
      );
      if (body?.shipmentId !== shipmentId) {
        throw new PublicShipError("provider_malformed", "The sandbox returned an unexpected shipment", 502);
      }
      return normalizeLabel(body);
    },
    async fetchLabelPdf(pdfUrl) {
      return fetchPdf(pdfUrl);
    },
    async reconcileLabel(transactionId, options = {}) {
      // Reconciliation is caller-owned recovery for a recent no-response or
      // qualified 500 only; a 404/error never authorizes an automatic reissue.
      validateTransactionId(transactionId);
      const { reason, createdAt } = options;
      if (reason !== "no_response" && reason !== "http_500") {
        throw new PublicShipError("validation", "The reconciliation reason is invalid");
      }
      validateReconciliationTime(createdAt, clock());
      const body = await authorizedGet(
        `/shippingservices/v1/shipments?originalTransactionId=${encodeURIComponent(transactionId)}&carrier=USPS`,
        "Sandbox label reconciliation",
      );
      return normalizeLabel(body);
    },
  };
}
