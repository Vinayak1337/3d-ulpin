import { appendFileSync, existsSync, readFileSync } from 'node:fs';

// REH9 G22 under load: every 10 s, the product's own read routes only (GET, no SQL): each case's intake items
// (state, parts done of planned, records seen, limit reason) and, for an item with a part plan, its parts list.
// The product has no route that lists jobs by lane, so lane order is read from when each item's state and parts
// move. Cases are read from cases.txt in the scratch folder (one id per line), so a table case can be added.
// Usage: node g22-poll.mjs <minutes>
const api = 'http://127.0.0.1:21026/api/v1/ingestion';
const scratch = 'E:/BhuAayam-data/task-data/reh9';
const until = Date.now() + Number(process.argv[2] ?? 60) * 60000;
const last = new Map();
const get = async path => {
  const started = Date.now();
  try {
    const response = await fetch(`${api}${path}`);
    const body = response.ok ? await response.json() : null;
    return { status: response.status, ms: Date.now() - started, body: body?.data ?? body };
  } catch (error) { return { status: null, ms: Date.now() - started, error: String(error.message) }; }
};
const parts = body => (Array.isArray(body) ? body : body?.parts ?? []).map(part =>
  `${part.partIndex ?? part.index}:${part.state ?? part.status}`).join(',');

while (Date.now() < until) {
  const cases = existsSync(`${scratch}/cases.txt`)
    ? readFileSync(`${scratch}/cases.txt`, 'utf8').split(/\s+/).filter(Boolean) : [];
  for (const caseId of cases) {
    const intake = await get(`/cases/${caseId}/intake`);
    const row = { at: new Date().toISOString(), caseId, status: intake.status, ms: intake.ms, items: [] };
    for (const item of intake.body?.items ?? []) {
      const value = { name: item.name, family: item.family, state: item.state, placement: item.placement,
        parts: `${item.partsDone}/${item.partsPlanned ?? '-'}`, records: item.recordsSeen, limit: item.limitReason };
      if (item.partsPlanned && item.state !== 'read') {
        const list = await get(`/cases/${caseId}/intake/items/${item.itemId}/parts`);
        value.partStates = list.status === 200 ? parts(list.body) : `status ${list.status}`;
      }
      const key = `${caseId}/${item.itemId}`, text = JSON.stringify(value);
      if (last.get(key) !== text) { row.items.push(value); last.set(key, text); }
    }
    appendFileSync(`${scratch}/g22-log.jsonl`, `${JSON.stringify(row)}\n`);
  }
  await new Promise(resolve => setTimeout(resolve, 10000));
}
