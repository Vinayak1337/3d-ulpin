import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

// RC3 runtime proof on ulpin-reh-02, through the product API. `cited`: the Studio's retry of the stopped act 1
// confirmation, whose building gains its confirmed register row, then its card. `uncited`: a cards-only
// confirmation of one recorded building of the same case with no confirmed row. Bodies stay in scratch.
const api = 'http://127.0.0.1:21026/api/v1';
const caseId = '2398f7be-d1fb-4453-ae8d-4c688d85cfad';
const confirmationId = 'c167989e-b6f3-4a42-85f0-cc41c7ba7525';
const citedTarget = '0098370d-b3cd-5e84-af85-637d96cd2f49';
const scratch = 'E:/BhuAayam-data/task-data/rc3';
const ingestion = `${api}/ingestion/cases/${caseId}`;

/** A POST carries a JSON body as the Studio sends it (apps/studio/src/features/intake/run/api.ts). */
async function call(url, method = 'GET', body = {}) {
  const post = method === 'POST'
    ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : {};
  const response = await fetch(url, { method, ...post, signal: AbortSignal.timeout(60000) });
  const value = await response.json();
  return { status: response.status, value: value.data ?? value };
}

function progress(value, targetId) {
  const target = value.progress.find(item => item.targetId === targetId);
  return { targetId, stage: target.stage, readiness: target.readiness, blockedBy: target.blockedBy,
    reason: target.reason, artefacts: target.artefacts };
}

/** Waits for the target to settle, reading its confirmation every three seconds for at most ten minutes. */
async function settled(confirmation, targetId) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const read = progress((await call(confirmation)).value, targetId);
    if (['carded', 'stopped'].includes(read.readiness)) return read;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('The target did not settle within ten minutes.');
}

/** The card's facts, its verification and the resolved one-page PDF, each kept whole in scratch. */
async function card({ id, revision }) {
  const view = await call(`${api}/usp/property-cards/read`, 'POST', { cardId: id, revision });
  const resolved = `${api}/usp/property-cards/${id}/revisions/${revision}`;
  const verification = await call(`${resolved}/verification`);
  const pdf = await fetch(resolved, { signal: AbortSignal.timeout(60000) });
  writeFileSync(`${scratch}/card-${id}-${revision}.json`, JSON.stringify(view.value, null, 2));
  writeFileSync(`${scratch}/verification-${id}-${revision}.json`, JSON.stringify(verification.value, null, 2));
  writeFileSync(`${scratch}/card-${id}-${revision}.pdf`, Buffer.from(await pdf.arrayBuffer()));
  return { id, revision, read: view.status, verification: verification.status,
    resolved: { status: pdf.status, type: pdf.headers.get('content-type') } };
}

/** The retry is pressed only while the target is stopped, so a second run reads without retrying. */
async function cited() {
  const confirmation = `${ingestion}/confirmations/${confirmationId}`;
  const before = progress((await call(confirmation)).value, citedTarget);
  const retry = before.readiness === 'stopped' ? (await call(`${confirmation}/retry`, 'POST')).status : null;
  const after = await settled(confirmation, citedTarget);
  return { before, retry, after, card: after.artefacts.card ? await card(after.artefacts.card) : null };
}

async function uncited() {
  const page = (await call(`${ingestion}/targets?readiness=recorded`)).value;
  const target = page.items.find(item => item.targetId !== citedTarget && !item.artefacts.card
    && !item.artefacts.evidence);
  const input = { requestKey: randomUUID(), packages: [], targets: [target.targetId],
    acknowledgement: 'RC3 rehearsal: card this recorded building from its footprints alone.' };
  const stored = await call(`${ingestion}/confirmations`, 'POST', input);
  const confirmation = `${ingestion}/confirmations/${stored.value.confirmationId}`;
  const after = await settled(confirmation, target.targetId);
  return { counts: page.counts, before: { targetId: target.targetId, locator: target.locator,
    readiness: target.readiness, artefacts: target.artefacts }, requestKey: input.requestKey,
  confirmation: { status: stored.status, id: stored.value.confirmationId }, after,
  card: after.artefacts.card ? await card(after.artefacts.card) : null };
}

const step = process.argv[2];
const result = { at: new Date().toISOString(), step, ...await ({ cited, uncited })[step]() };
writeFileSync(`${scratch}/prove-${step}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
