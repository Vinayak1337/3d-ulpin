import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';

const src = resolve(import.meta.dirname, '../../../../packages/contracts/src');
const runtimeImports = /(?:^|\n)\s*(?:import|export)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;

/** The module as JavaScript, each runtime import resolved inside packages/contracts/src to a data URL. */
function asDataUrl(name: string, seen: string[]): string {
  seen.push(name);
  const code = stripTypeScriptTypes(readFileSync(resolve(src, `${name}.ts`), 'utf8'))
    .replace(runtimeImports, (statement: string, specifier: string) => {
      expect(specifier, `${name}.ts imports ${specifier}`).toMatch(/^\.\/[\w/-]+$/);
      const target = relative(src, resolve(src, dirname(name), specifier)).replaceAll('\\', '/');
      return statement.replace(specifier, asDataUrl(target, seen));
    });
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}

it('loads the plain usp module without zod or any schema module', async () => {
  const seen: string[] = [];
  const url = asDataUrl('usp/plain', seen);
  expect(seen).toEqual(['usp/plain', 'usp/intake-needs']);
  // A data URL resolves no package or file: any import left would fail here.
  const plain = await import(/* @vite-ignore */ url);
  const code = plain.projectCodeForPayload('0'.repeat(20));
  expect(plain.normalizeProjectCode(code.toLowerCase())).toBe(code);
  expect(plain.INTAKE_TABLE_READER_FORMATS).toEqual(['csv', 'tsv', 'xlsx', 'ods']);
  expect(plain.POINT_BATCH_RECORD_LENGTHS[6]).toBe(30);
});

/** Each value of reader-limits.ts and the schema module it was moved from, which re-exports it. */
const READER_LIMIT_HOMES: Record<string, string> = {
  INTAKE_TABLE_READER_FORMATS: 'usp/intake', STREAMING_VECTOR_LIMITS: 'usp/streaming-vector',
  NATIVE_GIS_LIMITS: 'upload-reader-limits', RASTER_WINDOW_LIMITS: 'usp/raster-window',
  POINT_BATCH_LIMITS: 'usp/point-batch', IFC_LIMITS: 'usp/ifc-ingestion', DOCUMENT_PAGE_LIMITS: 'document-pages',
  DOCUMENT_LIMITS: 'usp/document-ingestion', documentScannedPages: 'usp/document-ingestion',
  DXF_LIMITS: 'usp/dxf-ingestion', CITYGML_LIMITS: 'usp/citygml-ingestion',
  CITYJSON_LIMITS: 'usp/cityjson-ingestion', GLTF_LIMITS: 'usp/gltf-ingestion', OBJ_LIMITS: 'usp/obj-ingestion',
  TABULAR_LIMITS: 'usp/ingestion', TABULAR_STREAM_LIMITS: 'usp/ingestion', LARGE_ORIGINAL_LIMITS: 'usp/ingestion',
  LARGE_ORIGINAL_V2_LIMITS: 'usp/ingestion', INTAKE_FORMAT_NAMES: 'usp/intake',
  INTAKE_LEGACY_WORKBOOK_WORDS: 'usp/intake', INTAKE_PAGE_IMAGE_LIMITS: 'usp/intake',
  INTAKE_TARGET_LIMITS: 'usp/intake', INTAKE_EVIDENCE_LIMITS: 'usp/intake',
};

it('loads the reader limits without zod or any schema module, with the values their old homes export', async () => {
  const seen: string[] = [];
  const url = asDataUrl('reader-limits', seen);
  expect(seen).toEqual(['reader-limits', 'usp/intake-needs']);
  const limits = await import(/* @vite-ignore */ url);
  expect(Object.keys(limits).sort()).toEqual(Object.keys(READER_LIMIT_HOMES).sort());
  for (const [name, home] of Object.entries(READER_LIMIT_HOMES)) {
    const old: Record<string, unknown> = await import(/* @vite-ignore */ resolve(src, `${home}.ts`));
    expect(typeof limits[name], name).toBe(typeof old[name]);
    if (typeof old[name] === 'function') continue;
    expect(limits[name], name).toEqual(old[name]);
    expect(Object.isFrozen(limits[name]), name).toBe(Object.isFrozen(old[name]));
  }
  const native = { format: 'pdf', status: 'needs_ocr', warnings: ['PDF page 3 has no native text', 'PDF page 1'] };
  const old = await import(/* @vite-ignore */ resolve(src, 'usp/document-ingestion.ts'));
  expect(limits.documentScannedPages(native)).toEqual(old.documentScannedPages(native));
  expect(limits.documentScannedPages(native)).toEqual([3]);
});
