const MAX_WEIGHT_LB = 70;
const MAX_PRIORITY_LENGTH_PLUS_GIRTH_IN = 108;

const SYNTHETIC_DESTINATION = Object.freeze({
  country: "US",
  addressLine: "100 Example Avenue",
  city: "Anytown",
  region: "CA",
  postalCode: "90210",
});

const SYNTHETIC_PAID_TOTAL = Object.freeze({
  amount: 48,
  currency: "USD",
  status: "paid",
});

function invalid(code, message) {
  return Object.freeze({ ok: false, code, message });
}

function decimal(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validatePackage(packageInput) {
  const weightLb = decimal(packageInput?.weightLb);
  const lengthIn = decimal(packageInput?.lengthIn);
  const widthIn = decimal(packageInput?.widthIn);
  const heightIn = decimal(packageInput?.heightIn);
  if ([weightLb, lengthIn, widthIn, heightIn].some((value) => value === null)) {
    return invalid("invalid_number", "Weight and dimensions must be finite decimal values.");
  }
  if ([weightLb, lengthIn, widthIn, heightIn].some((value) => value <= 0)) {
    return invalid("nonpositive", "Weight and dimensions must be greater than zero.");
  }
  if (weightLb > MAX_WEIGHT_LB) {
    return invalid("weight_out_of_range", `Weight must be no more than ${MAX_WEIGHT_LB} lb.`);
  }
  if (lengthIn + (2 * (widthIn + heightIn)) > MAX_PRIORITY_LENGTH_PLUS_GIRTH_IN) {
    return invalid(
      "dimensions_out_of_range",
      `Length plus girth must be no more than ${MAX_PRIORITY_LENGTH_PLUS_GIRTH_IN} in.`,
    );
  }
  return Object.freeze({ ok: true, package: Object.freeze({
    weight: weightLb,
    weightUnit: "lb",
    dimensions: Object.freeze({ length: lengthIn, width: widthIn, height: heightIn, unit: "in" }),
  }) });
}

export function projectSyntheticQuoteRequest({ order, package: packageInput } = {}) {
  if (order?.fixture !== "synthetic-order-1042") {
    return invalid("no_order", "A synthetic fixture order is required before package review.");
  }
  const result = validatePackage(packageInput);
  if (!result.ok) return result;
  return Object.freeze({
    ok: true,
    request: Object.freeze({
      destination: SYNTHETIC_DESTINATION,
      package: result.package,
      service: "USPS Priority Mail",
      quotePrerequisite: "commerce_unavailable",
      operationGate: "original_provider_unknown",
    }),
    paidTotal: SYNTHETIC_PAID_TOTAL,
  });
}

export { SYNTHETIC_DESTINATION, SYNTHETIC_PAID_TOTAL, validatePackage };
