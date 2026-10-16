import { NOT_ONE_LINE } from "./order.js";

/**
 * Pitney Bowes Shipping API calls for USPS labels (PB Expedited, carrier "USPS").
 * Only the sandbox for now: live postage waits for Ronald's word and DinkusKit's
 * PB merchant sign-up link. Ported from the plugin's src/pb-sandbox.js.
 */
export const PB_SANDBOX_ORIGIN = "https://shipping-api-sandbox.pitneybowes.com";
/**
 * Pitney Bowes's sandbox Merchant Portal, where a store owner signs up for their own PB
 * postage account under DinkusKit's developer account (production is www.pbshippingmerchant.pitneybowes.com).
 */
export const PB_SANDBOX_SIGNUP_ORIGIN = "https://developer.pbshippingmerchant.pitneybowes.com";
/** Where the sandbox serves label PDFs; nothing else is downloaded. */
export const PB_SANDBOX_LABEL_HOST = "stg-labels-cls.gcs.pitneybowes.com";
/** PB's service ids for the three services Ship offers (PB carrier reference, PB Expedited). */
export const PB_SERVICE_IDS = { GA: "UGA", PM: "PM", EM: "EM" } as const;
export type PbService = keyof typeof PB_SERVICE_IDS;

const TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 1_000_000;
/** A Durable Object SQLite row holds at most 2 MB; a letter-size label is far smaller. */
const MAX_PDF_BYTES = 1_500_000;

export interface PbConfig { apiKey: string; apiSecret: string; shipperId: string }
export interface PbAddress { name: string; company?: string; lines: string[]; city: string; state: string; zip: string }
export interface PbShipment {
  from: PbAddress; to: PbAddress; service: PbService;
  weightOz: number; lengthIn: number; widthIn: number; heightIn: number;
}
export interface PbLabel { shipmentId: string; tracking: string; priceCents: number; pdfUrl: string }
/** A store owner's own PB postage account, as PB describes it once they connect it. */
export interface PbMerchant { shipperId: string; company: string | null; email: string | null; accountNumber: string | null }
/** What Ship already knows about the owner, filled into PB's sign-up form. */
export interface SignupPrefill {
  email?: string; name?: string; company?: string;
  line1?: string; line2?: string; city?: string; state?: string; postalCode?: string;
}

/**
 * Why a call failed.
 * - `refused`: PB answered and said no (bad address, too heavy, no postage balance). Nothing was bought.
 * - `not_started`: the purchase was never sent, or PB could not be reached for a lookup.
 * - `unknown`: a purchase was sent and PB gave no usable answer, so a label may exist.
 */
export class PitneyError extends Error {
  constructor(readonly kind: "refused" | "not_started" | "unknown", message: string) {
    super(message);
    this.name = "PitneyError";
  }
}

/** The sandbox keys, or null while Ronald has not set them. */
export function pitneyConfig(env: Env): PbConfig | null {
  if (env.PB_ENVIRONMENT !== "sandbox") return null;
  const { PB_API_KEY: apiKey, PB_API_SECRET: apiSecret, PB_SHIPPER_ID: shipperId } = env;
  return apiKey && apiSecret && shipperId ? { apiKey, apiSecret, shipperId } : null;
}

async function readBytes(response: Response, max: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(await readBytes(response, MAX_JSON_BYTES)));
  } catch {
    return undefined;
  }
}

/** PB's own words for a refusal, kept to one short line; they go only to the store's owner. */
function refusalText(body: unknown): string {
  const errors = (body as { errors?: unknown })?.errors;
  const first = Array.isArray(errors) ? errors[0] as Record<string, unknown> | undefined : undefined;
  const text = [first?.message, first?.errorDescription, first?.additionalInfo].find(value => typeof value === "string" && value.trim());
  const clean = typeof text === "string" ? text.replace(new RegExp(NOT_ONE_LINE.source, "g"), " ").replace(/ {2,}/g, " ").trim().slice(0, 200) : "";
  return clean ? `Pitney Bowes said: ${clean}` : "Pitney Bowes refused the label.";
}

let cachedToken: { key: string; token: string; expiresAt: number } | undefined;

