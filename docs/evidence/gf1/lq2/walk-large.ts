import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Browser, Page } from '@playwright/test';

export async function largeBrowserWalk(browser: Browser, url: string, scratch: string, result: Record<string, any>) {
  const asset = JSON.parse(readFileSync('docs/evidence/gf1/da6/result.json', 'utf8')).assets[0];
  assert.equal(gate('pv1')?.uploadWithoutCitation, true);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  result.inputs.push({ path: asset.retainedPath, bytes: asset.bytes, sha256: asset.sha256 });
  result.calls = [];
  result.console = [];
  page.on('console', message => result.console.push({ type: message.type(), text: message.text() }));
  page.on('response', response => {
    if (response.url().includes('/api/v1/')) result.calls.push({ path: new URL(response.url()).pathname,
      status: response.status(), method: response.request().method() });
  });
  await page.addInitScript('window.__name = value => value;');
  await page.goto(`${url}studio/add-files`);
  await page.locator('input[type=file]').setInputFiles(asset.retainedPath);
  await page.getByLabel('New case name', { exact: true }).fill('DA6 NYC test_only large original, origin not stated');
  await observeProgress(page);
  await page.getByRole('button', { name: 'Retain files and open batch', exact: true }).click();
  await page.getByText(/^Checking the file:/).waitFor();
  await page.screenshot({ path: `${scratch}/checking.png`, fullPage: true });
  await page.getByText(/^Uploading:/).waitFor();
  await page.screenshot({ path: `${scratch}/uploading.png`, fullPage: true });
  await page.waitForURL(/\/intake$/, { timeout: 120000 });
  result.largeUpload = { screenProgress: await progressFacts(page), url: page.url() };
  await page.getByRole('region', { name: 'Files in this batch', exact: true }).waitFor();
  await page.waitForTimeout(6000);
  result.largeUpload.body = await page.locator('main').innerText();
  result.largeUpload.screenshot = `${scratch}/enrolled.png`;
  await page.screenshot({ path: result.largeUpload.screenshot, fullPage: true });
  assert.equal(createHash('sha256').update(readFileSync(asset.retainedPath)).digest('hex'), asset.sha256);
  result.gates = { pv1: gate('pv1'), lp3b: gate('lp3b'), zb1: gate('zb1') };
  result.stoppedAt = 'The enrolled row is reported exactly; no large-file layout question was authored.';
  await page.close();
}

function observeProgress(page: Page) {
  return page.evaluate(() => {
    (window as any).__progress = [];
    const observer = new MutationObserver(() => {
      const words = [...document.querySelectorAll('td')].map(node => node.textContent ?? '')
        .find(text => /^(Checking the file:|Uploading:|Verifying the upload)/.test(text));
      const entries = (window as any).__progress;
      if (words && entries.at(-1)?.words !== words) entries.push({ at: performance.now(), words });
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    (window as any).__progressObserver = observer;
  });
}

function progressFacts(page: Page) {
  return page.evaluate(() => {
    (window as any).__progressObserver.disconnect();
    const entries = (window as any).__progress;
    const start = entries[0]?.at;
    return entries.map((entry: any) => ({ elapsedMs: Math.round(entry.at - start), words: entry.words }));
  });
}

function gate(task: string) {
  try { return JSON.parse(execFileSync('git', ['show', `staging:docs/evidence/gf1/${task}/result.json`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch { return null; }
}
