import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSandboxAdapter, isSafePdfUrl, loadSandboxCredentials, PublicShipError } from "./pb-sandbox.js";
import { FileStateStore, SandboxTask } from "./state.js";

const root = dirname(fileURLToPath(import.meta.url));
const runDir = process.env.PB_RUN_DIR || join(root, "..", "runs", "pb-sandbox-interface-runs", "20260930");

let credentials;
try {
  credentials = loadSandboxCredentials();
} catch {
  credentials = null;
}

export function createApp({
  adapter = credentials ? createSandboxAdapter({ credentials }) : null,
  store = new FileStateStore(join(runDir, "task-state.json")),
  port = Number(process.env.PORT || 4317),
  pdfFetch = fetch,
  fixtureBanner = false,
} = {}) {
  const task = new SandboxTask({ adapter, store });
  const htmlPromise = readFile(join(root, "public", "index.html"), "utf8").then((html) =>
    fixtureBanner ? html.replace("</header>", "</header><p class=\"banner\">FIXTURE PROOF — NO LIVE PB API</p>") : html);

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

async function body(req) {
  let text = "";
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new PublicShipError("validation", "Request is too large", 413);
    text += chunk;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicShipError("validation", "Request body is invalid", 400);
  }
}

  const server = createServer(async (req, res) => {
  try {
    const actualPort = server.address()?.port || port;
    const host = req.headers.host;
    if (host !== `127.0.0.1:${actualPort}`) throw new PublicShipError("origin", "Local origin required", 403);
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${actualPort}`) throw new PublicShipError("origin", "Local origin required", 403);
    if (req.method === "POST" && !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
      throw new PublicShipError("validation", "JSON content type required", 415);
    }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await htmlPromise);
      return;
    }
    if (req.method === "GET" && req.url === "/api/status") {
      const state = await task.store.read();
      json(res, 200, { configured: Boolean(adapter), operations: Object.fromEntries(Object.entries(state.operations).map(([key, op]) => [key, {
        status: op.status, quoteId: op.quoteId, reviewedAmount: op.reviewedAmount, fingerprint: op.fingerprint,
      }])) });
      return;
    }
    if (req.method === "POST" && req.url === "/api/quote") {
      json(res, 200, { quote: await task.quote((await body(req)).shipment) });
      return;
    }
    if (req.method === "POST" && req.url === "/api/test-label") {
      const input = await body(req);
      const result = await task.createTestLabel(input);
      json(res, 200, { result: { shipmentId: result.shipmentId }, testOnly: true, downloadPath: `/api/test-label/${input.idempotencyKey}/pdf` });
      return;
    }
    const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const match = requestUrl.pathname.match(/^\/api\/test-label\/([^/]+)\/pdf$/);
    if (req.method === "GET" && match) {
      const state = await task.store.read();
      const operation = state.operations[decodeURIComponent(match[1])];
      if (!operation || operation.status !== "label_created" || !isSafePdfUrl(operation.result.pdfUrl)) {
        throw new PublicShipError("not_found", "Test label PDF is unavailable", 404);
      }
      let response;
      try {
        response = await pdfFetch(operation.result.pdfUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      } catch {
        throw new PublicShipError("network", "The sandbox PDF could not be reached", 502);
      }
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      const length = Number(response.headers.get("content-length") || 0);
      if (!response.ok || !contentType.startsWith("application/pdf") || length > 10_000_000) {
        throw new PublicShipError("provider_malformed", "The sandbox PDF was unusable", 502);
      }
      const reader = response.body?.getReader();
      const chunks = [];
      let size = 0;
      if (!reader) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 10_000_000) throw new PublicShipError("provider_malformed", "The sandbox PDF was too large", 502);
        chunks.push(bytes);
      }
      else while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 10_000_000) throw new PublicShipError("provider_malformed", "The sandbox PDF was too large", 502);
        chunks.push(Buffer.from(next.value));
      }
      const pdf = Buffer.concat(chunks);
      if (pdf.length < 5 || pdf.subarray(0, 5).toString() !== "%PDF-") throw new PublicShipError("provider_malformed", "The sandbox PDF was unusable", 502);
      const download = requestUrl.searchParams.get("download") === "1";
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename=test-label.pdf`,
        "Cache-Control": "no-store",
      });
      res.end(pdf);
      return;
    }
    json(res, 404, { error: "not_found", message: "Not found" });
  } catch (error) {
    const safe = error instanceof PublicShipError ? error : new PublicShipError("internal", "The sandbox operation failed", 500);
    json(res, safe.status, { error: safe.code, message: safe.message });
  }
  });
  server.on("close", () => { void store.close(); });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 4317);
  const server = createApp({ port });
  server.listen(port, "127.0.0.1", () => {
    console.log(`PB sandbox merchant lab listening at http://127.0.0.1:${port}`);
  });
  const shutdown = () => server.close();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
