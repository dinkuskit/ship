import basePlugin from './plugin.js';
import { createShipWorkflow, ShipWorkflowError } from './shipping-workflow.js';

const ACTIONS = new Set(['load', 'review', 'quote', 'buy', 'reconcile', 'label', 'pdf', 'print']);
const route = handler => ({ permission: 'plugins:manage', methods: ['POST'], request: { body: 'json', maxBytes: 16384 }, handler });
const rawRoute = handler => ({ ...route(handler), response: 'raw' });
const unavailable = () => { throw new ShipWorkflowError('unavailable', 'Shipping dependencies are unavailable', 503); };
const field = (label, value) => ({ label, value: String(value) });
const inputField = (action_id, label, value = '') => ({ type: 'text_input', action_id, label, initial_value: String(value) });

// Host-owned injection only. This factory does not establish HTTP authorization:
// mount exclusively behind EmDash's authenticated private dispatch/RBAC/CSRF.
export function createShipPlugin({ workflowFactory, authorityPort, browserAssetPort } = {}) {
  async function authorized(routeCtx, ctx) {
    if (!routeCtx?.user || !authorityPort?.authorize || typeof workflowFactory !== 'function') unavailable();
    let auth;
    try { auth = await authorityPort.authorize({ user: routeCtx.user, ui: routeCtx.ui }); }
    catch { throw new ShipWorkflowError('auth_invalid', 'Shipping authorization is invalid', 403); }
    if (!auth || auth.canManage !== true || !auth.shopId || !auth.actorId) {
      throw new ShipWorkflowError('auth_invalid', 'Shipping authorization is invalid', 403);
    }
    const workflow = await workflowFactory(ctx);
    if (!workflow) unavailable();
    return { auth, workflow };
  }

  async function invoke(routeCtx, ctx, action, values) {
    const { auth, workflow } = await authorized(routeCtx, ctx);
    if (!ACTIONS.has(action)) throw new ShipWorkflowError('validation');
    // Explicit projection: no caller, shop, snapshot, price source or provider URL.
    const request = {
      orderId: values?.orderId,
      packageValues: values?.packageValues,
      quoteId: values?.quoteId,
      confirmation: values?.confirmation,
      idempotencyKey: values?.idempotencyKey,
    };
    return workflow[action === 'load' ? 'inspect' : action](auth, request);
  }

  const journey = route(async (routeCtx, ctx) => {
    const values = routeCtx.input;
    const result = await invoke(routeCtx, ctx, values?.action, values);
    // Binary response has its own private raw route; JSON never exposes provider URL.
    if (values.action === 'pdf') return { available: true, bytes: result.length };
    if (result && typeof result === "object") {
      const { pdfUrl, ...privateResult } = result;
      return privateResult;
    }
    return result;
  });

  const labelPdf = {
    ...route(async (routeCtx, ctx) => {
      const bytes = await invoke(routeCtx, ctx, 'pdf', { orderId: routeCtx.input?.orderId });
      return { __emdashPluginResponse: true, status: 200, headers: [
        ['content-type', 'application/pdf'], ['content-disposition', 'attachment; filename="shipping-label.pdf"'],
        ['cache-control', 'private, no-store'], ['x-content-type-options', 'nosniff'],
      ], body: { kind: 'bytes', value: bytes } };
    }),
    response: 'raw',
  };

  const labelStored = rawRoute(async (routeCtx, ctx) => {
    if (typeof browserAssetPort?.links !== 'function' || typeof ctx?.storage?.operations?.getVersioned !== 'function') {
      throw new ShipWorkflowError('unavailable', 'Stored label browser access is unavailable', 503);
    }
    const values = routeCtx?.input;
    const keys = values && typeof values === 'object' && !Array.isArray(values) ? Object.keys(values) : [];
    if (keys.length !== 2 || !keys.includes('orderId') || !keys.includes('operationId') ||
        typeof values.orderId !== 'string' || typeof values.operationId !== 'string') {
      throw new ShipWorkflowError('validation');
    }
    const { auth, workflow } = await authorized(routeCtx, ctx);
    const inspected = await workflow.inspect(auth, { orderId: values.orderId });
    const existingLabel = await workflow.label(auth, { orderId: values.orderId });
    if (existingLabel?.operationId !== values.operationId) {
      throw new ShipWorkflowError('not_found', 'Stored label is unavailable', 404);
    }
    if (inspected?.pdfStatus !== 'stored') {
      throw new ShipWorkflowError('not_found', 'Stored label is unavailable', 404);
    }
    const readOnlyWorkflow = createShipWorkflow({
      store: {
        getOrigin: async () => null,
        getVersioned: key => ctx.storage.operations.getVersioned(key),
        compareAndSet: async () => { throw new Error('read-only'); },
      },
      orderPort: { getPaidOrder: async () => { throw new Error('read-only'); } },
      providerPort: {},
    });
    const ownLabel = await readOnlyWorkflow.label(auth, { orderId: values.orderId });
    if (ownLabel?.operationId !== values.operationId) {
      throw new ShipWorkflowError('not_found', 'Stored label is unavailable', 404);
    }
    const bytes = await readOnlyWorkflow.pdf(auth, { orderId: values.orderId });
    if (!(bytes instanceof Uint8Array)) throw new ShipWorkflowError('pdf_invalid', 'Stored label is invalid', 502);
    const afterRead = await readOnlyWorkflow.label(auth, { orderId: values.orderId });
    if (afterRead?.operationId !== values.operationId) {
      throw new ShipWorkflowError('conflict', 'Stored label changed during read', 409);
    }
    return {
      __emdashPluginResponse: true,
      status: 200,
      headers: [
        ['content-type', 'application/pdf'],
        ['content-disposition', 'inline; filename="shipping-label.pdf"'],
        ['cache-control', 'private, no-store'],
        ['x-content-type-options', 'nosniff'],
      ],
      body: { kind: 'bytes', value: bytes },
    };
  });

  async function admin(routeCtx, ctx) {
    const input = routeCtx?.input || {};
    if (!String(input.action_id || '').startsWith('journey-') && input.page !== '/journey') {
      return basePlugin.routes.admin.handler(routeCtx, ctx);
    }
    const v = input.values || input;
    if (!v.orderId) {
      await authorized(routeCtx, ctx);
      return { blocks: [{ type: 'header', text: 'Shipment review' }, { type: 'form', fields: [inputField('orderId', 'Paid order identifier')], submit: { label: 'Open authorized order', action_id: 'journey-load' } }] };
    }
    const action = String(input.action_id || 'journey-load').slice(8);
    const packageValues = Object.fromEntries(['weightLb', 'lengthIn', 'widthIn', 'heightIn'].map(k => [k, v[k]]));
    let toast;
    try {
      if (action !== 'load') await invoke(routeCtx, ctx, action, {
        orderId: v.orderId, packageValues, quoteId: v.quoteId, idempotencyKey: v.idempotencyKey,
        confirmation: { confirmed: v.confirmed === true || v.confirmed === 'true', service: v.service, amount: v.amount, currency: v.currency },
      });
    } catch (error) {
      toast = { type: 'error', message: error instanceof ShipWorkflowError ? error.message : 'Shipping request could not complete' };
    }
    // Always authorize again, including failed action/reload paths.
    const state = await invoke(routeCtx, ctx, 'load', { orderId: v.orderId });
    const ui = routeCtx.ui || {};
    const ar = String(ui.locale || '').startsWith('ar');
    const quote = state.quote;
    const blocks = [
      { type: 'header', text: ar ? 'مراجعة الشحن' : 'Shipment review' },
      { type: 'context', text: `Host locale: ${ui.locale || 'en'} · Host direction: ${ui.direction || 'ltr'}` },
      { type: 'fields', fields: [field('Order', state.order.orderId), field('Paid total (USD minor units)', state.order.paidTotals.amount), field('Label', state.labelStatus), field('PDF', state.pdfStatus), field('Print', state.printStatus), field('Delivery', 'Not reported')] },
      { type: 'fields', fields: [field('Recipient', state.order.destination.name), field('Destination', [state.order.destination.addressLine1, state.order.destination.addressLine2, state.order.destination.city, state.order.destination.state, state.order.destination.postalCode].filter(Boolean).join(' · '))] },
    ];
    if (state.shipment) blocks.push({ type: 'fields', fields: [field('Ship from', state.shipment.from.addressLines.join(' · ') + ' · ' + state.shipment.from.cityTown)] });
    if (['not_created', 'purchase_failed'].includes(state.labelStatus)) {
      blocks.push({ type: 'form', fields: [inputField('orderId', 'Order', v.orderId), ...['weightLb', 'lengthIn', 'widthIn', 'heightIn'].map(k => inputField(k, k, v[k] ?? state.packageValues?.[k] ?? ''))], submit: { label: ar ? 'عرض سعر الشحن التجريبي' : 'Get sandbox postage quote', action_id: 'journey-quote' } });
      if (quote) blocks.push({ type: 'form', fields: [
        inputField('orderId', 'Order', v.orderId), ...Object.entries(state.packageValues).map(([k, val]) => inputField(k, k, val)),
        inputField('quoteId', 'Quote', quote.quoteId), inputField('service', 'Service', quote.service), inputField('amount', 'Postage price', quote.amount), inputField('currency', 'Currency', quote.currency), inputField('idempotencyKey', 'Purchase request key'),
        { type: 'toggle', action_id: 'confirmed', label: ar ? 'أوافق على شراء ملصق تجريبي بهذا السعر' : 'I confirm this sandbox label purchase at this price', initial_value: false },
      ], submit: { label: ar ? 'شراء ملصق تجريبي' : 'Buy sandbox label', action_id: 'journey-buy' } });
    }
    if (state.labelStatus === 'purchase_unknown') blocks.push({ type: 'banner', title: 'Purchase outcome unknown', description: 'New purchase is blocked. Provider recovery requires an eligible stored reason.', variant: 'alert' });
    if (state.canReconcile) blocks.push({ type: 'form', fields: [inputField('orderId', 'Order', v.orderId)], submit: { label: 'Check original purchase', action_id: 'journey-reconcile' } });
    if (state.labelStatus === 'label_created') {
      blocks.push({ type: 'form', fields: [inputField('orderId', 'Order', v.orderId)], submit: { label: 'Store private PDF', action_id: 'journey-pdf' } });
      blocks.push({ type: 'form', fields: [inputField('orderId', 'Order', v.orderId)], submit: { label: 'Record print request', action_id: 'journey-print' } });
    }
    if (state.labelStatus === 'label_created' && state.pdfStatus === 'stored' && typeof browserAssetPort?.links === 'function') {
      const bound = await authorized(routeCtx, ctx);
      const label = await bound.workflow.label(bound.auth, { orderId: v.orderId });
      const links = await browserAssetPort.links({ orderId: v.orderId, operationId: label.operationId, requestUrl: routeCtx.request?.url });
      if (links) blocks.push({ type: 'actions', elements: [links.view, links.download, links.print] });
    }
    if (state.labelStatus === 'label_created') blocks.push({ type: 'context', text: 'Label created. Private PDF download is available through the host API; browser view/download/print requires an authenticated host asset mediator. Print requests do not confirm physical printing or delivery.' });
    return { blocks, ...(toast ? { toast } : {}) };
  }
  return {
    ...basePlugin,
    routes: { ...basePlugin.routes, admin: route(admin), journey, 'label-pdf': labelPdf, 'label-stored': labelStored },
  };
}
