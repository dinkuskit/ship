import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxAdapter } from '../../src/pb-sandbox.js';
const credentials = { apiKey:'fake-key', apiSecret:'fake-secret', shipperId:'fake-shipper' };
const shipment = { from:{ name:'Fixture Sender', addressLines:['1 Example Street'], postalCode:'10001' }, to:{ name:'Fixture Recipient', addressLines:['2 Example Street'], postalCode:'10002' }, parcel:{weightOz:1.5,lengthIn:8,widthIn:6,heightIn:1} };
const pdfUrl='https://stg-labels-cls.gcs.pitneybowes.com/usps/1/outbound/label/fake.pdf';
const auth=()=>new Response(JSON.stringify({access_token:'fake-token',tokenType:'BearerToken',expiresIn:600}));
const label=()=>({shipmentId:'known',rates:[{carrier:'USPS',serviceId:'PM',parcelType:'PKG',totalCarrierCharge:8.6,currencyCode:'USD'}],documents:[{contentType:'URL',fileFormat:'PDF',contents:pdfUrl}]});
function adapterWith(response, overrides={}) { return createSandboxAdapter({credentials,fetchImpl:async(url,options)=>url.endsWith('/oauth/token')?auth():response(url,options),...overrides}); }

test('all post-dispatch HTTP errors remain unknown without automatic reissue',async()=>{
 for(const status of [400,401,403,409,429,500,502]){
  let creates=0;
  const adapter=adapterWith(()=>{creates++;return new Response(JSON.stringify({errors:[{errorCode:'fixture-error',errorDescription:'fake-private-provider-payload'}]}),{status});});
  await assert.rejects(adapter.createLabel(shipment,'op'),e=>e.purchaseOutcome==='unknown' && (status!==500 || e.recoveryReason==='http_500') && !JSON.stringify(e).includes('fake-private-provider-payload'));
  assert.equal(creates,1);
 }
});
test('invalid request preparation is not started and never authenticates',async()=>{
 let calls=0; const adapter=createSandboxAdapter({credentials,fetchImpl:async()=>{calls++;return auth();}});
 await assert.rejects(adapter.createLabel({},'valid_op'),e=>e.purchaseOutcome==='not_started');
 assert.equal(calls,0);
 await assert.rejects(adapter.createLabel(shipment,123),e=>e.purchaseOutcome==='not_started');
 assert.equal(calls,0);
});
test('reconcile requires the exact PB transaction ID syntax and does not dispatch invalid input',async()=>{
 let calls=0; const adapter=createSandboxAdapter({credentials,clock:()=>100000,fetchImpl:async()=>{calls++;return auth();}});
 for(const id of ['bad/id','x'.repeat(26),123]) await assert.rejects(adapter.reconcileLabel(id,{reason:'no_response',createdAt:100000}),e=>e.code==='validation');
 assert.equal(calls,0);
});
test('known-label retrieval rejects mismatched identity and dot path segments',async()=>{
 const adapter=adapterWith(()=>new Response(JSON.stringify({...label(),shipmentId:'other'})));
 await assert.rejects(adapter.retrieveLabel('known'),e=>e.code==='provider_malformed');
 for(const id of ['.','..']) await assert.rejects(adapter.retrieveLabel(id),e=>e.code==='validation');
});
test('PDF documents require explicit URL and PDF markers',async()=>{
 for(const field of ['contentType','fileFormat']){
  const body=label(); delete body.documents[0][field];
  await assert.rejects(adapterWith(()=>new Response(JSON.stringify(body))).createLabel(shipment,'op'),e=>e.purchaseOutcome==='unknown');
 }
});
test('OAuth invalid token types cannot be used or cached',async()=>{
 let calls=0;
 const adapter=createSandboxAdapter({credentials,fetchImpl:async(url)=>{calls++;if(url.endsWith('/oauth/token'))return new Response(JSON.stringify({access_token:'fake-token',tokenType:'unexpected',expiresIn:600}));return new Response(JSON.stringify(label()));}});
 for(let i=0;i<2;i++)await assert.rejects(adapter.createLabel(shipment,'op'),e=>e.purchaseOutcome==='not_started');
 assert.equal(calls,2);
});
test('response redirects and malformed success remain unknown',async()=>{
 for(const response of [()=>new Response('',{status:302,headers:{location:'https://production.invalid'}}),()=>new Response('bad-json'),()=>new Response(JSON.stringify({...label(),documents:[]}))]){
  await assert.rejects(adapterWith(response).createLabel(shipment,'op'),e=>e.purchaseOutcome==='unknown' && e.recoveryReason===undefined);
 }
});
test('JSON and PDF streaming bounds cancel oversized bodies',async()=>{
 for(const [method,size] of [['create',1000001],['pdf',5*1024*1024+1]]){
  let cancelled=false;
  const response=()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(size));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/pdf'}});
  const adapter=adapterWith(response);
  await assert.rejects(method==='create'?adapter.createLabel(shipment,'op'):adapter.fetchLabelPdf(pdfUrl),e=>e.code==='provider_malformed');
  assert.equal(cancelled,true);
 }
});
test('PDF rejects redirects, MIME mismatch, and non-PDF bytes',async()=>{
 for(const response of [()=>new Response('',{status:302}),()=>new Response('%PDF-1.4',{headers:{'content-type':'text/html'}}),()=>new Response('not PDF',{headers:{'content-type':'application/pdf'}})])await assert.rejects(adapterWith(response).fetchLabelPdf(pdfUrl));
});
test('recovery errors never produce a label or dispatch another shipment POST',async()=>{
 let requests=[];
 const adapter=adapterWith((url,options)=>{requests.push({url,options});return new Response(JSON.stringify({errorCode:'1090001',message:'fake-private-not-found'}),{status:404});},{clock:()=>100000});
 await assert.rejects(adapter.reconcileLabel('op',{reason:'no_response',createdAt:99000}),e=>e.code==='provider_failure'&&!e.message.includes('fake-private'));
 assert.equal(requests.length,1);assert.equal(requests[0].options.method,'GET');
});
test('500 recovery excludes throttling, opaque, and malformed responses',async()=>{
 for(const body of [JSON.stringify({errors:[{errorCode:'PB-APIM-ERR-1006',errorDescription:'fake-private'}]}),JSON.stringify({error:'opaque'}),'bad JSON']){
  await assert.rejects(adapterWith(()=>new Response(body,{status:500})).createLabel(shipment,'op'),e=>e.purchaseOutcome==='unknown'&&e.recoveryReason===undefined);
 }
 const adapter=adapterWith((_url,options)=>{assert.equal(options.headers['X-PB-UnifiedErrorStructure'],'true');return new Response(JSON.stringify({errors:[{errorCode:'fixture-500',errorDescription:'fake-private'}]}),{status:500});});
 await assert.rejects(adapter.createLabel(shipment,'op'),e=>e.purchaseOutcome==='unknown'&&e.recoveryReason==='http_500'&&!JSON.stringify(e).includes('fake-private'));
});
