import { writeFileSync } from 'node:fs';
import { save } from './audit.mjs';

// The act 1 cards read back through the product API (as RC3's prove.mjs reads them): the confirmation's progress
// for both targets, each card's facts, its verification and its PDF. Whole bodies stay in scratch.
const api = 'http://127.0.0.1:21026/api/v1';
const caseId = '6e38560f-077a-4f70-bc0c-997e0c57e3ca';
const confirmationId = '0e8fb724-424b-4563-ab1b-afcd4ea2667a';
const scratch = 'E:/BhuAayam-data/task-data/reh15';
const cards = {
  cited: '06ec9d41-2fd4-4576-b375-70ee1543bc8b', footprintOnly: 'b26fad3c-2658-4e2c-9097-b7c55d55fd58' };

async function call(path, body) {
  const options = body ? { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) } : {};
  const response = await fetch(`${api}${path}`, { ...options, signal: AbortSignal.timeout(60000) });
  const value = await response.json();
  return { status: response.status, value: value.data ?? value };
}

async function card(name, id) {
  const view = await call('/usp/property-cards/read', { cardId: id, revision: 1 });
  const verification = await call(`/usp/property-cards/${id}/revisions/1/verification`);
  const pdf = await fetch(`${api}/usp/property-cards/${id}/revisions/1`, { signal: AbortSignal.timeout(60000) });
  const bytes = Buffer.from(await pdf.arrayBuffer());
  writeFileSync(`${scratch}/card-${name}.json`, JSON.stringify(view.value, null, 2));
  writeFileSync(`${scratch}/verification-${name}.json`, JSON.stringify(verification.value, null, 2));
  writeFileSync(`${scratch}/card-${name}.pdf`, bytes);
  return { id, read: view.status, verification: verification.status,
    pdf: { status: pdf.status, type: pdf.headers.get('content-type'), bytes: bytes.length } };
}

const confirmation = await call(`/ingestion/cases/${caseId}/confirmations/${confirmationId}`);
writeFileSync(`${scratch}/confirmation.json`, JSON.stringify(confirmation.value, null, 2));
const result = { at: new Date().toISOString(), confirmation: confirmation.status, cards: {} };
for (const [name, id] of Object.entries(cards)) result.cards[name] = await card(name, id);
save('cards-read.json', result);
console.log(JSON.stringify(result));
