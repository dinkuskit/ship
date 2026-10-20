/**
 * Where a live label is, as the carrier's scans say (GrillTrack ship-tracking-001).
 * Ship learns it from Pitney Bowes's tracking updates and a daily Track a Parcel
 * check; sandbox and practice labels never move, so they never get one.
 */
export type DeliveryState = "in_transit" | "out_for_delivery" | "delivered" | "problem";
export interface Delivery {
  state: DeliveryState;
  /** When the carrier scanned it, UTC ISO. */
  at: string;
  /** The carrier's one-line word on it, when it gave one. */
  note: string | null;
}

/** Pitney Bowes's packageStatus values to Ship's states; null is a scan that moves nothing (label made, information only). */
const STATES: Record<string, DeliveryState | null> = {
  Manifest: null, "Information Event": null,
  Acceptance: "in_transit", PickedUp: "in_transit", InTransit: "in_transit",
  OutForDelivery: "out_for_delivery", Delivered: "delivered",
  DeliveryAttempt: "problem", Exception: "problem", ReturnToSender: "problem", ReadyForPickup: "problem",
  PickupMissed: "problem", "Shipment delayed": "problem",
};
const PLAIN: Record<string, string> = {
  DeliveryAttempt: "Delivery attempted", Exception: "Delivery problem", ReturnToSender: "Returning to sender",
  ReadyForPickup: "Ready for pickup at the post office", PickupMissed: "Pickup missed", "Shipment delayed": "Delayed",
};
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+", "g");
const PHRASE: Record<DeliveryState, string> = { in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered", problem: "Problem" };

export const TRACKING_NUMBER = /^[A-Za-z0-9]{6,64}$/;

/** A carrier's description as one short line, or null. */
export function oneLineNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(CONTROL, " ").replace(/ {2,}/g, " ").trim();
  return clean ? clean.slice(0, 120) : null;
}

/** A scan's date and time as UTC ISO; the moment Ship heard of it when they cannot be read. */
export function scanTime(date: unknown, time: unknown, offset: unknown, heardAt = new Date()): string {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const clock = typeof time === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(time) ? time : "00:00:00";
    const zone = typeof offset === "string" && /^[+-]\d{2}:?\d{2}$/.test(offset) ? offset.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2") : "Z";
    const parsed = Date.parse(`${date}T${clock}${zone}`);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return heardAt.toISOString();
}

/** One Pitney Bowes scan as a Delivery; null when it moves nothing or is not a status Ship knows. */
export function deliveryFromScan(packageStatus: unknown, description: unknown, at: string): Delivery | null {
  if (typeof packageStatus !== "string") return null;
  const state = STATES[packageStatus];
  if (!state) return null;
  const note = oneLineNote(description) ?? PLAIN[packageStatus] ?? null;
  return { state, at, note };
}

/** "In transit", "Delivered", "Problem: Delivery attempted". */
export function deliveryText(delivery: Delivery, withNote = true): string {
  const phrase = PHRASE[delivery.state];
  return withNote && delivery.note && delivery.state === "problem" ? `${phrase}: ${delivery.note}` : phrase;
}
