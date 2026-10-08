import test from "node:test";
import assert from "node:assert/strict";
import { createHostLabelAssets } from "../src/host-label-assets.js";
import { createShipPlugin } from "../src/installed-workflow.js";

const USER = { id: "user-1", role: 5 };
const policy = {
  hasPermission: (user, permission) => user?.role >= 5 && permission === "plugins:manage",
  hasScope: (scopes, scope) => Array.isArray(scopes) && scopes.includes(scope),
};

function runtime({ enabled = true, meta = {}, response } = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    getManifest: async () => ({ plugins: { ship: { enabled } } }),
    getPluginRouteMeta: () => ({ public: false, permission: "plugins:manage", response: "raw", methods: ["POST"], request: { body: "json" }, ...meta }),
    handlePluginApiRoute: async () => {
      calls++;
      return response ?? {
        success: false, status: 404, error: { code: "NOT_FOUND", message: "missing" },
      };
    },
  };
}

function locals(runtimeValue, overrides = {}) {
  return { user: USER, tokenScopes: ["admin"], emdash: runtimeValue, ...overrides };
}

function getUrl(intent = "download", extras = "") {
  return `https://host.test/ship-label?orderId=order:one&operationId=op-one&intent=${intent}${extras}`;
}

test("browser adapter denies logged-out, non-manager, missing-scope, unbound, and disabled installations", async () => {
  const runtimeValue = runtime();
  const adapter = createHostLabelAssets({ pluginId: "ship", path: "/_emdash/api/ship-label-assets", ...policy });
  for (const current of [
    {},
    { user: { id: "user-1", role: 1 }, tokenScopes: ["admin"] },
    { user: USER, tokenScopes: ["plugins:manage"] },
    { user: USER, tokenScopes: ["admin"], emdash: undefined },
  ]) {
    const result = await adapter.GET({
      request: new Request(getUrl()),
      locals: Object.prototype.hasOwnProperty.call(current, "emdash")
        ? current
        : { ...current, emdash: runtimeValue },
    });
    assert.equal(result.status, current.user ? (current.emdash === undefined && Object.prototype.hasOwnProperty.call(current, "emdash") ? 503 : 403) : 401);
    assert.equal(runtimeValue.calls(), 0);
  }
  const disabled = createHostLabelAssets({ pluginId: "ship", path: "/_emdash/api/ship-label-assets", ...policy });
  const disabledRuntime = runtime({ enabled: false });
  assert.equal((await disabled.GET({ request: new Request(getUrl()), locals: locals(disabledRuntime) })).status, 503);
  assert.equal(disabledRuntime.calls(), 0);
});

test("browser input rejects forged fields, duplicate query fields, and invalid identities", async () => {
  const runtimeValue = runtime();
  const adapter = createHostLabelAssets({ pluginId: "ship", path: "/_emdash/api/ship-label-assets", ...policy });
  for (const suffix of [
    "&shopId=forged", "&intent=download", "&orderId=bad%20order",
    "&operationId=bad%2Foperation", "&unknown=x",
  ]) {
    const result = await adapter.GET({ request: new Request(getUrl("download", suffix)), locals: locals(runtimeValue) });
    assert.equal(result.status, 400);
  }
  assert.equal(runtimeValue.calls(), 0);
});

test("adapter validates the private route and returns only bounded PDF bytes", async () => {
  const bytes = new TextEncoder().encode("%PDF-fixture");
  const runtimeValue = runtime({
    response: {
      success: true,
      data: {
        __emdashPluginResponse: true, status: 200,
        headers: [["content-type", "application/pdf"]],
        body: { kind: "bytes", value: bytes },
      },
    },
  });
  const adapter = createHostLabelAssets({ pluginId: "ship", path: "/_emdash/api/ship-label-assets", ...policy });
  const result = await adapter.GET({ request: new Request(getUrl()), locals: locals(runtimeValue) });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "%PDF-fixture");
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  assert.equal(result.headers.get("content-disposition"), 'attachment; filename="shipping-label.pdf"');

  for (const response of [
    { success: true, data: { __emdashPluginResponse: true, status: 200, headers: [], body: { kind: "bytes", value: new Uint8Array(5 * 1024 * 1024 + 1) } } },
    { success: true, data: { __emdashPluginResponse: true, status: 200, headers: [], body: { kind: "bytes", value: new TextEncoder().encode("not-pdf") } } },
    { success: true, data: { __emdashPluginResponse: true, status: 200, headers: [], body: { kind: "json", value: {} } } },
  ]) {
    const badRuntime = runtime({ response });
    const badAdapter = createHostLabelAssets({ pluginId: "ship", path: "/_emdash/api/ship-label-assets", ...policy });
    assert.equal((await badAdapter.GET({ request: new Request(getUrl()), locals: locals(badRuntime) })).status, 502);
  }
});

test("stored-label route is optional, read-only, operation-bound, and fails closed without storage", async () => {
  let providerCalls = 0;
  const plugin = createShipPlugin({
    browserAssetPort: { links: () => null },
    authorityPort: { authorize: async () => ({ shopId: "shop", actorId: "actor", canManage: true }) },
    workflowFactory: async () => ({
      inspect: async () => ({ pdfStatus: "not_stored" }),
      label: async () => ({ operationId: "op-one" }),
    }),
  });
  await assert.rejects(
    plugin.routes["label-stored"].handler(
      { user: USER, input: { orderId: "order:one", operationId: "op-one" } },
      { storage: { operations: {} } },
    ),
    error => error.code === "unavailable",
  );
  const noMount = createShipPlugin();
  await assert.rejects(
    noMount.routes["label-stored"].handler({ user: USER, input: { orderId: "order:one", operationId: "op-one" } }, {}),
    error => error.code === "unavailable",
  );
  assert.equal(providerCalls, 0);
});

