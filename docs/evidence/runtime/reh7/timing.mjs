import { attribute, startSampler } from './sampler.mjs';
import { gpu, save } from './audit.mjs';

// REH7 Part B: the two REH6 windows timed straight against the API with Node's fetch, no browser and no proxy.
// W4 and W5 are REH6's part-b-map-wait.json stages 4 and 5, rebuilt as centre +/- half the rounded width and height
// that map-wait.mjs recorded; page limits are the Studio's (4000, then up to the 15,000 budget: 4000, 4000, 3000).
// Per request: status, seconds to headers, seconds to the last byte, bytes, features, whether `next` is set, and
// the API's CPU seconds and Postgres's CPU% over its span. Usage: node timing.mjs <apiPid>.
const API = 'http://127.0.0.1:21026';
const areaId = 'a1c1252a-949f-42a7-a879-5ad2aaa7cc46';
const pid = Number(process.argv[2]);
if (!Number.isInteger(pid)) throw new Error('Usage: node timing.mjs <apiPid>');
const box = ([x, y], [w, h]) => ({ minX: x - w / 2, minY: y - h / 2, maxX: x + w / 2, maxY: y + h / 2 });
const windows = {
  W4: { bounds: box([4737, 12151], [6583, 6733]), limits: [4000, 4000, 4000, 3000] },
  W5: { bounds: box([5715, 11151], [3145, 3217]), limits: [4000, 4000] },
};
const cursors = { W4: [undefined], W5: [undefined] };
const rows = [];
let inFlight = 0;
let lastFailures = 0;
const started = Date.now();
const gpuBefore = gpu();
const samples = startSampler(pid);
await new Promise(done => setTimeout(done, 1500));

class StopRun extends Error {}

/** One GET through the product's route; the body is kept as text and parsed after the timing. */
async function get(phase, label, path, query = {}, signal) {
  const search = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, String(v)]));
  const url = `${API}/api/v1/areas/${areaId}/${path}?${search}`;
  const row = { phase, label, path, inFlightAtStart: inFlight++, startAt: Date.now() };
  const begin = performance.now();
  try {
    const response = await fetch(url, { signal });
    row.status = response.status;
    row.headersSeconds = Number(((performance.now() - begin) / 1000).toFixed(3));
    const text = await response.text();
    row.lastByteSeconds = Number(((performance.now() - begin) / 1000).toFixed(3));
    row.bytes = Buffer.byteLength(text);
    row.text = text;
  } catch (error) {
    row.aborted = signal?.aborted ?? false;
    row.error = row.aborted ? 'aborted by the client' : String(error.message).slice(0, 200);
    row.abortedAfterSeconds = Number(((performance.now() - begin) / 1000).toFixed(3));
  } finally {
    inFlight--;
    row.endAt = Date.now();
    rows.push(row);
  }
  return row;
}

/** Parses a kept body into features and `next`, checks the stop rule, and drops the text. */
function settle(row) {
  if (row.text !== undefined) {
    const body = JSON.parse(row.text);
    const data = body?.data ?? body;
    row.features = data?.features?.length ?? null;
    row.next = data?.next ? 'set' : null;
    if (row.status !== 200) row.refusal = { code: body?.error?.code ?? null, words: body?.error?.message ?? null };
    delete row.text;
    lastFailures = row.status === 200 ? 0 : lastFailures + 1;
    if (lastFailures >= 2) throw new StopRun(`Two answers in a row were not 200: ${row.label} ${row.status}`);
  }
  return row;
}

/** Reads a window's pages in order, keeping each `next` as the cursor of the following page. */
async function pages(phase, name) {
  const { bounds, limits } = windows[name];
  for (let index = 0; index < limits.length; index++) {
    const row = await get(phase, `${name} page ${index + 1}`, 'display-window',
      { ...bounds, after: cursors[name][index], limit: limits[index] });
    const next = row.text ? (JSON.parse(row.text)?.data ?? JSON.parse(row.text))?.next : null;
    if (next) cursors[name][index + 1] = next;
    settle(row);
  }
}

