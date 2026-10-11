import type { ShipTo } from "./order.js";

/** The 50 states and DC: where a v1 domestic USPS label can go without customs forms. */
const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [name.toLowerCase(), code]));
/** Territories and military mail need customs forms, which v1 does not make. */
const CUSTOMS_REGIONS = new Set(["PR", "VI", "GU", "AS", "MP", "UM", "FM", "MH", "PW", "AA", "AE", "AP"]);

/** A label-ready US address, or why it is not one yet. */
export type LabelAddress =
  | { ok: true; name: string; lines: string[]; city: string; state: string; zip: string }
  | { ok: false; problem: string };

export function stateCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\.$/, "");
  const upper = trimmed.toUpperCase();
  if (STATES[upper] || CUSTOMS_REGIONS.has(upper)) return upper;
  return BY_NAME.get(trimmed.toLowerCase());
}

/**
 * Checks an address for a v1 domestic label. A problem is shown to the owner,
 * who fixes the address in Commerce; the fix arrives as a new order version.
 */
export function labelAddress(address: Pick<ShipTo, "name" | "line1" | "line2" | "city" | "region" | "postalCode">): LabelAddress {
  const state = stateCode(address.region);
  if (!state) return { ok: false, problem: "The address has no US state. Add the state in Commerce's Orders page." };
  if (CUSTOMS_REGIONS.has(state)) {
    return { ok: false, problem: "US territories and military addresses need customs forms, which Ship does not make yet." };
  }
  const zip = address.postalCode.trim().match(/^(\d{5})(?:-?(\d{4}))?$/);
  if (!zip) return { ok: false, problem: "The ZIP code is not a 5 or 9 digit US ZIP code. Fix it in Commerce's Orders page." };
  return {
    ok: true, name: address.name.trim(), city: address.city.trim(), state,
    lines: [address.line1, address.line2].filter((line): line is string => Boolean(line?.trim())).map(line => line.trim()),
    zip: zip[2] ? `${zip[1]}-${zip[2]}` : zip[1]!,
  };
}
