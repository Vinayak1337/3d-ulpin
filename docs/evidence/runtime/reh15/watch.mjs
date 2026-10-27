import { appendFileSync } from 'node:fs';

// IL1 timing for REH15: poll one batch's intake list on the rehearsal API every 2 s (GET only) and append each
// change of an item's state, placement or parts, with the read's own duration, to scratch. Stops when every named
// item is read and on the map, or at the cap. Usage: node watch.mjs <key> <case id> <minutes> [item name ...]
const [key, caseId, minutes = '30', ...names] = process.argv.slice(2);
const api = `http://127.0.0.1:21026/api/v1/ingestion/cases/${caseId}/intake`;
const out = `E:/BhuAayam-data/task-data/reh15/watch-${key}.jsonl`;
const deadline = Date.now() + Number(minutes) * 60000;
const last = new Map();

const view = item => JSON.stringify([item.state, item.placement, item.partsDone, item.partsPlanned,
  item.limitReason?.slice(0, 160) ?? null]);
const done = item => item.state === 'read' && item.placement === 'on_map';

async function poll() {
  const started = Date.now();
  const response = await fetch(api, { signal: AbortSignal.timeout(60000) });
  const ms = Date.now() - started;
  if (response.status !== 200) {
    appendFileSync(out, `${JSON.stringify({ at: started, ms, status: response.status })}\n`);
    return false;
  }
  const body = await response.json();
  const items = (body.data ?? body).items.filter(item => !names.length || names.includes(item.name));
  for (const item of items) {
    const now = view(item);
    if (last.get(item.name) === now) continue;
    last.set(item.name, now);
    appendFileSync(out, `${JSON.stringify({ at: started, ms, name: item.name, state: item.state,
      placement: item.placement, partsDone: item.partsDone, partsPlanned: item.partsPlanned,
      reason: item.limitReason ?? null })}\n`);
  }
  return names.length > 0 && items.length === names.length && items.every(done);
}

while (Date.now() < deadline) {
  const finished = await poll().catch(error => {
    appendFileSync(out, `${JSON.stringify({ at: Date.now(), error: String(error.message).slice(0, 200) })}\n`);
    return false;
  });
  if (finished) break;
  await new Promise(resolve => setTimeout(resolve, 2000));
}
appendFileSync(out, `${JSON.stringify({ at: Date.now(), end: true })}\n`);
