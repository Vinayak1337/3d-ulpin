import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { save, serving } from './audit.mjs';

// REH12's final product snapshot for the one act 1 case: the intake manifest against its contract, the evidence
// page against its contract, and every source hash against the recorded original. No runtime or database access.
const intake = await import(pathToFileURL(`${serving}/packages/contracts/src/usp/intake.ts`).href);
const caseId = '6e38560f-077a-4f70-bc0c-997e0c57e3ca';
const root = `/ingestion/cases/${caseId}`;
const expected = JSON.parse(readFileSync(new URL('./act1-files.json', import.meta.url), 'utf8')).files;

async function get(path, schema) {
  const response = await fetch(`http://127.0.0.1:21026/api/v1${path}`, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, path);
  const body = await response.json();
  const value = body.data ?? body;
  if (schema) schema.parse(value);
  return value;
}

function originalHashes(detail) {
  return detail.sources.map(source => {
    const original = expected.find(file => [file.path].flat().join('').endsWith(source.name));
    assert(original, `No retained input receipt for ${source.name}`);
    assert.equal(source.sha256, original.sha256, source.name);
    return { name: source.name, matchesOriginal: true };
  });
}

const detail = await get(`/cases/${caseId}`);
const manifest = await get(`${root}/intake`, intake.IntakeManifestSchema);
const evidence = await get(`${root}/intake/evidence`, intake.IntakeEvidencePageSchema);
writeFileSync('E:/BhuAayam-data/task-data/reh15/final-act1.json', JSON.stringify({ detail, evidence }), { flag: 'wx' });
save('final-state.json', { at: new Date().toISOString(), caseId,
  contracts: 'IntakeManifest, IntakeEvidencePage: passed', originalHashes: originalHashes(detail),
  evidence: { counts: evidence.counts,
    confirmations: evidence.confirmations.map(row => ({ id: row.confirmationId ?? row.id,
      accepted: row.accepted?.length ?? null })) },
  items: manifest.items.map(({ name, state, placement, partsDone, partsPlanned, limitReason }) => ({
    name, state, placement, partsDone, partsPlanned, limitReason })) });
console.log('Act 1 case: manifest and evidence contracts pass; every original hash is unchanged.');
