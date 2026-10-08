const MAX_PDF_BYTES = 5 * 1024 * 1024;
const ORDER_ID = /^(?:order:)?[A-Za-z0-9._-]{1,100}$/;
const OPERATION_ID = /^[A-Za-z0-9._-]{1,25}$/;
const INTENTS = new Set(['view', 'download', 'preview']);
const PRIVATE = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const error = status => new Response('Shipping label unavailable.', { status, headers: { ...PRIVATE, 'content-type': 'text/plain; charset=utf-8' } });
const validOrder = value => typeof value === 'string' && value.length <= 100 && ORDER_ID.test(value);
const validOperation = value => typeof value === 'string' && OPERATION_ID.test(value);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function parse(request) {
  if (request?.method !== 'GET') return null;
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !['orderId', 'operationId', 'intent'].includes(key) || query.getAll(key).length !== 1)) return null;
  const orderId = query.get('orderId'), operationId = query.get('operationId'), intent = query.get('intent');
  return validOrder(orderId) && validOperation(operationId) && INTENTS.has(intent) ? { orderId, operationId, intent } : null;
}

function pdfBytes(result) {
  const raw = result?.success === true && result.data;
  if (!raw || raw.__emdashPluginResponse !== true || raw.status !== 200 || raw.body?.kind !== 'bytes') return null;
  if (!Array.isArray(raw.headers) || !raw.headers.some(([name, value]) => name.toLowerCase() === 'content-type' && value === 'application/pdf')) return null;
  const bytes = raw.body.value;
  return bytes instanceof Uint8Array && bytes.length >= 5 && bytes.length <= MAX_PDF_BYTES &&
    String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-' ? bytes : null;
}

