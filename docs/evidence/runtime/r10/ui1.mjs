import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// R10 part A0, UI1 on ulpin-reh-02: the rehearsal Studio (dev server on 5188, API 21026, as REH13's launch.ps1)
// opens the REH13 cited building's record page in headless Chromium and keeps what its header and Documents tab
// show, with the building ledger's HTTP status. Reads only: no button but the Documents tab is pressed.
const rehearsal = 'E:/Projects/ulpin-wt/ulpin-reh-02';
const scratch = 'E:/BhuAayam-data/task-data/r10';
const studio = 'http://127.0.0.1:5188';
const building = 'a69cdab3-1b02-4dc1-b5aa-a11e3632d36a'; // feature 1084419, the target carded 93fd4362
const { chromium } = createRequire(`${rehearsal}/package.json`)('@playwright/test');

function startStudio() {
  return spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm studio:dev --host 127.0.0.1 --port 5188 --strictPort'],
    { cwd: rehearsal, env: { ...process.env, ULPIN_API_TARGET: 'http://127.0.0.1:21026' }, windowsHide: true,
      stdio: 'ignore' });
}

async function waitForStudio() {
  for (let i = 0; i < 120; i += 1) {
    const reply = await fetch(studio, { signal: AbortSignal.timeout(2000) }).catch(() => null);
    if (reply?.ok) return;
    await new Promise(done => setTimeout(done, 1000));
  }
  throw new Error('The rehearsal Studio did not answer in 120 s');
}

const lines = text => text.split(/\n+/).map(line => line.trim()).filter(Boolean);

async function readRecordPage(page) {
  const ledger = page.waitForResponse(reply => reply.url().includes(`/api/v1/buildings/${building}/ledger`),
    { timeout: 120000 });
  await page.goto(`${studio}/studio/properties/${building}/register`, { waitUntil: 'domcontentloaded' });
  const ledgerReply = await ledger;
  await page.getByRole('button', { name: /Property Card/ }).waitFor({ timeout: 60000 });
  const header = lines(await page.locator('header', { has: page.locator('h1') }).first().innerText());
  await page.screenshot({ path: `${scratch}/ui1-header.png` });
  await page.getByRole('tab', { name: /Documents/ }).click();
  const panel = page.locator('[class*="tabBody"]').first(); // the tab body; Tabs renders no tabpanel role
  await panel.waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  const documents = lines(await panel.innerText());
  await page.screenshot({ path: `${scratch}/ui1-documents.png`, fullPage: true });
  return { ledger: { status: ledgerReply.status() }, header, documents };
}

async function main() {
  const server = startStudio();
  const browser = await chromium.launch({ headless: true });
  try {
    await waitForStudio();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', message => message.type() === 'error' && errors.push(message.text().slice(0, 200)));
    page.on('pageerror', error => errors.push(`pageerror: ${error.message.slice(0, 200)}`));
    const refused = [];
    page.on('response', reply => {
      if (reply.status() >= 400) refused.push(`${reply.status()} ${new URL(reply.url()).pathname}`);
    });
    const read = await readRecordPage(page);
    const value = { at: new Date().toISOString(), studio, building, feature: '1084419', ...read, consoleErrors: errors,
      refused, screenshots: [`${scratch}/ui1-header.png`, `${scratch}/ui1-documents.png`] };
    writeFileSync(new URL('./ui1-reh02.json', import.meta.url), `${JSON.stringify(value, null, 1)}\n`, { flag: 'wx' });
    console.log(JSON.stringify(value, null, 2));
  } finally {
    await browser.close();
    spawnSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
  }
}

await main();
