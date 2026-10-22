import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const files = JSON.parse(readFileSync('docs/evidence/runtime/reh10/act1-files.json', 'utf8')).files;
const steps = {
  drop: `
    await page.getByRole('link', { name: 'Add files', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles(${JSON.stringify(files.map(file => file.path))});
    await page.getByLabel('New case name').fill('SFA1 NYC surfaces test_only');
    h.mark('drop-retain');
    await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
    await page.waitForURL(/\\/studio\\/work\\/cases\\/[^/]+\\/intake/, { timeout: 90000 });
    h.mark('batch-open');
    await h.shot('batch-' + Date.now());
    return { url: page.url(), text: await h.text(), marks: h.marks };
  `,
  approve: `
    h.mark('approve-layout');
    await page.getByRole('button', { name: 'Approve layout', exact: true }).click();
    return { text: (await h.text()).slice(0, 4000), marks: h.marks };
  `,
  inspect: `return { url: page.url(), text: (await h.text()).slice(0, 4000), marks: h.marks };`,
  'open-map': `
    const link = page.getByRole('link', { name: 'Open package', exact: true });
    await link.waitFor({ timeout: 90000 });
    const href = await link.getAttribute('href');
    h.map = await context.newPage();
    h.mark('map-open');
    await h.map.goto('http://127.0.0.1:5188' + href.split('?')[0], { waitUntil: 'domcontentloaded' });
    await h.map.getByText('Tools', { exact: true }).click();
    await h.map.evaluate(() => {
      window.__sfa1Layers = [];
      let last = '';
      const observe = () => {
        const lines = document.body.innerText.split('\\n').filter(line => line.includes('Display only.'));
        const next = JSON.stringify(lines);
        if (next === last) return;
        last = next;
        window.__sfa1Layers.push({ at: Date.now(), lines });
      };
      new MutationObserver(observe).observe(document.body, { subtree: true, childList: true, characterData: true });
      observe();
    });
    return { url: h.map.url(), text: await h.text(h.map), marks: h.marks };
  `,
  'map-state': `
    await h.shot('map-' + Date.now(), h.map);
    return { text: await h.text(h.map), layers: await h.map.evaluate(() => window.__sfa1Layers), marks: h.marks };
  `,
  map: `
    const links = await page.locator('a').evaluateAll(nodes => nodes.map(a => ({
      text: a.textContent, href: a.href,
    })));
    return { links, text: await h.text() };
  `,
  close: `return { marks: h.marks };`,
};
steps.fresh = `
  await page.goto('http://127.0.0.1:5188/studio/work', { waitUntil: 'domcontentloaded' });
  h.surfaceSeen = new Map();
  page.on('response', async response => {
    if (!/\\/intake$/.test(new URL(response.url()).pathname)) return;
    const body = await response.json().catch(() => null);
    for (const item of (body?.data ?? body)?.items ?? []) {
      if (!['raster', 'point_cloud'].includes(item.family)) continue;
      const state = JSON.stringify([item.partsDone, item.placement]);
      if (h.surfaceSeen.get(item.itemId) === state) continue;
      h.surfaceSeen.set(item.itemId, state);
      h.mark('surface-state', { itemId: item.itemId, name: item.name, done: item.partsDone,
        planned: item.partsPlanned, placement: item.placement });
    }
  });
` + steps.drop.replace('SFA1 NYC surfaces test_only', 'SFA1 NYC surfaces final test_only');
const step = process.argv[2];
assert(steps[step], 'Unknown presenter step');
const response = await fetch('http://127.0.0.1:5399', {
  method: 'POST', body: JSON.stringify({ step, code: steps[step] }),
});
const value = await response.json();
writeFileSync(`docs/evidence/sfa1/live-${process.argv[3] ?? step}.json`, JSON.stringify(value, null, 2) + '\n',
  { flag: 'wx' });
console.log(JSON.stringify(value, null, 2));
assert(value.ok, value.error);
