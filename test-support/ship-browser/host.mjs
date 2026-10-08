import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configureJourneyHost, prepareInstalledEmdashHost, startJourneyHost } from '../ship-journey/host.mjs';
import { journeyEntrySource } from '../ship-journey/journey-fixture.mjs';

export async function prepareBrowserHost() {
  const host = await prepareInstalledEmdashHost();
  try {
    const source = journeyEntrySource()
      .replace('const origin =', 'import { createLabelLinks } from "@dinkuskit/ship/host-label-assets";\nconst origin =')
      .replace('      if (shopId !== order.shopId) return null;', '      if (shopId !== order.shopId) return null;\n      if ((await base.json(ctx, \"/controls\")).wrongTenant) return { ...order, shopId: \"foreign-shop\" };')
      .replace('  authorityPort,', '  authorityPort,\n  browserAssetPort: { links: createLabelLinks() },');
    await configureJourneyHost(host, { entrySource: source });
    const pages = join(host.hostDirectory, 'src');
    await mkdir(pages, { recursive: true });
    await writeFile(join(pages, 'ship-label-assets.ts'), `
import { hasPermission, hasScope } from '@emdash-cms/auth';
import { createHostLabelAssets } from '@dinkuskit/ship/host-label-assets';
export const prerender = false;
const assets = createHostLabelAssets({ pluginId: 'dinkuskit-ship', hasPermission, hasScope });
export const GET = assets.GET;
`);
    const configPath = join(host.hostDirectory, 'astro.config.mjs');
    const config = await readFile(configPath, 'utf8');
    await writeFile(configPath, config.replace('    react(),', `    react(),
    { name: 'ship-browser-native-fixture', hooks: { 'astro:config:setup': ({ injectRoute }) => injectRoute({ pattern: '/_emdash/api/ship-label-assets', entrypoint: './src/ship-label-assets.ts', prerender: false }) } },`));
    await startJourneyHost(host);
    return host;
  } catch (error) { await host.cleanup(); throw error; }
}
