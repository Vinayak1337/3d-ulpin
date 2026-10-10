import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { ledgerRegistryHistoryEntry } from '../../../../packages/server/src/modules/officer/building-ledger-history.ts';

const here = 'docs/evidence/gf5/h9';
const replayBefore = process.argv[2] === 'before';
const tower = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const many = '4ad9cb6d-56c0-445e-a9b6-357d1dc1d452';
const one = '1ada7796-4e8f-4a19-9b7f-4414e80114c4';
const empty = '6d183fef-bcaf-40f6-90dc-2694bc9873a5';
async function read(path) {
  const response = await fetch(`http://127.0.0.1:3194/api/v1${path}`);
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return response.json();
}
const ledger = await read(`/buildings/${tower}/ledger`);
const historical = new Map();
for (const id of new Set(ledger.history.registry.map((entry) => entry.recordId))) {
  historical.set(id, (await read(`/registry/${id}`)).history);
}
ledger.history.registry = ledger.history.registry.map((entry) => {
  const row = historical.get(entry.recordId).find((candidate) => candidate.revision === entry.revision);
  return ledgerRegistryHistoryEntry({ ...row, record_id: entry.recordId });
});
const queue = await read('/work-queue');
for (const id of [many, one, empty]) {
  const sourceCase = await read(`/cases/${id}`);
  const row = queue.items.find((item) => item.id === id && item.kind === 'case');
  row.tableSourceIds = sourceCase.sources.filter((source) => source.profile === 'tabular-manual-v1')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .map((source) => source.id);
}
const screens = [
  ['history', `/studio/properties/${tower}/register?tab=history`],
  ['history-null-name', `/studio/properties/${tower}/register?tab=history`],
  ['case-five', `/studio/cases/${many}`],
  ['case-one', `/studio/cases/${one}`],
  ['case-empty', `/studio/cases/${empty}`],
  ['teacher-input-limit', `/studio/cases/${one}`],
  ['requests-answer-empty', '/studio/registry?tab=buildings'],
];
async function replayModule(route, pathname) {
  if (pathname === '/src/api/ledger.ts') {
    const response = await route.fetch();
    let script = await response.text();
    script = script.replace(/export function registryEntryTitle[\s\S]*?(?=export function historyActor)/,
      'export function registryEntryTitle(entry, fallback) '
      + '{ return `${fallback}, revision ${entry.revision}`; }\n');
    script = script.replace(/export function historyActor[\s\S]*?(?=export function revisedRecordId)/,
      'export function historyActor() { return "Actor not recorded"; }\n');
    await route.fulfill({ body: script, contentType: 'application/javascript' });
    return true;
  }
  if (pathname === '/src/features/intake/table/model.ts') {
    const response = await route.fetch();
    const script = (await response.text()).split('\n')
      .filter((line) => !line.includes('TEACHER_INPUT_LIMIT:')).join('\n');
    await route.fulfill({ body: script, contentType: 'application/javascript' });
    return true;
  }
  return false;
}

async function teacherRefusal(route) {
  const response = await route.fetch();
  const answer = await response.json();
  const mapping = answer.payload.mapping;
  mapping.questions.forEach((question) => { question.reason = 'TEACHER_INPUT_LIMIT'; });
  mapping.fieldSources.forEach((field) => {
    field.source = 'unanswered';
    field.method = 'manual:TEACHER_INPUT_LIMIT';
  });
  mapping.metrics.teacherCalls = 0;
  mapping.metrics.teacherFields = 0;
  mapping.metrics.unansweredFields = mapping.fieldSources.length;
  return route.fulfill({ json: answer });
}

const browser = await chromium.launch();
const results = [];
const refused = [];
for (const view of [{ name: '1440', width: 1440, height: 900, scale: 1 },
  { name: '200pct', width: 720, height: 450, scale: 2 }]) {
  for (const [name, path] of screens) {
    if (replayBefore && !['history', 'teacher-input-limit'].includes(name)) continue;
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale,
    });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const cardRead = request.method() === 'POST'
        && ['/usp/identity/resolve', '/usp/property-cards/list'].some((suffix) => pathname.endsWith(suffix));
      if (!['GET', 'HEAD'].includes(request.method()) && !cardRead) {
        refused.push(`${request.method()} ${pathname}`);
        return route.abort();
      }
      if (replayBefore && await replayModule(route, pathname)) return;
      if (pathname === `/api/v1/buildings/${tower}/ledger`) {
        const answer = structuredClone(ledger);
        if (name === 'history-null-name') answer.history.registry[0].recordName = null;
        return route.fulfill({ json: answer });
      }
      if (pathname === '/api/v1/work-queue') return route.fulfill({ json: queue });
      if (name === 'requests-answer-empty' && pathname === '/api/v1/register-requests') {
        return route.fulfill({ json: [] });
      }
      if (name === 'teacher-input-limit' && /\/chunk-mapping\/jobs\/[^/]+\/chunks\/\d+$/.test(pathname)) {
        return teacherRefusal(route);
      }
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:5229${path}`);
    await page.waitForTimeout(3500);
    if (view.name === '200pct' && name.startsWith('history')) {
      await page.locator('.ul-timeline li').nth(2).evaluate((node) => node.scrollIntoView({ block: 'center' }));
    }
    if (name === 'teacher-input-limit') {
      const sentence = replayBefore ? 'TEACHER_INPUT_LIMIT' : 'This table is too long for one request';
      await page.getByText(sentence, { exact: false }).first().scrollIntoViewIfNeeded();
    }
    if (name === 'requests-answer-empty') {
      await page.getByRole('heading', { name: 'Gurugram sectors 59/63A reference area', exact: false })
        .scrollIntoViewIfNeeded();
    }
    const prefix = replayBefore ? 'mocked-before' : 'mocked';
    await page.screenshot({ path: `${here}/after/${prefix}-${name}-${view.name}.png` });
    const text = (await page.locator('main').innerText()).slice(0, 2200);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const textLines = text.split('\n').flatMap((line) => line.match(/.{1,95}/g) ?? ['']);
    results.push({ name, view: view.name, sideways, textLines });
    await context.close();
  }
}
await browser.close();
const resultFile = replayBefore ? 'mocked-before.json' : 'mocked.json';
writeFileSync(`${here}/${resultFile}`, `${JSON.stringify({
  source: 'GET registry revision bodies projected with BR1 helper; GET case tables in server order',
  replayBefore: replayBefore ? 'Pre-H9 history/teacher presentation logic only, replayed in response modules' : false,
  alteredStates: ['history-null-name: first recordName null',
    'teacher-input-limit: question/field reason and unanswered metrics', 'requests-answer-empty: []'],
  registry: ledger.history.registry,
  caseRows: queue.items.filter((item) => [many, one, empty].includes(item.id))
    .map(({ id, tableSourceIds }) => ({ id, tableSourceIds })),
  refused, screens: results,
}, null, 2)}\n`);
console.log(JSON.stringify({ screens: results.length, refused }));
