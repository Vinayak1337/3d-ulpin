// Records the real Studio walking through the demo, for the launch film.
//   node video/launch/record.mjs video/launch/rec
// Needs the demo Studio (pnpm studio:demo) on STUDIO_URL (default http://127.0.0.1:5190).
// Output: <outDir>/raw/*.jpg (every painted frame), <outDir>/frames.json (timestamps), <outDir>/events.json
// (clip marks, cursor moves, clicks, typing and drops) and <outDir>/index.json (frame per 1/30 s).
// Clip times in film.js refer to events.json; re-check them after a new recording.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/'));
const { chromium } = require('playwright');
const P = process.env.STUDIO_URL ?? 'http://127.0.0.1:5190';
const OUT = process.argv[2]; const DS = join(root, 'apps/studio/datasets');
const NYC = process.env.NYC_ZIP ?? `${process.env.HOME}/.codex/task-data/nyc-zcta-10013-context/nyc-10013-official-context.zip`;
const RES = 'e8e17f26-e098-5caa-92e9-49948df1816a';
rmSync(join(OUT, 'raw'), { recursive: true, force: true }); mkdirSync(join(OUT, 'raw'), { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGE', e.message));
const now = () => Date.now() / 1000;
const events = []; const ev = (e) => events.push({ t: now(), ...e });
const wait = (ms) => page.waitForTimeout(ms);

// warm up before capture
await page.goto(`${P}/studio/work?reset-session`); await wait(2500);
await page.goto(`${P}/studio/work`); await wait(2500);

const cdp = await ctx.newCDPSession(page);
const frames = []; let n = 0; const pending = [];
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const file = `${String(n++).padStart(6, '0')}.jpg`;
  pending.push(Promise.resolve().then(() => writeFileSync(join(OUT, 'raw', file), Buffer.from(data, 'base64'))));
  frames.push({ t: metadata.timestamp, file });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = now();

let cx = 960, cy = 540;
const moveTo = async (x, y, dur = 0.65) => { ev({ type: 'move', x0: cx, y0: cy, x, y, dur }); await page.mouse.move(x, y, { steps: 6 }); cx = x; cy = y; await wait(dur * 1000); };
const center = async (loc) => { await loc.waitFor({ state: 'visible', timeout: 20000 }); const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const click = async (loc, dur) => { const [x, y] = await center(loc); await moveTo(x, y, dur); ev({ type: 'click', x, y }); await page.mouse.click(x, y); };
const clickAt = async (x, y, dur) => { await moveTo(x, y, dur); ev({ type: 'click', x, y }); await page.mouse.click(x, y); };
const type = async (text, per = 110) => { for (const ch of text) { ev({ type: 'key' }); await page.keyboard.type(ch); await wait(per); } };
const drop = async (files, names) => {
  const zone = page.getByText(/drop/i).first(); let x = 960, y = 400;
  try { [x, y] = await center(zone); } catch { /* keep default */ }
  await moveTo(x, y, 0.5); ev({ type: 'drop', x, y, files: names }); await wait(600);
  await page.locator('input[type=file]').first().setInputFiles(files);
};
const nav = async (url) => { await page.evaluate((u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, url); };
const mark = (name, edge) => { ev({ type: 'mark', name, edge }); console.log(edge, name, (now() - t0).toFixed(1)); };
const clip = async (name, fn) => { mark(name, 'in'); try { await fn(); } catch (e) { console.error('FAIL', name, e.message.split('\n')[0]); } mark(name, 'out'); };

await clip('batches', async () => { await wait(1500); await click(page.getByRole('link', { name: 'Add files' }).or(page.getByRole('button', { name: 'Add files' })).first()); await wait(1200); });
await clip('nyc-add', async () => {
  await drop(NYC, ['nyc-10013-official-context.zip · 9 layers']); await wait(4200);
  await click(page.getByRole('button', { name: 'Continue' })); await wait(1600);
  await click(page.getByRole('button', { name: 'Start import' })); await wait(800);
});
await clip('nyc-stream', async () => {
  await page.getByText(/(\d[\d,]*) of \1 uploaded features accepted/).first().waitFor({ timeout: 180000 }); await wait(2500);
});
let nycArea = new URL(page.url()).pathname.split('/').pop();
await clip('nyc-explore', async () => {
  await click(page.getByPlaceholder(/Find building/)); await type('37237'); await wait(1200);
  await click(page.getByText('Building 37237').first()); await wait(4200);
  await click(page.getByRole('button', { name: 'Explore floors' })); await wait(4500);
  await click(page.getByRole('link', { name: 'Open register' })); await wait(3500);
  await click(page.getByRole('tab', { name: /Residents/ })); await wait(3000);
  await click(page.getByRole('button', { name: 'Export' })); await wait(2400); await page.keyboard.press('Escape'); await wait(600);
});
await clip('lake-add', async () => {
  await nav('/studio/add-files'); await wait(1200);
  await drop(join(DS, '1-area/lake_view_survey.geojson'), ['lake_view_survey.geojson']); await wait(2600);
  await click(page.getByRole('button', { name: 'Continue' })); await wait(2600);
  await click(page.getByRole('button', { name: 'Start import' })); await wait(16000);
});
const lakeArea = new URL(page.url()).pathname.split('/').pop();
await clip('floors', async () => {
  await nav(`/studio/areas/${lakeArea}?feature=${RES}`); await wait(3500);
  await nav(`/studio/add-files?feature=${RES}`); await wait(1500);
  const docs = ['deed_of_declaration.pdf', 'levels.csv', 'plan_F7.pdf', 'sale_deed_704.pdf', 'unit_inventory.csv'];
  await drop(docs.map((f) => join(DS, '2-building', f)), docs); await wait(2400);
  await click(page.getByRole('button', { name: 'Start import' })); await wait(13000);
});
await clip('deviation', async () => {
  await nav(`/studio/properties/${RES}/register`); await wait(3500);
  await click(page.getByRole('button', { name: 'Deviation check' })); await wait(3500);
  await click(page.getByRole('button', { name: 'Create finding' })); await wait(2200);
});
const ids = await page.evaluate(async (res) => { const reg = await (await fetch(`/api/v1/buildings/${res}/register`)).json();
  const f8 = reg.register.find((r) => r.kind === 'floor' && r.name === 'F8'); const flat = reg.register.find((r) => r.name === 'Flat 801'); return { f8: f8?.id, flat: flat?.id }; }, RES);
await clip('flat', async () => {
  await nav(`/studio/areas/${lakeArea}?feature=${RES}&mode=level&level=${ids.f8}`); await wait(3500);
  await nav(`/studio/areas/${lakeArea}?feature=${RES}&mode=level&level=${ids.f8}&record=${ids.flat}`); await wait(2800);
  if (!(await page.getByRole('button', { name: 'Assign code' }).count())) { await click(page.getByRole('button', { name: 'Record reviewed details' })); await wait(1500); }
  await click(page.getByRole('button', { name: 'Assign code' }).first()); await wait(1400);
  await click(page.getByRole('dialog').getByRole('button', { name: 'Assign code' })); await wait(2000);
  await click(page.getByRole('button', { name: /Property Card/ }).first()); await wait(3200);
  await click(page.getByRole('link', { name: 'Open verification page' })); await wait(3500);
});
await clip('findings', async () => { await nav(`/studio/areas/${lakeArea}?feature=${RES}&mode=findings`); await wait(5500); });
await clip('underground', async () => {
  await nav(`/studio/areas/${lakeArea}?feature=${RES}&mode=underground`); await wait(3500);
  await clickAt(760, 760); await wait(700); await clickAt(1180, 690); await wait(3500);
});
await clip('portal', async () => {
  await nav('/portal'); await wait(2500);
  await click(page.getByRole('searchbox').or(page.getByRole('textbox')).first()); await type('MH2507A1B3C4D5', 70); await wait(400);
  ev({ type: 'key' }); await page.keyboard.press('Enter'); await wait(3000);
  await click(page.getByRole('link', { name: /Open building/ }).nth(1)); await wait(3500);
  const req = page.getByRole('link', { name: /floor data/i }).or(page.getByRole('button', { name: /floor data/i })).first();
  await click(req); await wait(3000);
});

await cdp.send('Page.stopScreencast'); await Promise.all(pending);
writeFileSync(join(OUT, 'frames.json'), JSON.stringify({ t0, frames }));
writeFileSync(join(OUT, 'events.json'), JSON.stringify(events.map((e) => ({ ...e, t: +(e.t - t0).toFixed(3) }))));
// 30 fps index: the latest painted frame at or before each tick
const fps = 30, end = now() - t0, index = []; let k = 0;
for (let i = 0; i / fps < end; i++) { const t = t0 + i / fps; while (k + 1 < frames.length && frames[k + 1].t <= t) k++; index.push(frames[k].file); }
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
console.log(`recorded ${frames.length} painted frames, ${end.toFixed(1)} s`);
await browser.close();
