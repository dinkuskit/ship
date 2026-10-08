import test from 'node:test';
import assert from 'node:assert/strict';
import { createShipPlugin } from '../src/installed-workflow.js';

test('absent ports/default user deny all workflow actions before body can supply authority', async () => {
  const plugin = createShipPlugin();
  for (const action of ['load', 'review', 'quote', 'buy', 'reconcile', 'label', 'pdf', 'print']) {
    await assert.rejects(plugin.routes.journey.handler({ input: { action, user: { id: 'forged' }, shopId: 'forged' } }, {}), e => e.code === 'unavailable');
  }
});

test('host-only actor projection and private PDF wire preserve dispatch policy', async () => {
  let observed;
  const plugin = createShipPlugin({ authorityPort: { authorize: async value => { observed = value; return { shopId: 'host-shop', actorId: 'host-actor', canManage: true }; } }, workflowFactory: async () => ({
    label: async (auth, input) => { assert.equal(auth.shopId, 'host-shop'); assert.equal(input.shopId, undefined); return { shipmentId: 'label', pdfUrl: 'secret-url' }; },
    pdf: async () => new TextEncoder().encode('%PDF-fixture'),
  }) });
  const routeCtx = { user: { id: 'real' }, ui: { locale: 'ar', direction: 'rtl' }, input: { action: 'label', orderId: 'order', shopId: 'fake', actorId: 'fake', snapshot: {} } };
  assert.deepEqual(await plugin.routes.journey.handler(routeCtx, {}), { shipmentId: 'label' });
  assert.deepEqual(Object.keys(observed).sort(), ['ui', 'user']);
  const raw = await plugin.routes['label-pdf'].handler(routeCtx, {});
  assert.equal(raw.__emdashPluginResponse, true);
  assert.ok(raw.body instanceof Uint8Array);
  for (const name of ['admin', 'journey', 'label-pdf']) {
    assert.equal(plugin.routes[name].permission, 'plugins:manage');
    assert.equal(plugin.routes[name].public, undefined);
    assert.deepEqual(plugin.routes[name].methods, ['POST']);
  }
  assert.equal(plugin.routes['label-pdf'].response, 'raw');
});