function viewer({ download, preview }) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  return { nonce, html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shipping label</title>
<style>body{font:16px system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem}nav{display:flex;gap:1rem;flex-wrap:wrap}button,a{font:inherit;padding:.6rem}iframe{width:100%;height:65vh;border:1px solid #888}#status{min-height:2rem}</style></head><body>
<h1>Shipping label</h1><p>Authorized stored label. Printing is controlled by your browser; an attempt does not confirm physical printing or delivery.</p>
<nav aria-label="Label actions"><button id="view" type="button">View label</button><a href="${escape(download)}" download="shipping-label.pdf">Download label</a><button id="print" type="button">Print attempt</button></nav>
<p id="status" role="status" aria-live="polite">Choose an action.</p><iframe id="label" title="Shipping label preview" hidden></iframe>
<script nonce="${nonce}">
const frame = document.getElementById('label'), status = document.getElementById('status');
const preview = ${JSON.stringify(preview)};
let busy = false;
async function load(print) {
  if (busy) return;
  busy = true;
  status.textContent = 'Loading authorized label…';
  try {
    // This is a native same-origin read-only GET, not a plugin CSRF exemption.
    const result = await fetch(preview, { credentials: 'same-origin', cache: 'no-store' });
    if (!result.ok || result.headers.get('content-type') !== 'application/pdf') throw new Error('unavailable');
    // Verify a bounded body before navigation; the displayed route reauthorizes.
    const bytes = await result.arrayBuffer();
    if (bytes.byteLength < 5 || bytes.byteLength > ${MAX_PDF_BYTES}) throw new Error('unavailable');
    frame.hidden = false;
    frame.onload = () => {
      busy = false;
      if (print) {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); status.textContent = 'Print attempt sent to the browser. Physical printing is not confirmed.'; }
        catch { status.textContent = 'The browser could not start a print attempt. Use Download label to print the authorized file.'; }
      } else status.textContent = 'Label loaded.';
    };
    frame.src = preview;
  } catch { busy = false; frame.hidden = true; status.textContent = 'The label could not be loaded. Access may have changed.'; }
}
document.getElementById('view').addEventListener('click', () => load(false));
document.getElementById('print').addEventListener('click', () => load(true));
</script></body></html>` };
}

export function createLabelLinks({ path = '/_emdash/api/ship-label-assets' } = {}) {
  if (typeof path !== 'string' || !/^\/_emdash\/api\/[A-Za-z0-9/_-]+$/.test(path)) throw new TypeError('Fixed native mount required');
  const url = (orderId, operationId, intent) => path + '?' + new URLSearchParams({ orderId, operationId, intent });
  function links({ orderId, operationId, requestUrl } = {}) {
    if (!validOrder(orderId) || !validOperation(operationId)) return null;
    let origin;
    try { const request = new URL(requestUrl); if (!['http:', 'https:'].includes(request.protocol) || request.username || request.password) return null; origin = request.origin; } catch { return null; }
    const absolute = intent => new URL(url(orderId, operationId, intent), origin).href;
    return {
      view: { type: 'link', label: 'View label', target: { kind: 'external', url: absolute('view') } },
      download: { type: 'link', label: 'Download label', target: { kind: 'external', url: absolute('download') } },
      print: { type: 'link', label: 'Open print controls', target: { kind: 'external', url: absolute('view') } },
    };
  }
  return links;
}

/** Trusted native Astro mount only. Policy helpers must be the host's public
 * @emdash-cms/auth exports. Browser input never selects installation or caller.
 * Keep the mount under /_emdash/api so EmDash authenticates locals first. */
export function createHostLabelAssets({ pluginId, path = '/_emdash/api/ship-label-assets', hasPermission, hasScope } = {}) {
  if (typeof pluginId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(pluginId) ||
      typeof path !== 'string' || !/^\/_emdash\/api\/[A-Za-z0-9/_-]+$/.test(path) ||
      typeof hasPermission !== 'function' || typeof hasScope !== 'function') throw new TypeError('Native host policy and fixed mount are required');
  const route = 'label-stored';
  const url = (orderId, operationId, intent) => path + '?' + new URLSearchParams({ orderId, operationId, intent });
  const links = createLabelLinks({ path });
  async function GET({ request, locals } = {}) {
    const input = parse(request);
    if (!input) return error(request?.method === 'GET' ? 400 : 405);
    try {
      const user = locals?.user, runtime = locals?.emdash;
      if (!user?.id) return error(401);
      if (!hasPermission(user, 'plugins:manage') || (locals.tokenScopes !== undefined && !hasScope(locals.tokenScopes, 'admin'))) return error(403);
      if (!runtime?.getManifest || !runtime.getPluginRouteMeta || !runtime.handlePluginApiRoute) return error(503);
      const manifest = await runtime.getManifest();
      if (manifest?.plugins?.[pluginId]?.enabled !== true) return error(503);
      const meta = runtime.getPluginRouteMeta(pluginId, route);
      if (meta?.public !== false || meta.permission !== 'plugins:manage' || meta.response !== 'raw' || !meta.methods?.includes('POST') || meta.request?.body !== 'json') return error(503);
      const internal = new Request(new URL(path, request.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: input.orderId, operationId: input.operationId }) });
      // Authentication, RBAC, token scope and installation selection precede
      // every trusted call; this low-level API does not enforce those policies.
      const result = await runtime.handlePluginApiRoute(pluginId, 'POST', route, internal, user);
      if (result?.success !== true) return error(404);
      const bytes = pdfBytes(result);
      if (!bytes) return error(502);
      if (input.intent === 'view') {
        const page = viewer({ download: url(input.orderId, input.operationId, 'download'), preview: url(input.orderId, input.operationId, 'preview') });
        return new Response(page.html, { headers: { ...PRIVATE, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${page.nonce}'; connect-src 'self'; frame-src 'self'; base-uri 'none'; frame-ancestors 'self'` } });
      }
      return new Response(bytes, { headers: { ...PRIVATE, 'content-type': 'application/pdf', 'content-disposition': `${input.intent === 'download' ? 'attachment' : 'inline'}; filename="shipping-label.pdf"` } });
    } catch { return error(502); }
  }
  return { GET, links, path };
}
