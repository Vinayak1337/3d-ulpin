import type { Page } from '@playwright/test';

export async function drawingProof(page: Page, path: string, scratch: string, result: Record<string, any>) {
  const failures: unknown[] = [];
  const response = (value: any) => {
    if (value.status() >= 400) failures.push({ status: value.status(), url: value.url() });
  };
  const failed = (request: any) => failures.push({ url: request.url(), error: request.failure() });
  page.on('response', response);
  page.on('requestfailed', failed);
  const from = result.console.length;
  const canonical = page.waitForResponse(value => value.url().endsWith('/canonical') && value.status() === 200,
    { timeout: 60000 }).then(value => ({ status: value.status(), url: value.url() }))
    .catch(error => ({ failure: error.message }));
  await page.goto(new URL(path, page.url()).href);
  const canonicalResponse = await canonical;
  await page.waitForFunction(() => Boolean((window as any).__ulpinScene));
  await page.waitForFunction(() => [...(window as any).__ulpinScene.tilesets]
    .every((tiles: any) => tiles.loadProgress >= 1), undefined, { timeout: 30000 });
  await page.waitForTimeout(3000);
  result.drawing = { ...await sceneFacts(page), canonicalResponse, firstFailingRequest: failures[0] ?? null,
    console: result.console.slice(from), screenshot: `${scratch}/drawing.png` };
  await page.screenshot({ path: result.drawing.screenshot, fullPage: true });
  page.off('response', response);
  page.off('requestfailed', failed);
}

function sceneFacts(page: Page) {
  return page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    const engine = (window as any).__ulpinScene;
    return { webgl: Boolean(gl), renderer: extension ? gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
      sceneStats: (window as any).__ulpinSceneStats(),
      tiles: [...engine.tilesets].map((tiles: any) => ({ loadProgress: tiles.loadProgress })) };
  });
}

type Api = { start: () => Promise<void>; stop: () => Promise<void> };
export async function reconnectProof(page: Page, api: Api, scratch: string) {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  const active = new Set<string>();
  session.on('Network.requestWillBeSent', event => {
    if (new URL(event.request.url).pathname.endsWith('/events')) active.add(event.requestId);
  });
  session.on('Network.loadingFinished', event => active.delete(event.requestId));
  session.on('Network.loadingFailed', event => active.delete(event.requestId));
  const before = await page.getByRole('region', { name: 'Files in this batch', exact: true }).innerText();
  const readFrom = await watchNotice(page);
  const started = performance.now();
  const wallStarted = Date.now();
  await api.stop();
  let noticedMs: number | null = null;
  await page.getByRole('button', { name: 'Reconnect updates', exact: true }).waitFor({ timeout: 14000 })
    .then(() => { noticedMs = Math.round(performance.now() - started); }).catch(() => {});
  const remaining = 15000 - (performance.now() - started);
  if (remaining > 0) await page.waitForTimeout(remaining);
  const stopped = await page.locator('main').innerText();
  await page.screenshot({ path: `${scratch}/api-stopped.png`, fullPage: true });
  const keptTray = before === await page.getByRole('region', { name: 'Files in this batch', exact: true }).innerText();
  await api.start();
  await page.waitForTimeout(35000);
  const bannerCleared = await page.getByRole('button', { name: 'Reconnect updates', exact: true }).count() === 0;
  await page.screenshot({ path: `${scratch}/api-restarted.png`, fullPage: true });
  await session.detach();
  return { comparison: 'Kill only the nonce-owned API Node process, wait 15 seconds, restart at its same port.',
    noticedMs, withinTwoSilencePeriods: noticedMs !== null && noticedMs <= 10000,
    keptTray, bannerCleared, openEventRequestsAfterRestart: active.size, stopped,
    ...await noticeFacts(page, readFrom, wallStarted),
    screenshots: [`${scratch}/api-stopped.png`, `${scratch}/api-restarted.png`] };
}

function watchNotice(page: Page) {
  return page.evaluate(() => {
    (window as any).__lostAt = null;
    const observer = new MutationObserver(() => {
      if (document.body.innerText.includes('Live updates are disconnected.')) {
        (window as any).__lostAt ??= Date.now();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    (window as any).__lostObserver = observer;
    return (window as any).__eventReads.length;
  });
}

async function noticeFacts(page: Page, from: number, started: number) {
  const readerAfterStop = await page.evaluate(offset => (window as any).__eventReads.slice(offset), from);
  const firstNoticeIncludingAfterRestartMs = await page.evaluate(start => {
    (window as any).__lostObserver.disconnect();
    return (window as any).__lostAt === null ? null : (window as any).__lostAt - start;
  }, started);
  return { readerAfterStop, firstNoticeIncludingAfterRestartMs };
}
