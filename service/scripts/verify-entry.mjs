import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

// Test the actual deployment bundle, without Vitest's export wrapper.
for (const isolated of [false, true]) {
  const scriptPath = new URL(isolated ? '../dist-sandbox/entry.js' : '../dist/entry.js', import.meta.url).pathname;
  const site = 'fixture-site', generation = 'fixture-generation', issuer = 'https://issuer.example.test';
  const keys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture', alg: 'ES256', use: 'sig' };
  const tuple = { recipient: 'ship-sandbox', generation, mode: 'test' };
  let jwks = 0, otherOutbound = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: isolated ? 'ship-isolated-entry-proof' : 'ship-legacy-entry-proof', modules: true, scriptPath,
    compatibilityDate: '2026-09-29', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    durableObjects: { SHIP_STORES: { className: 'StoreShipping', useSQLite: true, unsafeUniqueKey: `fixture-${isolated}` } },
    bindings: {
      ACCOUNT_ISSUER: issuer, ACCOUNT_AUDIENCE: isolated ? 'dinkus-ship-sandbox' : 'dinkus-ship', ACCOUNT_JWKS_URL: issuer + '/jwks',
      ACCOUNT_SIGNIN_URL: issuer + '/sign-in', ACCOUNT_TOKEN_URL: issuer + '/token', PB_ENVIRONMENT: 'sandbox',
      ...(isolated ? { SHIP_RECIPIENT: tuple.recipient, SHIP_GENERATION: generation, SHIP_SITE_ID: site, SHIP_ALLOWED_ORDER_ID: 'fixture-fresh', SHIP_EXCLUDED_ORDER_ID: 'fixture-historical' } : {}),
    },
    outboundService: request => {
      if (request.url === issuer + '/jwks') { jwks++; return Response.json({ keys: [jwk] }); }
      otherOutbound++; return new Response('blocked synthetic proof network', { status: 503 });
    },
  }] }));
  try {
    const origin = isolated ? 'https://ship.sm0ky.dev' : 'https://ship.dinkuskit.com';
    assert.equal((await mf.dispatchFetch(origin + '/')).status, 200);
    const token = await new SignJWT({ site_id: site, scope: 'ship:orders', ...(isolated ? { ship_recipient: tuple.recipient, ship_generation: generation, ship_mode: 'test' } : {}) })
      .setProtectedHeader({ alg: 'ES256', kid: 'fixture' }).setIssuer(issuer).setAudience(isolated ? 'dinkus-ship-sandbox' : 'dinkus-ship')
      .setSubject('fixture-business').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(isolated ? { 'X-Ship-Recipient': tuple.recipient, 'X-Ship-Generation': generation, 'X-Ship-Mode': 'test' } : {}) };
    const body = { schema: 'dinkuskit.commerce.ship-order/v1', orderId: 'fixture-fresh', number: 1002, version: 1, status: 'processing', test: true,
      shipTo: { name: 'Fixture', line1: '1 Test Way', city: 'Example', region: 'CA', postalCode: '90000', country: 'US' }, email: null, completed: null,
      lines: [{ catalogItemId: 'item', name: 'Fixture', quantity: 1, weightOz: 8 }] };
    const intake = await mf.dispatchFetch(origin + '/v1/orders', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(intake.status, 200);
    assert.deepEqual(await intake.json(), { orderId: body.orderId, version: 1, ...(isolated ? tuple : {}) });
    const list = await mf.dispatchFetch(origin + '/v1/labels', { headers });
    assert.equal(list.status, 200); assert.deepEqual(await list.json(), []);
    if (isolated) {
      const namespace = await mf.getDurableObjectNamespace('SHIP_STORES');
      const store = namespace.get(namespace.idFromName(site));
      assert.equal((await store.saveShipFrom({ name: 'Fixture', line1: '1 Test Way', city: 'Example', region: 'CA', postalCode: '90000' })).ok, true);
      assert.equal((await store.addBox({ name: 'Fixture box', lengthIn: '6', widthIn: '4', heightIn: '3', weightOz: '1' })).ok, true);
      const settings = await store.getSettings();
      const bought = await store.buyLabel({ orderId: body.orderId, uid: 'fixture-owner', fields: { version: '1', service: 'PM', weightOz: '9', boxId: settings.boxes[0].boxId, kind: 'practice' } });
      assert.equal(bought.ok, true);
      const events = await (await mf.dispatchFetch(origin + '/v1/labels', { headers })).json();
      assert.equal(events.length, 1); assert.equal(events[0].orderId, body.orderId);
      for (const [key, value] of Object.entries(tuple)) assert.equal(events[0][key], value);
      const ack = await mf.dispatchFetch(origin + '/v1/labels/ack', { method: 'POST', headers, body: JSON.stringify({ eventId: events[0].eventId }) });
      assert.equal(ack.status, 200); assert.deepEqual(await ack.json(), { eventId: events[0].eventId, ...tuple });
      assert.deepEqual(await (await mf.dispatchFetch(origin + '/v1/labels', { headers })).json(), []);
    }
    if (isolated) for (const denied of [{ ...body, orderId: 'fixture-historical', number: 1001 }, { ...body, test: false }]) {
      assert.equal((await mf.dispatchFetch(origin + '/v1/orders', { method: 'POST', headers, body: JSON.stringify(denied) })).status, 403);
    }
    assert.equal(jwks, 1); assert.equal(otherOutbound, 0);
    console.log(JSON.stringify({ deploymentEntry: isolated ? 'sandbox' : 'legacy', rawBundleStartup: 'passed', sqliteIntake: 'passed', receipt: 'matched', outboundExceptJwks: 0 }));
  } finally { await mf.dispose(); }
}
