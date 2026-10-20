import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { createContractValidator } from '../../local/contract';
import { WaitingFiles, waitingFiles } from './BatchPage';
import type { BatchLocationState } from './retain-batch';
import { UnfinishedUploads, uploadsKey } from './UnfinishedUploads';
import { keepWaiting, readWaiting, type UploadEntry } from './upload-model';

const root = resolve(import.meta.dirname, '../../../../..');
const openapi = JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
const caseId = '04000000-0000-4000-8000-000000000001';
// The facts of the real Niagara Falls footprint GeoJSON (docs/api/datasets.json) with two of its four parts received.
const entry: UploadEntry = { id: '04000000-0000-4000-8000-000000000002',
  filename: 'Niagara_Falls_Building_Footprints_2018_1330698285055863645.geojson', bytes: 26_660_992,
  sha256: 'a'.repeat(64), profile: 'large-original/1', state: 'receiving', receivedParts: 2, partCount: 4,
  expiresAt: '2026-10-22T00:00:00.000Z', revision: 9, currentCaseRevision: 3 };

function renderUploads(uploads: UploadEntry[]) {
  const client = new QueryClient();
  client.setQueryData(uploadsKey(caseId), { uploads });
  return renderToStaticMarkup(<QueryClientProvider client={client}>
    <UnfinishedUploads caseId={caseId} refresh={() => undefined} />
  </QueryClientProvider>);
}

it('lists an unfinished upload in words with keyboard buttons to resume or cancel it, and nothing when none', () => {
  expect(validate('GET_ingestion_cases_caseId_uploads_Response_200_application_json', { uploads: [entry] }))
    .toEqual([]);
  const html = renderUploads([entry]);
  expect(html).toContain('<h2 class="ul-heading">Uploads not finished</h2>');
  expect(html).toContain('Niagara_Falls_Building_Footprints_2018_1330698285055863645.geojson</span>, 25.4 MiB. '
    + '2 of 4 parts received. Expires on 22 Oct 2026, 05:30.');
  expect(html).toMatch(/<button[^>]*aria-label="Resume Niagara[^"]*"[^>]*>Resume<\/button>/);
  expect(html).toMatch(/<button[^>]*aria-label="Cancel upload of Niagara[^"]*"[^>]*>Cancel upload<\/button>/);
  expect(html).toContain('tabindex="-1" aria-hidden="true"');
  const cancelling = renderUploads([{ ...entry, state: 'aborting' }]);
  expect(cancelling).toContain('Being cancelled; the slot frees when its parts are cleaned.');
  expect(cancelling).not.toContain('<button');
  expect(renderUploads([])).toBe('');
});

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {
    values.set(key, value);
  }, removeItem: (key: string) => values.delete(key), values } as unknown as Storage & { values: Map<string, string> };
}

it('the files not added and the files still to add show as words after a reload; Dismiss clears them', () => {
  const storage = memoryStorage();
  const state: BatchLocationState = {
    outcomes: [{ name: 'kept.geojson', sizeBytes: 1_024, state: 'enrolled' },
      { name: entry.filename, sizeBytes: entry.bytes, state: 'not_enrolled', message: 'Upload cancelled.' }],
    remainingFiles: [new File([new Uint8Array(2_048)], 'later.csv')],
  };
  keepWaiting(() => storage, caseId, waitingFiles(state));
  expect([...storage.values.values()].join()).not.toContain('kept.geojson');
  const reloaded = readWaiting(() => storage, caseId);
  const html = renderToStaticMarkup(<WaitingFiles files={reloaded} dismiss={() => undefined} />);
  expect(html).toContain(`These files were waiting when the page reloaded: ${entry.filename}, later.csv. Pick them`
    + ' again to add them.');
  expect(html).toContain(`<li>${entry.filename}, 25.4 MiB: Upload cancelled.</li>`);
  expect(html).toContain('>Dismiss</button>');
  keepWaiting(() => storage, caseId, []);
  expect(readWaiting(() => storage, caseId)).toEqual([]);
  expect(storage.values.size).toBe(0);
});

it('a storage that throws or holds other words leaves the page working with nothing to show', () => {
  const denied = () => { throw new DOMException('Storage is disabled.', 'SecurityError'); };
  const full = { ...memoryStorage(), setItem: () => { throw new DOMException('Full.', 'QuotaExceededError'); } };
  expect(() => keepWaiting(denied, caseId, [{ name: 'a.tif', sizeBytes: 1, words: null }])).not.toThrow();
  expect(() => keepWaiting(() => full, caseId, [{ name: 'a.tif', sizeBytes: 1, words: null }])).not.toThrow();
  expect(readWaiting(denied, caseId)).toEqual([]);
  const other = memoryStorage();
  other.setItem(`ulpin.batch-waiting.${caseId}`, '{not json');
  expect(readWaiting(() => other, caseId)).toEqual([]);
  other.setItem(`ulpin.batch-waiting.${caseId}`, JSON.stringify([{ name: 'a.tif' }, 7]));
  expect(readWaiting(() => other, caseId)).toEqual([]);
  expect(renderToStaticMarkup(<WaitingFiles files={[]} dismiss={() => undefined} />)).toBe('');
});
