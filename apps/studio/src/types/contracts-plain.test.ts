import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const usp = resolve(import.meta.dirname, '../../../../packages/contracts/src/usp');
const runtimeImports = /(?:^|\n)\s*(?:import|export)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;

/** The module as JavaScript, each runtime import resolved inside packages/contracts/src/usp to a data URL. */
function asDataUrl(name: string, seen: string[]): string {
  seen.push(name);
  const code = stripTypeScriptTypes(readFileSync(resolve(usp, `${name}.ts`), 'utf8'))
    .replace(runtimeImports, (statement: string, specifier: string) => {
      expect(specifier, `${name}.ts imports ${specifier}`).toMatch(/^\.\/[\w-]+$/);
      return statement.replace(specifier, asDataUrl(specifier.slice(2), seen));
    });
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}

it('loads the plain usp module without zod or any schema module', async () => {
  const seen: string[] = [];
  const url = asDataUrl('plain', seen);
  expect(seen).toEqual(['plain', 'intake-needs']);
  // A data URL resolves no package or file: any import left would fail here.
  const plain = await import(/* @vite-ignore */ url);
  const code = plain.projectCodeForPayload('0'.repeat(20));
  expect(plain.normalizeProjectCode(code.toLowerCase())).toBe(code);
  expect(plain.INTAKE_TABLE_READER_FORMATS).toEqual(['csv', 'tsv', 'xlsx', 'ods']);
  expect(plain.POINT_BATCH_RECORD_LENGTHS[6]).toBe(30);
});
