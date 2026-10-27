import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DOCUMENT_LIMITS, documentScannedPages } from '../../../packages/contracts/src/usp/document-ingestion';

// Read-only comparison with the retained native page-coverage receipt, not an OCR accuracy measurement.
const require = createRequire(new URL('../../../packages/server/package.json', import.meta.url));
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const receipt = JSON.parse(await readFile(new URL('../gf1/g10/result.json', import.meta.url), 'utf8'));
const results = [];
for (const kind of ['good', 'difficult']) {
  const input = receipt.real_inputs[kind];
  const bytes = await readFile(input.path);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, input.sha256);
  assert(bytes.length <= DOCUMENT_LIMITS.nativeBytes);
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0,
    useSystemFonts: false, isEvalSupported: false, disableFontFace: true, stopAtErrors: true }).promise;
  const warnings: string[] = [];
  try {
    assert(document.numPages <= 100);
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      const text = content.items.flatMap((item: { str?: string }) => item.str ?? []).join(' ').trim();
      if (!text) warnings.push(`PDF page ${page} has no native text`);
    }
    const scanned = documentScannedPages({ format: 'pdf', status: 'extracted', warnings });
    assert.deepEqual(scanned, input.no_text_pages);
    const first = scanned.find(page => page <= DOCUMENT_LIMITS.ocrMaxPage);
    results.push({ kind, path: input.path, bytes: bytes.length, sha256: hash, pages: document.numPages,
      scannedPages: scanned, ocrSelection: first === undefined ? null : { page: first },
      scannedPagesLeft: scanned.length - (first === undefined ? 0 : DOCUMENT_LIMITS.ocrPages),
      permission: 'unconfirmed', originalUnchanged: true });
    assert.equal(createHash('sha256').update(await readFile(input.path)).digest('hex'), hash);
  } finally { await document.destroy(); }
}
process.stdout.write(JSON.stringify({ comparison: 'PDF.js text presence versus retained G10 native page coverage',
  scope: 'read-only native-text eligibility; no OCR or application runtime exercised', results }) + '\n');