async function accessToken(config: PbConfig): Promise<string> {
  if (cachedToken?.key === config.apiKey && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  let response: Response;
  try {
    response = await fetch(`${PB_SANDBOX_ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { authorization: `Basic ${btoa(`${config.apiKey}:${config.apiSecret}`)}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PitneyError("not_started", "Ship could not reach Pitney Bowes. Try again in a minute.");
  }
  const body = await readJson(response) as Record<string, unknown> | undefined;
  const token = body?.access_token;
  const expiresIn = Number(body?.expiresIn ?? body?.expires_in);
  if (!response.ok || typeof token !== "string" || !token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new PitneyError("not_started", "Ship could not sign in to Pitney Bowes. DinkusKit has been told; try again later.");
  }
  cachedToken = { key: config.apiKey, token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

function address(value: PbAddress) {
  return {
    name: value.name, ...(value.company ? { company: value.company } : {}), addressLines: value.lines,
    cityTown: value.city, stateProvince: value.state, postalCode: value.zip, countryCode: "US",
  };
}

function shipmentBody(config: PbConfig, shipment: PbShipment, withLabel: boolean) {
  return {
    fromAddress: address(shipment.from), toAddress: address(shipment.to),
    parcel: {
      weight: { unitOfMeasurement: "OZ", weight: shipment.weightOz },
      dimension: { unitOfMeasurement: "IN", length: shipment.lengthIn, width: shipment.widthIn, height: shipment.heightIn },
    },
    rates: [{
      carrier: "USPS", serviceId: PB_SERVICE_IDS[shipment.service], parcelType: "PKG",
      // PB refuses a package that is not trackable (error 1022026). Ground Advantage and Priority Mail
      // are trackable only with Delivery Confirmation, which PB adds at no charge; Express is tracked already.
      ...(shipment.service === "GA" || shipment.service === "PM" ? { specialServices: [{ specialServiceId: "DelCon" }] } : {}),
    }],
    // The store's own PB postage account pays for the label.
    shipmentOptions: [{ name: "SHIPPER_ID", value: config.shipperId }],
    ...(withLabel ? {
      documents: [{ type: "SHIPPING_LABEL", contentType: "URL", size: "DOC_8X11", fileFormat: "PDF", printDialogOption: "NO_PRINT_DIALOG" }],
    } : {}),
  };
}

function cents(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

export function isLabelUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === PB_SANDBOX_LABEL_HOST && url.port === "" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** A bought label from PB's answer, or null when the answer is not one. */
function readLabel(body: unknown): PbLabel | null {
  const value = body as Record<string, unknown> | undefined;
  const documents = Array.isArray(value?.documents) ? value.documents as Record<string, unknown>[] : [];
  const pdf = documents.find(item => item.contentType === "URL" && item.fileFormat === "PDF" && isLabelUrl(item.contents));
  const rate = Array.isArray(value?.rates) ? (value.rates as Record<string, unknown>[])[0] : undefined;
  const tracking = value?.parcelTrackingNumber;
  const shipmentId = value?.shipmentId;
  const priceCents = cents(rate?.totalCarrierCharge);
  if (!pdf || typeof shipmentId !== "string" || !shipmentId || shipmentId.length > 100 ||
      typeof tracking !== "string" || !tracking || tracking.length > 64 || NOT_ONE_LINE.test(tracking) || priceCents === null) {
    return null;
  }
  return { shipmentId, tracking, priceCents, pdfUrl: pdf.contents as string };
}

async function call(config: PbConfig, method: string, path: string, options: { body?: unknown; transactionId?: string } = {}): Promise<Response> {
  const token = await accessToken(config);
  return fetch(`${PB_SANDBOX_ORIGIN}/shippingservices${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json", "x-pb-unifiederrorstructure": "true",
      ...(options.transactionId ? { "x-pb-transactionid": options.transactionId } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** A 25-character id PB keeps with the purchase, so Ship can look it up after a lost answer. */
export function newTransactionId(): string {
  return `shp${Array.from(crypto.getRandomValues(new Uint8Array(22)), byte => "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36]).join("")}`;
}

/** What one service would cost, in cents. */
export async function quote(config: PbConfig, shipment: PbShipment): Promise<number> {
  let response: Response;
  try {
    response = await call(config, "POST", "/v1/rates", { body: shipmentBody(config, shipment, false) });
  } catch (error) {
    if (error instanceof PitneyError) throw error;
    throw new PitneyError("not_started", "Ship could not reach Pitney Bowes. Try again in a minute.");
  }
  const body = await readJson(response);
  if (response.status >= 400 && response.status < 500) throw new PitneyError("refused", refusalText(body));
  const rates = (body as { rates?: Record<string, unknown>[] } | undefined)?.rates;
  const price = Array.isArray(rates) ? cents(rates[0]?.totalCarrierCharge) : null;
  if (!response.ok || price === null) throw new PitneyError("not_started", "Pitney Bowes did not return a price. Try again in a minute.");
  return price;
}

/** Buys the label. The store's PB postage account is charged once PB answers with a label. */
export async function buy(config: PbConfig, shipment: PbShipment, transactionId: string): Promise<PbLabel> {
  const body = shipmentBody(config, shipment, true);
  // Before this point nothing was sent, so a failure means nothing was bought.
  await accessToken(config);
  let response: Response;
  try {
    response = await call(config, "POST", "/v1/shipments?includeDeliveryCommitment=false", { body, transactionId });
  } catch {
    throw new PitneyError("unknown", "Pitney Bowes did not answer.");
  }
  const answer = await readJson(response);
  // A 4xx is PB refusing the request; a 5xx or a garbled answer may still have bought a label.
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
    throw new PitneyError("refused", refusalText(answer));
  }
  const label = response.ok ? readLabel(answer) : null;
  if (!label) throw new PitneyError("unknown", "Pitney Bowes did not confirm the label.");
  return label;
}

/** The label PB made for a purchase whose answer was lost, or null if PB has none. */
export async function findPurchase(config: PbConfig, transactionId: string): Promise<PbLabel | null> {
  let response: Response;
  try {
    response = await call(config, "GET", `/v1/shipments?originalTransactionId=${encodeURIComponent(transactionId)}&carrier=USPS`);
  } catch {
    throw new PitneyError("not_started", "Ship could not reach Pitney Bowes to check the last label. Try again in a minute.");
  }
  const answer = await readJson(response);
  if (response.status === 404) return null;
  const label = response.ok ? readLabel(answer) : null;
  if (!label) throw new PitneyError("not_started", "Pitney Bowes could not say whether the last label was bought. Try again in a minute.");
  return label;
}

/** Voids an unused label; USPS refunds it to the store's postage account, which can take up to 14 days. */
export async function voidLabel(config: PbConfig, shipmentId: string): Promise<string> {
  let response: Response;
  try {
    response = await call(config, "DELETE", `/v1/shipments/${encodeURIComponent(shipmentId)}?carrier=USPS&cancelInitiator=SHIPPER`, { transactionId: newTransactionId() });
  } catch (error) {
    if (error instanceof PitneyError) throw error;
    throw new PitneyError("not_started", "Ship could not reach Pitney Bowes. The label is not cancelled; try again in a minute.");
  }
  const answer = await readJson(response) as Record<string, unknown> | undefined;
  if (response.status >= 400 && response.status < 500) throw new PitneyError("refused", refusalText(answer));
  const status = answer?.status;
  if (!response.ok || (status !== "INITIATED" && status !== "APPROVED")) {
    throw new PitneyError("not_started", "Pitney Bowes did not confirm the cancel. The label is not cancelled; try again in a minute.");
  }
  return status;
}

/** Downloads the label PDF PB made; its link only lasts about a day, so Ship keeps a copy. */
export async function downloadPdf(url: string): Promise<Uint8Array> {
  if (!isLabelUrl(url)) throw new PitneyError("not_started", "The label link is not a Pitney Bowes label.");
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const bytes = await readBytes(response, MAX_PDF_BYTES);
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("not a PDF");
    return bytes;
  } catch {
    throw new PitneyError("not_started", "Ship could not download the label PDF yet. Try again in a minute.");
  }
}

/**
 * PB's sign-up page for a new postage account under DinkusKit's developer account,
 * with what Ship knows filled in. PB has no way back to Ship afterwards; the owner
 * returns and connects the account.
 */
export function signupUrl(developerId: string, prefill: SignupPrefill): string {
  const [first, ...rest] = (prefill.name ?? "").trim().split(/\s+/);
  const params: Record<string, string | undefined> = {
    developerID: developerId, fName: first || undefined, lName: rest.join(" ") || undefined, email: prefill.email,
    companyName: prefill.company, addressLine1: prefill.line1, addressLine2: prefill.line2,
    city: prefill.city, state: prefill.state, postalCode: prefill.postalCode,
  };
  const query = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return `${PB_SANDBOX_SIGNUP_ORIGIN}/create/accountInfo?${query}`;
}

function oneLine(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max && !NOT_ONE_LINE.test(value) ? value.trim() : null;
}

/**
 * Finds the owner's PB postage account from the username and password they signed up
 * with, and returns its Shipper ID. PB sees the password; Ship passes it on once and
 * never keeps it.
 */
export async function authorizeMerchant(config: PbConfig, developerId: string, username: string, password: string): Promise<PbMerchant> {
  let response: Response;
  try {
    response = await call(config, "POST", `/v1/developers/${encodeURIComponent(developerId)}/merchants/credentials`, { body: { username, password } });
  } catch (error) {
    if (error instanceof PitneyError) throw error;
    throw new PitneyError("not_started", "Ship could not reach Pitney Bowes. Try again in a minute.");
  }
  const answer = await readJson(response) as Record<string, unknown> | undefined;
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new PitneyError("refused", "Pitney Bowes did not accept that username and password. Use the account you made from Ship's sign-up link.");
  }
  if (response.status >= 400 && response.status < 500) throw new PitneyError("refused", refusalText(answer));
  const shipperId = oneLine(answer?.postalReportingNumber, 100);
  if (!response.ok || !shipperId) throw new PitneyError("not_started", "Pitney Bowes did not return your account. Try again in a minute.");
  if (answer?.merchantStatus !== "ACTIVE") throw new PitneyError("refused", "Pitney Bowes says this account is not active yet. Finish signing up with Pitney Bowes, then connect it again.");
  if (answer?.paymentServicesAccountIdActive !== true) {
    throw new PitneyError("refused", "This Pitney Bowes account has no working way to pay for postage yet. Add a card in Pitney Bowes, then connect it again.");
  }
  return {
    shipperId, company: oneLine(answer?.company, 200), email: oneLine(answer?.email, 254),
    accountNumber: oneLine(answer?.paymentAccountNumber, 100),
  };
}
