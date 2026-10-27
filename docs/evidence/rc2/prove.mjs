import { writeFileSync } from 'node:fs';

// RC2 runtime proof on ulpin-reh-02: the Studio's retry of the stopped act 1 confirmation, then the card it makes,
// read and verified through the product API. The full card body stays in scratch; the summary is printed.
const api = 'http://127.0.0.1:21026/api/v1';
const caseId = '2398f7be-d1fb-4453-ae8d-4c688d85cfad';
const confirmationId = 'c167989e-b6f3-4a42-85f0-cc41c7ba7525';
const scratch = 'E:/BhuAayam-data/task-data/rc2';
const confirmation = `${api}/ingestion/cases/${caseId}/confirmations/${confirmationId}`;

/** A POST carries the empty JSON body the Studio sends (apps/studio/src/features/intake/run/api.ts). */
async function call(url, method = 'GET') {
  const post = method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {};
  const response = await fetch(url, { method, ...post, signal: AbortSignal.timeout(60000) });
  const body = await response.json();
  return { status: response.status, value: body.data ?? body };
}

function progress(value) {
  const [target] = value.progress;
  return { targetId: target.targetId, stage: target.stage, readiness: target.readiness,
    blockedBy: target.blockedBy, reason: target.reason, artefacts: target.artefacts };
}

/** Waits for the retried target to settle, reading the confirmation every three seconds for at most ten minutes. */
async function settled() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const read = progress((await call(confirmation)).value);
    if (['carded', 'stopped'].includes(read.readiness)) return read;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error('The retried target did not settle within ten minutes.');
}

const before = progress((await call(confirmation)).value);
const retry = await call(`${confirmation}/retry`, 'POST');
const after = await settled();
const result = { at: new Date().toISOString(), before, retry: { status: retry.status, progress: progress(retry.value) },
  after };
if (after.artefacts.card) {
  const { id, revision } = after.artefacts.card;
  const card = await call(`${api}/usp/property-cards/${id}/revisions/${revision}`);
  const verification = await call(`${api}/usp/property-cards/${id}/revisions/${revision}/verification`);
  writeFileSync(`${scratch}/card-${id}-${revision}.json`, JSON.stringify(card.value, null, 2));
  writeFileSync(`${scratch}/verification-${id}-${revision}.json`, JSON.stringify(verification.value, null, 2));
  result.card = { id, revision, status: card.status, verificationStatus: verification.status };
}
writeFileSync(`${scratch}/prove.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
