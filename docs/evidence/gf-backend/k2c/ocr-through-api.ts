import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  DocumentReceiptSchema, DocumentStatusSchema,
} from '../../../../packages/contracts/src/usp/document-ingestion';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k2c';
function save(name: string, value: unknown): void {
  writeFileSync(`${root}/${name}.json`, JSON.stringify(value) + '\n', { flag: 'wx' });
}
async function api(path: string, input?: unknown): Promise<unknown> {
  const response = await fetch(`${base}${path}`, input ? { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : undefined);
  const value = await response.json();
  assert(response.ok, `${response.status}: ${JSON.stringify(value)}`);
  return value;
}
async function retry(): Promise<void> {
  assert(!existsSync(`${root}/ocr-request.json`), 'One region attempt only; read existing evidence instead.');
  const pkg = JSON.parse(readFileSync('docs/evidence/gf-backend/k2/tower3-source-commit.json', 'utf8'));
  const cases = z.array(z.object({ id: z.uuid(), name: z.string(), siteId: z.string(),
    revision: z.number().int() })).parse(await api('/cases'));
  const record = cases.find((value: { name: string; siteId: string }) => value.name === pkg.name
    && value.siteId === pkg.areaId);
  assert(record);
  const source = pkg.documentPins[0];
  const input = { requestKey: randomUUID(), expectedCaseRevision: record.revision,
    expectedSourceRevision: source.sourceRevision, sourceSha256: source.sourceSha256,
    mode: 'native_only', ocrSelection: { page: 1, region: [280, 860, 960, 2580] } };
  save('ocr-request', input);
  const receipt = DocumentReceiptSchema.parse(await api(
    `/ingestion/cases/${record.id}/sources/${source.sourceId}/documents/retry`, input,
  ));
  save('ocr-receipt', receipt);
  console.log(JSON.stringify({ attemptId: receipt.jobId, queuedVia: 'document retry API' }));
}
async function capture(): Promise<void> {
  const receipt = JSON.parse(readFileSync(`${root}/ocr-receipt.json`, 'utf8'));
  const status = DocumentStatusSchema.parse(await api(
    `/ingestion/cases/${receipt.caseId}/sources/${receipt.sourceId}/documents/jobs/${receipt.jobId}`,
  ));
  const firstLines = status.ocrItems?.slice(0, 5).map((item: { text: string }) => item.text) ?? [];
  save('ocr-result', { attemptId: receipt.jobId, status: status.status, sourceSha256: receipt.sourceSha256,
    ocr: status.ocr, firstLines, qualification: 'Candidate observations only; no reviewed field or Hindi execution' });
  console.log(JSON.stringify({ attemptId: receipt.jobId, status: status.status,
    failure: status.ocr?.execution?.failure, issues: status.ocr?.issues, textLines: firstLines.length }));
  if (!status.ocr || !['complete', 'partial'].includes(status.ocr.toolStatus)) process.exitCode = 1;
}
if (process.argv[2] === 'retry') await retry();
else if (process.argv[2] === 'capture') await capture();
else throw new Error('Use retry or capture; no polling or repeated OCR execution.');
