import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const here = 'docs/evidence/gf5/h9';
const state = process.argv[2] ?? 'before';
const tower = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const many = '4ad9cb6d-56c0-445e-a9b6-357d1dc1d452';
const one = '1ada7796-4e8f-4a19-9b7f-4414e80114c4';
const screens = [
  ['history', `/studio/properties/${tower}/register?tab=history`],
  ['case-five', `/studio/cases/${many}`],
  ['table', `/studio/cases/${one}`],
  ['buildings', '/studio/registry?tab=buildings'],
];
const reads = {};
for (const path of [`/buildings/${tower}/ledger`, '/work-queue', `/cases/${many}`, `/cases/${one}`]) {
  const response = await fetch(`http://127.0.0.1:3194/api/v1${path}`);
  reads[path] = { status: response.status, body: await response.json() };
}
const schema = readFileSync('packages/api-client/src/schema.d.ts', 'utf8');
const fields = ['recordKind?', 'recordName?', 'actor?', 'tableSourceIds?'];
const generatedTypes = Object.fromEntries(fields.map((field) => [field, schema.includes(field)]));
mkdirSync(`${here}/${state}`, { recursive: true });
const browser = await chromium.launch();
const refused = [];
const results = [];
for (const view of [{ name: '1440', width: 1440, height: 900, scale: 1 },
  { name: '200pct', width: 720, height: 450, scale: 2 }]) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
  });
  await context.route('**/*', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const postRead = request.method() === 'POST'
      && ['/usp/identity/resolve', '/usp/property-cards/list'].some((suffix) => path.endsWith(suffix));
    if (request.method() === 'GET' || request.method() === 'HEAD' || postRead) return route.continue();
    refused.push(`${request.method()} ${path}`);
    return route.abort();
  });
  for (const [name, path] of screens) {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:5229${path}`);
    await page.waitForTimeout(3500);
    const text = await page.locator('main').innerText();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: `${here}/${state}/${name}-${view.name}.png`, fullPage: true });
    const textLines = text.slice(-2500).split('\n').flatMap((line) => line.match(/.{1,95}/g) ?? ['']);
    results.push({ name, view: view.name, path: new URL(page.url()).pathname, sideways, textLines });
    await page.close();
  }
  await context.close();
}
await browser.close();
const ledger = reads[`/buildings/${tower}/ledger`].body;
const queue = reads['/work-queue'].body;
const result = { state, studioPort: 5229, refused, generatedTypes, reads: {
  ledger: { status: reads[`/buildings/${tower}/ledger`].status, registry: ledger.history.registry },
  queue: { status: reads['/work-queue'].status, body: queue },
  cases: [many, one].map((id) => ({ id, status: reads[`/cases/${id}`].status,
    sources: reads[`/cases/${id}`].body.sources.map(({ id, name, profile, createdAt }) =>
      ({ id, name, profile, createdAt })) })),
}, screens: results };
if (state === 'after' && existsSync(`${here}/export-inspection.json`)) {
  result.exports = JSON.parse(readFileSync(`${here}/export-inspection.json`, 'utf8'));
}
writeFileSync(`${here}/${state}.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ state, refused, screens: results.map(({ name, path }) => ({ name, path })) }));
