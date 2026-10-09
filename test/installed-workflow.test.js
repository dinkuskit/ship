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
  assert.equal(raw.body.kind, 'bytes');
  assert.ok(raw.body.value instanceof Uint8Array);
  for (const name of ['admin', 'journey', 'label-pdf']) {
    assert.equal(plugin.routes[name].permission, 'plugins:manage');
    assert.equal(plugin.routes[name].public, undefined);
    assert.deepEqual(plugin.routes[name].methods, ['POST']);
  }
  assert.equal(plugin.routes['label-pdf'].response, 'raw');
});

test('trusted provider PDF mode derives one link from the authorized stored label only', async () => {
  const pdfUrl = 'https://stg-labels-cls.gcs.pitneybowes.com/usps/fixture/outbound/label/fixture.pdf';
  let labels = 0;
  const workflow = {
    inspect: async () => ({ order: { orderId: 'order-1', paidTotals: { amount: '100', currency: 'USD' }, destination: { name: 'Recipient', addressLine1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701' } }, labelStatus: 'label_created', pdfStatus: 'not_stored' }),
    label: async (auth, input) => {
      assert.deepEqual(auth, { shopId: 'shop-1', actorId: 'actor-1', canManage: true });
      assert.equal(input.orderId, 'order-1');
      labels += 1;
      return { status: 'label_created', operationId: 'operation-1', createdAt: 1000, pdfUrl };
    },
  };
  const plugin = createShipPlugin({
    authorityPort: { authorize: async () => ({ shopId: 'shop-1', actorId: 'actor-1', canManage: true }) },
    workflowFactory: async () => workflow,
    providerPdfLink: {
      mode: 'trusted',
      port: {
        links: async ({ operation }) => ({
          view: { type: 'link', label: 'View label', target: { kind: 'external', url: operation.pdfUrl } },
        }),
      },
    },
  });
  const response = await plugin.routes.admin.handler({
    user: { id: 'actor-1' },
    input: { page: '/journey', values: { orderId: 'order-1' } },
  }, {});
  assert.deepEqual(response.blocks.find(block => block.type === "actions"), {
    type: 'actions',
    elements: [{ type: 'link', label: 'View label', target: { kind: 'external', url: pdfUrl } }],
  });
  assert.equal(labels, 1);
});
