// Compact one AD1 runtime receipt (outside Git) into the committed evidence shape; the receipt stays the original.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [source, target] = process.argv.slice(2);
if (!source || !target || existsSync(target)) throw new Error('Supply a receipt and a new evidence path.');
const receipt = JSON.parse(readFileSync(source, 'utf8'));
const evidence = receipt.runtime?.evidence;
const SCREENS = ['buildings1661', 'demoArea2148', 'niagara'];

function route(path) {
  return path.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}');
}

function requests(screen) {
  return screen.requests.map(request => ({ route: route(request.path), method: request.method,
    status: request.status ?? null, startedMs: request.startedMs, ms: request.durationMs, bytes: request.bytes ?? null,
    ...(request.failure ? { failure: request.failure } : {}) }));
}

function server(timing) {
  if (!timing) return null;
  const top = list => list?.map(item => ({ sql: item.sql.slice(0, 160), count: item.count, totalMs: item.totalMs,
    explain: item.explain }));
  return { context: { ...timing.context, top: top(timing.context.top) },
    buildingReads: timing.buildingReads && { ...timing.buildingReads, top: top(timing.buildingReads.top) } };
}

function screen(label) {
  const value = evidence?.results?.[label];
  if (!value) return null;
  const { screen: page } = value;
  return { areaId: value.areaId, recorded: value.recorded, server: server(value.server),
    renderer: page.renderer, expectedBuildings: page.expectedBuildings, firstFootprintsMs: page.firstFootprintsMs,
    wholeAreaMs: page.wholeAreaMs, drawnBuildings: page.drawnBuildings, pending: page.pending,
    longestTaskMs: page.longestTaskMs, tasksOver200Ms: page.tasksOver200Ms.length, requests: requests(page),
    mainWords: page.mainWords.slice(0, 600), console: page.console, screenshot: page.screenshot };
}

const compact = { task: 'AD1', phase: evidence?.results?.phase, rawReceipt: source, container: receipt.container,
  startedAt: receipt.startedAt, finishedAt: receipt.finishedAt, ownedContainerGone: receipt.ownedContainerGone,
  failures: evidence?.failures ?? [receipt.failure], originalHashesUnchanged: evidence?.originalHashesUnchanged,
  providers: evidence?.providers, network: evidence?.network,
  screens: Object.fromEntries(SCREENS.map(label => [label, screen(label)])) };
writeFileSync(target, `${JSON.stringify(compact, null, 1)}\n`, { flag: 'wx' });
