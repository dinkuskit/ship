// Authority-chain run for Finish setup, uninstall and Disconnect.
//
// The installed Ship plugin entry points (the Shipments admin route, the store-proof
// route and the plugin:uninstall hook from src/plugin.ts) run against DinkusKit.com's
// own built Worker from dinkuskit/dinkuskit (the branch of dinkuskit/dinkuskit#145),
// started under that repository's merchant test harness with local D1 and KV.
// Nothing here is a fake of DinkusKit.com: lookup, finish, token, store passes, the
// connected-to read, key cancel, Approve and Disconnect are its real routes.
//
// Three things stand in for the parts that are not on this machine:
//  1. Transport: the plugin's https://dinkuskit.com requests go to the local Worker,
//     and that Worker's own address is written back as https://dinkuskit.com in
//     replies, so the plugin's exact address checks still run.
//  2. The store's address: DinkusKit.com reads a store's proof receipt from the
//     plugin's store-proof route at that address. Here the bridge asks the
//     installation that really owns the address (its real store-proof route) and
//     hands the answer to the Worker's proof-receipt simulation. An installation
//     claiming someone else's address gets nothing from the real owner's route.
//  3. Hosted Ship's order list: a stand-in that answers only after verifying the
//     ship:admin pass with DinkusKit.com's published keys.
//
// Run from this repository:
//   DINKUSKIT_DIR=/path/to/dinkuskit (built with `npm run build`) \
//   SHIP_BASE_DIR=/path/to/a/checkout/of/main \
//   node --import tsx proof/finish-setup-20261122/authority-chain.mjs > trace.md
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const DK = process.env.DINKUSKIT_DIR;
const BASE = process.env.SHIP_BASE_DIR;
if (!DK) throw new Error('Set DINKUSKIT_DIR to a built dinkuskit/dinkuskit checkout.');
const current = (await import(new URL('../../src/plugin.ts', import.meta.url).href)).default;
const harness = await import(pathToFileURL(`${DK}/tests/helpers/merchant-harness.mjs`).href);
process.chdir(DK);

const PROD = 'https://dinkuskit.com';
const SHIP = 'https://ship.dinkuskit.com';
const PLUGIN_ID = 'r_ehdlg5cxkb3ffqvr';
const lines = [];
const say = text => { lines.push(text); };
let runtime;
const redact = value => String(value)
  .replaceAll(runtime?.origin ?? '\u0000', PROD)
  .replace(/dk_store_[A-Za-z0-9_-]{43}/g, 'dk_store_[redacted]')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[pass redacted]');
const check = (label, ok, seen) => { say(`- ${ok ? 'PASS' : 'FAIL'}: ${label}${seen === undefined ? '' : ` (${redact(typeof seen === 'string' ? seen : JSON.stringify(seen))})`}`); assert.ok(ok, label); };

function memory() {
  const values = new Map(); let revision = 0;
  const access = prefix => ({
    async get(key) { return values.get(prefix + key)?.value ?? null; },
    async getVersioned(key) { return values.get(prefix + key) ?? null; },
    async set(key, value) { values.set(prefix + key, { value: structuredClone(value), revision: String(++revision) }); },
    async delete(key) { return values.delete(prefix + key); },
    async compareAndSet(key, expected, value) {
      if ((values.get(prefix + key)?.revision ?? null) !== expected) return { applied: false };
      values.set(prefix + key, { value: structuredClone(value), revision: String(++revision) }); return { applied: true };
    },
  });
  return { kv: access('kv:'), settings: access('settings:'), values };
}

// Which installation really answers at each store address.
const owners = new Map();
async function bridgeReceipt(connectionId, siteOrigin) {
  const owner = owners.get(siteOrigin);
  if (!owner) return false;
  const answer = await owner.proof(connectionId);
  if (answer.status !== 200) return false;
  const posted = await harness.request(runtime, new Map(), '/__proof/receipt', { method: 'POST', body: answer.body.value });
  return posted.status === 200;
}

