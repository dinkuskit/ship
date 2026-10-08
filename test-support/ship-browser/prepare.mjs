import { prepareBrowserHost } from './host.mjs';
import { ORDER, PACKAGE } from '../ship-journey/journey-fixture.mjs';
export async function prepareLabelPreview() {
  const host = await prepareBrowserHost();
  try {
    const response = await fetch(host.base + '/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin', {redirect:'manual'});
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Host fixture session unavailable');
    const call = async (route, input) => {
      const r = await fetch(host.base + '/_emdash/api/plugins/dinkuskit-ship/' + route, { method:'POST',headers:{'content-type':'application/json','X-EmDash-Request':'1',Cookie:cookie},body:JSON.stringify(input) });
      if (!r.ok) throw new Error('Host fixture setup action failed: ' + route);
      return r.headers.get('content-type') === 'application/pdf' ? new Uint8Array(await r.arrayBuffer()) : (await r.json()).data;
    };
    const quote = await call('journey',{action:'quote',orderId:ORDER.orderId,packageValues:PACKAGE});
    const label = await call('journey',{action:'buy',orderId:ORDER.orderId,packageValues:PACKAGE,quoteId:quote.quoteId,idempotencyKey:'browser-fixture-key',confirmation:{confirmed:true,service:quote.service,amount:quote.amount,currency:quote.currency}});
    const bytes = await call('label-pdf',{orderId:ORDER.orderId});
    const query = new URLSearchParams({orderId:ORDER.orderId,operationId:label.operationId,intent:'view'});
    return Object.assign(host,{cookie,call,label,bytes,viewUrl:host.base+'/_emdash/api/ship-label-assets?'+query});
  } catch (error) { await host.cleanup();throw error; }
}