const sleep = ms => new Promise(done => setTimeout(done, ms));
const phases = [];
const mark = (name, from) => phases.push({ name, startAt: from, endAt: Date.now() });

const out = { at: new Date(started).toISOString(), api: API, areaId: '{areaId}', apiPid: pid,
  windows, gpuBefore };
try {
  let from = Date.now();
  // 1. Cold: the first window read since the API started, then both windows in order.
  await pages('1 cold', 'W4');
  await pages('1 cold', 'W5');
  mark('1 cold', from);
  const summary = await get('2 floor', 'display-summary', 'display-summary');
  const extent = (JSON.parse(summary.text)?.data ?? JSON.parse(summary.text))?.extent;
  settle(summary);
  out.centre = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2].map(value => Number(value.toFixed(1)));
  // 2. Warm, sequential: five rounds of the six pages; then the per-read floor, five reads each.
  from = Date.now();
  for (let round = 1; round <= 5; round++) {
    await pages(`2 warm r${round}`, 'W4');
    await pages(`2 warm r${round}`, 'W5');
  }
  mark('2 warm', from);
  from = Date.now();
  const centre = out.centre;
  for (let round = 1; round <= 4; round++) settle(await get('2 floor', 'display-summary', 'display-summary'));
  for (let round = 1; round <= 5; round++) {
    settle(await get('2 floor', '50 m window', 'display-window', { ...box(centre, [50, 50]), limit: 4000 }));
  }
  mark('2 floor', from);
  // 3. Concurrent: n copies of W4 page 2 started together, three rounds each, 5 s apart.
  from = Date.now();
  const w4p2 = { ...windows.W4.bounds, after: cursors.W4[1], limit: 4000 };
  for (const copies of [1, 2, 4, 8, 12]) {
    for (let round = 1; round <= 3; round++) {
      const batch = await Promise.all(Array.from({ length: copies }, (_, i) =>
        get(`3 concurrent x${copies} r${round}`, `W4 page 2 copy ${i + 1}`, 'display-window', w4p2)));
      batch.forEach(settle);
      await sleep(5000);
    }
  }
  mark('3 concurrent', from);
  // 4. Abandoned: six W4 page reads aborted after 0.5 s, then W5 page 2 alone at once; 20 s between rounds.
  from = Date.now();
  for (let round = 1; round <= 5; round++) {
    const controller = new AbortController();
    const abandoned = [0, 1, 2, 3, 0, 1].map((index, i) => get(`4 abandoned r${round}`,
      `W4 page ${index + 1} abandoned ${i + 1}`, 'display-window',
      { ...windows.W4.bounds, after: cursors.W4[index], limit: windows.W4.limits[index] }, controller.signal));
    await sleep(500);
    controller.abort();
    (await Promise.all(abandoned)).forEach(settle);
    settle(await get(`4 abandoned r${round}`, 'W5 page 2 after the abandoned', 'display-window',
      { ...windows.W5.bounds, after: cursors.W5[1], limit: windows.W5.limits[1] }));
    await sleep(20000);
  }
  mark('4 abandoned', from);
} catch (error) {
  out.stopped = String(error.message).slice(0, 300);
}
await sleep(1500);
await samples.stop();
for (const row of rows) {
  delete row.text;
  Object.assign(row, attribute(samples, row.startAt, row.endAt));
}
out.phases = phases;
out.requests = rows;
out.over10s = rows.filter(row => (row.lastByteSeconds ?? 0) > 10).length;
out.over3s = rows.filter(row => (row.lastByteSeconds ?? 0) > 3).length;
save('part-b-timing.json', out);
save('part-b-samples.json', { at: out.at, apiPid: pid, container: 'ulpin-reh-02-postgres-1',
  api: samples.api, postgres: samples.postgres });
console.log(JSON.stringify({ stopped: out.stopped ?? null, requests: rows.length, over3s: out.over3s,
  over10s: out.over10s, apiSamples: samples.api.length, postgresSamples: samples.postgres.length }));