let jwks;
async function shipStandIn(url, init) {
  const auth = new Headers(init.headers).get('authorization') ?? '';
  try {
    const { payload } = await jwtVerify(auth.replace(/^Bearer /, ''), jwks, { issuer: `${PROD}/account`, audience: 'dinkus-ship' });
    if (!String(payload.scope).split(' ').includes('ship:admin')) throw new Error('scope');
    if (new URL(url).pathname !== '/v1/admin/orders') return Response.json({ error: { code: 'NOT_FOUND', message: 'Not here.' } }, { status: 404 });
    return Response.json({ orders: [], settings: { shipFrom: true, boxes: [{ boxId: 'box_small', name: 'Small', lengthIn: 8, widthIn: 6, heightIn: 4, weightOz: 3 }], postageConnected: true, testSandbox: true }, open: null });
  } catch { return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Pass refused.' } }, { status: 401 }); }
}

function transport(install) {
  return { async fetch(url, init = {}) {
    if (url.startsWith(`${SHIP}/`)) return shipStandIn(url, init);
    assert.ok(url.startsWith(`${PROD}/`), `unexpected address ${url}`);
    const path = url.slice(PROD.length);
    if (path === '/api/store-connections/finish') install.bridged = await bridgeReceipt(JSON.parse(init.body).connection_id, install.origin);
    const { redirect: _redirect, cache: _cache, ...rest } = init;
    const response = await fetch(new URL(path, runtime.origin), { ...rest, redirect: 'manual' });
    const text = (await response.text()).replaceAll(runtime.origin, PROD);
    return new Response(response.status === 204 ? null : text, { status: response.status, headers: response.headers });
  } };
}

const ADMIN = 50, EDITOR = 40;
// One installed copy of the plugin at a store address, with its own storage.
function install(origin, { plugin = current, store = memory(), servesAddress = true } = {}) {
  const self = { origin, store, plugin };
  const log = { error() {}, info() {}, warn() {}, debug() {} };
  const ctx = () => ({ kv: store.kv, settings: store.settings, http: transport(self), site: { url: origin, name: 'Shop', locale: 'en' },
    plugin: { id: PLUGIN_ID, version: 'proof' }, log });
  self.page = async (input, role = ADMIN) => screen(await plugin.routes.admin.handler({ input,
    ui: { surface: 'admin-page', locale: 'en', direction: 'ltr' }, user: { id: `u${role}`, email: `staff${role}@example.test`, name: 'Staff', role, createdAt: '' },
    request: { url: `${origin}/_emdash/api/plugins/${PLUGIN_ID}/admin`, method: 'POST', headers: {} } }, ctx()));
  self.proof = connectionId => plugin.routes['store-proof'].handler({ input: { connection_id: connectionId } }, ctx());
  self.uninstall = () => plugin.hooks['plugin:uninstall']({}, ctx());
  self.key = async () => { const raw = await store.settings.get('connection'); return raw ? JSON.parse(raw).storeKey : undefined; };
  if (servesAddress) owners.set(origin, self);
  return self;
}

function screen(result) {
  const texts = [], buttons = [];
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button') buttons.push(node.label);
    else for (const field of ['text', 'title', 'description']) if (typeof node[field] === 'string') texts.push(node[field]);
    for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value);
  };
  walk(result);
  const link = JSON.stringify(result).match(/connection_id=([A-Za-z0-9_-]+)/)?.[1];
  return { text: texts.join(' | '), buttons, link };
}
const load = { type: 'page_load', page: '/shipping' };
const press = action_id => ({ type: 'block_action', action_id });
const onList = page => page.buttons.includes('Refresh');
const banner = page => page.text.split(' | ').slice(1, 3).join(' | ');

