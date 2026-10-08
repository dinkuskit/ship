import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepareLabelPreview } from './prepare.mjs';
const host = await prepareLabelPreview();
try {
  await mkdir('runs/ship-browser-20261008',{recursive:true});
  await writeFile('runs/ship-browser-20261008/preview.json',JSON.stringify({base:host.base,viewUrl:host.viewUrl,hostDirectory:host.hostDirectory,fixtureFile:host.fixtureFile,pdfBytes:host.bytes.length,pdfSha256:createHash('sha256').update(host.bytes).digest('hex'),packageSha256:host.packed.sha256,childPid:host.child.pid,fixtureOnly:true},null,2)+'\n');
  console.log('Native browser fixture ready: '+host.viewUrl);
  console.log('Type cleanup to stop this exact owned preview and its workerd group.');
  await new Promise(resolve=>process.stdin.once('data',resolve));
} finally {await host.cleanup();console.log('Owned preview cleanup complete.');}