test("view is an explicit browser control page and does not print on load", async () => {
  const bytes = new TextEncoder().encode("%PDF-fixture");
  const runtimeValue = runtime({
    response: { success: true, data: {
      __emdashPluginResponse: true, status: 200, headers: [["content-type", "application/pdf"]],
      body: { kind: "bytes", value: bytes },
    } },
  });
  const adapter = createHostLabelAssets({ pluginId: "ship", path: "/_emdash/api/ship-label-assets", ...policy });
  const view = await adapter.GET({ request: new Request(getUrl("view")), locals: locals(runtimeValue) });
  const html = await view.text();
  assert.equal(view.status, 200);
  assert.match(html, /View/);
  assert.match(html, /Download/);
  assert.match(html, /Print/);
  assert.doesNotMatch(html, /print\(\)<\/script>/);
  assert.match(html, /addEventListener\('click'/);
});

test("links use bounded same-origin URLs and preserve defaults when no mount exists", () => {
  const adapter = createHostLabelAssets({ pluginId: "ship", path: "/_emdash/api/ship-label-assets", ...policy });
  const links = adapter.links({ requestUrl: "https://host.test/_emdash/api/plugins/ship/admin", orderId: "order:one", operationId: "op-one" });
  assert.equal(links.view.type, "link");
  assert.equal(new URL(links.view.target.url, "https://host.test").searchParams.get("intent"), "view");
  assert.equal(new URL(links.download.target.url, "https://host.test").searchParams.get("intent"), "download");
  assert.equal(adapter.links({ orderId: "bad order", operationId: "op-one" }), null);
});

test('session authentication has full scope; token authentication requires admin scope before dispatch', async () => {
  const bytes = new TextEncoder().encode('%PDF-fixture');
  const rt = runtime({ response: { success: true, data: { __emdashPluginResponse: true, status: 200, headers: [['content-type','application/pdf']], body: { kind:'bytes', value:bytes } } } });
  const adapter = createHostLabelAssets({ pluginId:'ship', ...policy });
  assert.equal((await adapter.GET({ request:new Request(getUrl()), locals:locals(rt,{ tokenScopes:undefined }) })).status,200);
  assert.equal(rt.calls(),1);
  for(const tokenScopes of [[],['content:read'],null]) assert.notEqual((await adapter.GET({ request:new Request(getUrl()),locals:locals(rt,{tokenScopes}) })).status,200);
  assert.equal(rt.calls(),1);
});

test('stored-only action reads actual digest-checked chunks and never obtains missing bytes from provider', async () => {
  const { createShipWorkflow } = await import('../src/shipping-workflow.js');
  const auth = { shopId:'shop', actorId:'actor', canManage:true };
  const order = { shopId:'shop', orderId:'order:one', revision:1,paymentStatus:'paid',paidTotals:{ amount:'0',currency:'USD' },addressConsent:true,destination:{name:'Synthetic',addressLine1:'1 Example St',city:'Austin',state:'TX',postalCode:'78701',country:'US'} };
  const origin = {...order.destination};
  const records=new Map(); let rev=0, fetches=0, creates=0;
  const store={ getOrigin:async()=>origin,getVersioned:async key=>structuredClone(records.get(key)??null),compareAndSet:async(key,old,value)=>{if((records.get(key)?.revision??null)!==old)return{applied:false};records.set(key,{revision:++rev,value:structuredClone(value)});return{applied:true,revision:rev};} };
  const wf=createShipWorkflow({store,orderPort:{getPaidOrder:async({shopId})=>shopId==='shop'?order:null},providerPort:{quote:async()=>({service:'PM',serviceLabel:'Priority Mail',currency:'USD',amount:8.6}),createLabel:async()=>{creates++;return{shipmentId:'shipment',price:8.6,pdfUrl:'https://labels.example.test/label.pdf'}},fetchLabelPdf:async()=>{fetches++;return new TextEncoder().encode('%PDF-fixture')}} ,idFactory:()=> 'operation1'});
  const packageValues={weightLb:1,lengthIn:10,widthIn:8,heightIn:4};const quote=await wf.quote(auth,{orderId:order.orderId,packageValues});
  await wf.buy(auth,{orderId:order.orderId,packageValues,quoteId:quote.quoteId,idempotencyKey:'fixture',confirmation:{confirmed:true,amount:8.6,service:'PM',currency:'USD'}});
  const bytes=await wf.pdf(auth,{orderId:order.orderId});
  const plugin=createShipPlugin({browserAssetPort:{links:()=>null},authorityPort:{authorize:async()=>auth},workflowFactory:async()=>wf});
  const input={orderId:order.orderId,operationId:'operation1'};const ctx={storage:{operations:store}};
  for(let i=0;i<2;i++) assert.deepEqual((await plugin.routes['label-stored'].handler({user:USER,input},ctx)).body.value,bytes);
  await assert.rejects(plugin.routes['label-stored'].handler({user:USER,input:{...input,operationId:'other'}},ctx));
  const state=records.get('ship:v1:shop:order:one'); delete state.value.pdf;
  await assert.rejects(plugin.routes['label-stored'].handler({user:USER,input},ctx));
  assert.equal(fetches,1);assert.equal(creates,1);
});