try {
  runtime = await harness.startMerchantTestRuntime();
  jwks = createRemoteJWKSet(new URL('/account/.well-known/jwks.json', runtime.origin));
  const owner = new Map(), outsider = new Map();
  await harness.signup(runtime, 'acme-owner@example.test', owner);
  await harness.signup(runtime, 'other-owner@example.test', outsider);
  const form = async (jar, fields) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: await harness.accountForm(runtime, jar, new URLSearchParams(fields).toString()) });
  assert.equal((await harness.request(runtime, owner, '/api/account/organizations', await form(owner, { action: 'rename', name: 'Acme Goods' }))).status, 303);
  assert.equal((await harness.request(runtime, outsider, '/api/account/organizations', await form(outsider, { action: 'rename', name: 'Other Shop' }))).status, 303);
  const approveLink = async (jar, connectionId, origin) => {
    await bridgeReceipt(connectionId, origin);
    return harness.request(runtime, jar, `/account/connect?connection_id=${connectionId}`, await form(jar, { action: 'approve' }));
  };
  const trade = async (key, siteId, scope, audience) => {
    const r = await harness.request(runtime, new Map(), '/api/store-passes', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ site_id: siteId, scope, audience }) });
    return r.status === 200 ? 200 : (await r.json()).error;
  };
  async function connectCommerce(origin, jar) {
    const verifier = randomBytes(32).toString('base64url'); const challenge = createHash('sha256').update(verifier).digest('base64url');
    const callback = `${origin}/_emdash/admin/plugins/r_gshdrqaldna3r7sn/settings`;
    const started = await (await harness.request(runtime, new Map(), '/api/store-connections', { method: 'POST', body: JSON.stringify({ protocol_version: 2,
      client_id: 'dinkus-commerce-emdash', service: 'commerce', site_origin: origin, callback_uri: callback, code_challenge: challenge, code_challenge_method: 'S256' }) })).json();
    await harness.request(runtime, new Map(), '/__proof/receipt', { method: 'POST', body: JSON.stringify({ version: 2, connection_id: started.connection_id,
      challenge: started.challenge, client_id: 'dinkus-commerce-emdash', service: 'commerce', site_id: started.site_id, site_origin: origin, callback_uri: callback,
      code_challenge: challenge, expires_at: started.expires_at }) });
    await harness.request(runtime, jar, `/account/connect?connection_id=${started.connection_id}`, await form(jar, { action: 'approve' }));
    const token = await (await harness.request(runtime, new Map(), '/api/store-connections/token', { method: 'POST',
      body: JSON.stringify({ client_id: 'dinkus-commerce-emdash', connection_id: started.connection_id, code_verifier: verifier }) })).json();
    return { siteId: token.site_id, key: token.store_key };
  }

  const ACME = 'https://acme-goods.example', OTHER = 'https://other-shop.example';
  say('# Finish setup authority chain: Ship plugin against DinkusKit.com');
  say('');
  const rev = dir => execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  say(`Run ${new Date().toISOString().slice(0, 10)}. Ship plugin: this branch at ${rev(new URL('../..', import.meta.url).pathname)}. DinkusKit.com: built Worker from dinkuskit/dinkuskit#145 at ${rev(DK)}, local D1 and KV.` +
    (BASE ? ` Released plugin for the upgrade check: main at ${rev(BASE)}.` : '') + ' Keys and passes are redacted.');
  say('');
  say('## 1. An Administrator joins a store its business already connected with Finish setup');
  const commerce = await connectCommerce(ACME, owner);
  const other = await connectCommerce(OTHER, outsider);
  check('before Ship connects, Ship is off for the store (Commerce cannot send it orders)', await trade(commerce.key, commerce.siteId, 'ship:orders', 'dinkus-ship') === 'service_not_enabled');
  const acme = install(ACME);
  let page = await acme.page(load, EDITOR);
  check('an Editor sees Finish setup is needed but gets no button', /Almost ready/.test(page.text) && !page.buttons.includes('Finish setup'), page.buttons);
  page = await acme.page(press('finish_setup'), EDITOR);
  check('an Editor pressing Finish setup anyway (a forged press) makes no key', !(await acme.key()) && acme.bridged === undefined, page.buttons);
  page = await acme.page(load);
  check('an Administrator sees the Finish setup button, not Connect', page.buttons.includes('Finish setup') && !page.buttons.includes('Connect'), page.buttons);
  page = await acme.page(press('finish_setup'));
  const acmeKey = await acme.key();
  check('pressing it shows the Shipments list straight away', onList(page), page.buttons);
  check('Ship saved its own key, different from Commerce\'s', /^dk_store_/.test(acmeKey ?? '') && acmeKey !== commerce.key, acmeKey);
  check('DinkusKit.com read the receipt from the store\'s own proof route', acme.bridged === true);
  check('Ship is now on: Commerce can send it orders', await trade(commerce.key, commerce.siteId, 'ship:orders', 'dinkus-ship') === 200);
  check('the list names the business and the plugins on the store', /Connected to Acme Goods on DinkusKit\. DinkusKit plugins on this store: Commerce and Ship\./.test(page.text),
    page.text.match(/Connected to [^|]*/)?.[0]);
  const mail = await (await harness.request(runtime, new Map(), '/__proof/notice/take', { method: 'POST', body: JSON.stringify({ email: 'acme-owner@example.test' }) })).json();
  check('the owner got the "joined your store" email', mail.length === 1 && mail[0].subject === 'Dinkus Ship joined your store on DinkusKit', mail.map(m => m.subject));

  say('');
  say('## 2. Another business, or another address, gets nothing');
  const impostor = install(ACME, { servesAddress: false });
  page = await impostor.page(press('finish_setup'));
  check('an installation claiming Acme\'s address, but not answering there, gets no key', !(await impostor.key()) && impostor.bridged === false && !onList(page), banner(page));
  const otherShop = install(OTHER);
  page = await otherShop.page(press('finish_setup'));
  check('Ship on Other Shop joins Other Shop\'s own business', /Connected to Other Shop on DinkusKit/.test(page.text), page.text.match(/Connected to [^|]*/)?.[0]);
  const otherKey = await otherShop.key();
  check('Acme\'s Ship key cannot trade passes for Other Shop', await trade(acmeKey, other.siteId, 'ship:admin', 'dinkus-ship') === 'site_mismatch');
  check('Other Shop\'s key cannot read Acme\'s connection', await trade(otherKey, commerce.siteId, 'store:connection', 'dinkuskit') === 'site_mismatch');
  const stranger = install('https://never-connected.example');
  page = await stranger.page(load);
  check('a store no business connected shows Connect, not Finish setup', page.buttons.includes('Connect') && !page.buttons.includes('Finish setup'), page.buttons);
  page = await stranger.page(press('finish_setup'));
  check('pressing Finish setup there anyway asks for Commerce first and saves nothing', !(await stranger.key()) && /Commerce first/.test(page.text), banner(page));

  say('');
  say('## 3. Uninstall cancels only Ship\'s key');
  await acme.uninstall();
  check('Ship\'s key no longer trades any pass', await trade(acmeKey, commerce.siteId, 'ship:admin', 'dinkus-ship') === 'invalid_store_key');
  check('nor reads the connected-to details', await trade(acmeKey, commerce.siteId, 'store:connection', 'dinkuskit') === 'invalid_store_key');
  check('Commerce\'s key still works, and Ship stays on for its orders', await trade(commerce.key, commerce.siteId, 'ship:orders', 'dinkus-ship') === 200);
  check('Other Shop\'s Ship key still works', await trade(otherKey, other.siteId, 'ship:admin', 'dinkus-ship') === 200);
  const again = install(ACME);
  page = await again.page(load);
  check('a reinstall shows Finish setup again (an uninstall is not a Disconnect)', page.buttons.includes('Finish setup'), page.buttons);
  page = await again.page(press('finish_setup'));
  const secondKey = await again.key();
  check('and joins with a new key', onList(page) && /^dk_store_/.test(secondKey ?? '') && secondKey !== acmeKey);

  say('');
  say('## 4. After the owner\'s Disconnect, only the owner\'s Approve brings Ship back');
  assert.equal((await harness.request(runtime, owner, '/account/sites', await form(owner, { action: 'disconnect_plugin', site_id: commerce.siteId, plugin: 'ship' }))).status, 303);
  check('Disconnect ended the key and turned Ship off', await trade(secondKey, commerce.siteId, 'ship:admin', 'dinkus-ship') === 'invalid_store_key' &&
    await trade(commerce.key, commerce.siteId, 'ship:orders', 'dinkus-ship') === 'service_not_enabled');
  // The plugin reuses a traded ship:admin pass for at most a minute (ship-pass-reuse-001); this stands in for that minute passing.
  await again.store.kv.delete(`cache:pass:${commerce.siteId}`);
  page = await again.page(load);
  check('once its kept pass ages out, the installed plugin says to connect again', page.buttons.includes('Connect again') && !onList(page), banner(page));
  const back = install(ACME);
  page = await back.page(load);
  check('a fresh page shows Connect, not Finish setup', page.buttons.includes('Connect') && !page.buttons.includes('Finish setup'), page.buttons);
  page = await back.page(press('finish_setup'));
  check('a Finish setup press (an old page) gets the owner\'s Approve link, and no key', !!page.link && !(await back.key()), page.buttons);
  const link = page.link;
  const outsiderTry = await approveLink(outsider, link, ACME);
  page = await back.page(press('check'));
  check('another business\'s owner cannot approve it: Check still waits, no key', !!page.link && !(await back.key()), `${outsiderTry.status} ${outsiderTry.headers.get('location') ?? ''}`.trim());
  const approved = await approveLink(owner, link, ACME);
  check('the owner\'s Approve sends them back to the Shipments page', approved.headers.get('location') === `${ACME}/_emdash/admin/plugins/${PLUGIN_ID}/shipping`, approved.headers.get('location'));
  page = await back.page(press('check'));
  check('Check then connects with a key and Ship is on again', onList(page) && /^dk_store_/.test(await back.key() ?? '') &&
    await trade(commerce.key, commerce.siteId, 'ship:orders', 'dinkus-ship') === 200, page.buttons);

  if (BASE) {
    say('');
    say('## 5. Upgrade: a store connected with the released plugin keeps working');
    const released = (await import(pathToFileURL(`${BASE}/src/plugin.ts`).href)).default;
    const upgrade = await connectCommerce('https://upgrade-shop.example', owner);
    const store = memory();
    const old = install('https://upgrade-shop.example', { plugin: released, store });
    page = await old.page(press('connect'));
    assert.ok(page.link, 'the released plugin connects with Approve');
    await approveLink(owner, page.link, 'https://upgrade-shop.example');
    page = await old.page(press('check'));
    const oldKey = await old.key();
    check('the released plugin (main) connected with the owner\'s Approve', /^dk_store_/.test(oldKey ?? '') && onList(page), page.buttons);
    const upgraded = install('https://upgrade-shop.example', { store });
    page = await upgraded.page(load);
    check('after the upgrade the same storage loads the Shipments list with the same key', onList(page) && await upgraded.key() === oldKey, page.buttons);
    check('the upgraded page shows the connected-to line and no Finish setup', /Connected to Acme Goods on DinkusKit/.test(page.text) && !page.buttons.includes('Finish setup'));
    await upgraded.uninstall();
    check('uninstalling the upgraded plugin cancels the key the released plugin saved', await trade(oldKey, upgrade.siteId, 'ship:admin', 'dinkus-ship') === 'invalid_store_key');
    check('and leaves that store\'s Commerce key working', await trade(upgrade.key, upgrade.siteId, 'commerce:settings', 'dinkuskit') === 200);
  }
  say('');
  say('All checks passed.');
} finally {
  if (runtime) await harness.stopRuntime(runtime);
  process.stdout.write(`${lines.join('\n')}\n`);
}
