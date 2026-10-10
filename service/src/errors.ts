/** Extra fields an error body may carry next to its code and message. */
export type ErrorDetail = Readonly<Record<string, unknown>>;

export class ServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly detail?: ErrorDetail) {
    super(message);
    this.name = "ServiceError";
  }
}

/** A result that crosses the Durable Object RPC boundary as plain data. */
export type Outcome =
  | { readonly ok: true; readonly status: number; readonly body: unknown }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string; readonly detail?: ErrorDetail };

export function ok(body: unknown, status = 200): Outcome {
  return { ok: true, status, body };
}

export function toOutcome(error: unknown): Outcome {
  if (error instanceof ServiceError) {
    return { ok: false, status: error.status, code: error.code, message: error.message, ...(error.detail ? { detail: error.detail } : {}) };
  }
  console.error("ship service internal error", error);
  return { ok: false, status: 500, code: "INTERNAL", message: "internal error" };
}
