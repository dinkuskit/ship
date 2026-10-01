import { createHash } from "node:crypto";

export const SANDBOX_API_ORIGIN = "https://shipping-api-sandbox.pitneybowes.com";
export const SANDBOX_OAUTH_ORIGIN = SANDBOX_API_ORIGIN;
export const LABEL_HOST = "stg-labels-cls.gcs.pitneybowes.com";
const MAX_PROVIDER_BODY = 1_000_000;

export class PublicShipError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
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

async function readBody(response, operation) {
  const reader = response.body?.getReader();
  let text = "";
  try {
    if (!reader) text = await response.text();
    else {
      const decoder = new TextDecoder();
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_PROVIDER_BODY) throw new Error("response too large");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
  } catch {
    throw new PublicShipError("provider_malformed", `${operation} returned malformed data`, 502);
  }
  if (text.length > MAX_PROVIDER_BODY) {
    throw new PublicShipError("provider_malformed", `${operation} returned an oversized response`, 502);
  }
  let body;
  try { body = JSON.parse(text); } catch {
    throw new PublicShipError("provider_malformed", `${operation} returned malformed data`, 502);
  }
  if (!response.ok) {
    throw new PublicShipError(
      response.status === 401 || response.status === 403 ? "provider_auth" : "provider_failure",
      `${operation} could not be completed`, 502,
    );
  }
  return body;
}

function normalizeRate(body) {
  const rate = Array.isArray(body?.rates) && body.rates.find(
    (item) => item?.carrier?.toUpperCase() === "USPS" && item?.serviceId === "PM" &&
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
    item?.type === "SHIPPING_LABEL" && item?.contentType === "URL" &&
    item?.fileFormat === "PDF" && item?.size === "DOC_8X11" &&
    typeof item?.contents === "string");
  if (!document || !isSafePdfUrl(document.contents)) {
    throw new PublicShipError("provider_malformed", "The sandbox returned no usable PDF label", 502);
  }
  const rate = Array.isArray(body?.rates) && body.rates.find(
    (item) => item?.carrier?.toUpperCase() === "USPS" && item?.serviceId === "PM" &&
      item?.parcelType === "PKG",
  );
  const rawPrice = rate?.totalCarrierCharge ?? body.totalCarrierCharge ?? body.price;
  const currency = rate?.currencyCode ?? rate?.currency ?? body.currencyCode ?? body.currency;
  if (typeof body.shipmentId !== "string" || body.shipmentId.trim() === "" ||
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
    if (typeof body.access_token !== "string" || typeof body.tokenType !== "string") {
      throw new PublicShipError("provider_malformed", "Sandbox authentication returned malformed data", 502);
    }
    token = body.access_token;
    const expiresIn = Number(body.expiresIn);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new PublicShipError("provider_malformed", "Sandbox authentication returned malformed data", 502);
    }
    tokenExpiresAt = clock() + expiresIn * 1000;
    return token;
  }

  async function request(path, payload, operation) {
    const bearer = await accessToken();
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
      throw new PublicShipError("network", "The sandbox could not be reached", 502);
    }
    return readBody(response, operation);
  }

  return {
    async quote(shipment) {
      return normalizeRate(await request("/shippingservices/v1/rates", providerShipment({ ...shipment, shipperId: credentials.shipperId }), "Sandbox rate request"));
    },
    async createLabel(shipment, transactionId) {
      if (!/^[A-Za-z0-9_-]{1,25}$/.test(transactionId || "")) {
        throw new PublicShipError("validation", "The operation key is invalid");
      }
      const bearer = await accessToken();
      let response;
      try {
        response = await fetchImpl(`${apiOrigin}/shippingservices/v1/shipments`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
            "X-PB-TransactionId": transactionId,
          },
          body: JSON.stringify(providerShipment({ ...shipment, shipperId: credentials.shipperId }, true)),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new PublicShipError("network", "The sandbox could not be reached", 502);
      }
      return normalizeLabel(await readBody(response, "Sandbox test-label request"));
    },
  };
}
