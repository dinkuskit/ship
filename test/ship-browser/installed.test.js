import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { prepareLabelPreview } from '../../test-support/ship-browser/prepare.mjs';
import { ORDER } from '../../test-support/ship-journey/journey-fixture.mjs';
const run=promisify(execFile);
test('native browser label mount uses actual EmDash locals and stored-only private workerd route', {skip:process.env.SHIP_BROWSER_HOST_PROOF!=='1'?'explicit installed browser-host opt-in':false},async()=>{
 const host=await prepareLabelPreview();
 try {
  const get=async(extra={},cookie=host.cookie)=>{const u=new URL(host.viewUrl);u.searchParams.set('intent','download');for(const[k,v]of Object.entries(extra))u.searchParams.set(k,v);return fetch(u,{headers:cookie?{Cookie:cookie}:{},redirect:'manual'});};
  const deny=async response=>{assert.ok(response.status>=400);assert.notEqual(response.headers.get('content-type'),'application/pdf');assert.doesNotMatch(await response.text(),/%PDF-|Synthetic Recipient|Example Street/);};
  const initial=JSON.parse(await readFile(host.fixtureFile,'utf8'));
  const direct=await host.call('label-stored',{orderId:ORDER.orderId,operationId:host.label.operationId});assert.deepEqual(direct,host.bytes);
  const r=await get();assert.equal(r.status,200,r.status===200?'':await r.clone().text());assert.equal(r.headers.get('content-type'),'application/pdf');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('content-disposition'),'attachment; filename="shipping-label.pdf"');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),host.bytes);
  const view=await fetch(host.viewUrl,{headers:{Cookie:host.cookie}});assert.equal(view.status,200);assert.match(await view.text(),/Print attempt/);
  await deny(await get({},null));await deny(await get({operationId:'stale-operation'}));await deny(await get({orderId:'order:missing'}));await deny(await get({shopId:'forged-shop'}));
  await host.call('fixture',{action:'controls',controls:{wrongTenant:true}});await deny(await get());await host.call('fixture',{action:'controls',controls:{}});
  const sql=async(statement,params=[])=>run('python3',['-c','import sqlite3,json,sys;db=sqlite3.connect(sys.argv[1]);db.execute(sys.argv[2],json.loads(sys.argv[3]));db.commit()',join(host.hostDirectory,'.emdash/proof.sqlite'),statement,JSON.stringify(params)]);
  await sql("UPDATE users SET role=20 WHERE email='dev@emdash.local'");try{const denied=await get();assert.equal(denied.status,403);await deny(denied);}finally{await sql("UPDATE users SET role=50 WHERE email='dev@emdash.local'");}
  const raw=await host.call('admin',{page:'/journey',type:'page_load',values:{orderId:ORDER.orderId}});assert.match(JSON.stringify(raw),/View label/);assert.match(JSON.stringify(raw),/ship-label-assets/);
  assert.deepEqual(new Uint8Array(await(await get()).arrayBuffer()),host.bytes);
  const final=JSON.parse(await readFile(host.fixtureFile,'utf8'));assert.deepEqual(final.__creates,initial.__creates);assert.equal(final.__pdfFetches,initial.__pdfFetches);assert.equal(final.__reconciles,undefined);
  const receipt={fixtureOnly:true,packageSha256:host.packed.sha256,tests:'actual locals/session/RBAC + stored operation/tenant denials + exact bytes + no provider reads',pdfBytes:host.bytes.length,pdfSha256:createHash('sha256').update(host.bytes).digest('hex'),ordinaryBrowser:'separate visible click proof required',registry:false,productionCommerce:false};
  await mkdir('runs/ship-browser-20261008',{recursive:true});await writeFile('runs/ship-browser-20261008/installed-http.json',JSON.stringify(receipt,null,2)+'\n');console.log('BROWSER_HOST_GATE=passed:actual_emdash_private_stored_only');
 } finally { await host.cleanup(); }
});
