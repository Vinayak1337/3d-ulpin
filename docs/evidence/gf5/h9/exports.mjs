import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const here = 'docs/evidence/gf5/h9';
const state = process.argv[2] === 'before' ? 'before' : 'after';
const stem = state === 'before' ? 'tower3-before-register' : 'tower3-register';
let original = null;
if (state === 'before') {
  const source = execFileSync('git', ['show', '616f630a:apps/studio/src/features/register/registry.ts'],
    { encoding: 'utf8' });
  original = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext } }).outputText
    .replace("'./registerState'", "'/src/features/register/registerState.ts'")
    .replace("'./workbook'", "'/src/features/register/workbook.ts'");
}
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const refused = [];
await context.route('**/*', (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const cardRead = request.method() === 'POST'
    && ['/usp/identity/resolve', '/usp/property-cards/list'].some((suffix) => path.endsWith(suffix));
  if (original && path === '/src/features/register/registry.ts') {
    return route.fulfill({ body: original, contentType: 'application/javascript' });
  }
  if (request.method() === 'GET' || request.method() === 'HEAD' || cardRead) return route.continue();
  refused.push(`${request.method()} ${path}`);
  return route.abort();
});
const page = await context.newPage();
await page.goto('http://127.0.0.1:5229/studio/properties/6f95d04e-2067-4ac8-a3c2-6cc21ea46325/register');
await page.waitForTimeout(3500);
await page.getByRole('button', { name: 'Export', exact: true }).click();
const downloaded = page.waitForEvent('download');
await page.getByRole('menuitem', { name: 'Register workbook (Excel)' }).click();
const download = await downloaded;
await download.saveAs(`${here}/${stem}.xlsx`);
await page.getByRole('button', { name: 'Export', exact: true }).click();
const opened = context.waitForEvent('page');
await page.getByRole('menuitem', { name: 'Building register (PDF)' }).click();
const popup = await opened;
await popup.waitForTimeout(1500);
await popup.pdf({ path: `${here}/${stem}.pdf`, preferCSSPageSize: true, printBackground: true });
const headerRows = await popup.locator('thead tr').allTextContents();
const buildingFacts = await popup.locator('.facts').innerText();
await popup.screenshot({ path: `${here}/${state}/export-pdf-1440.png`, fullPage: true });
const zoomContext = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
const zoomed = await zoomContext.newPage();
await zoomed.setContent(await popup.content());
await zoomed.screenshot({ path: `${here}/${state}/export-pdf-200pct.png`, fullPage: true });
writeFileSync(`${here}/exports-${state}.json`, `${JSON.stringify({
  state, source: original ? 'Registry export module replayed from 616f630a; real demo GET reads' : 'Task branch',
  headerRows, buildingFacts: buildingFacts.split('\n'), refused,
}, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify({ headerRows, refused }));
