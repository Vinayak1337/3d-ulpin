import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as readerLimits from '../packages/contracts/src/upload-reader-limits.ts';

test('native GIS conversion shares the large vector path\'s 1 GiB source ceiling', () => {
  assert.equal(readerLimits.NATIVE_GIS_LIMITS.sourceBytes, readerLimits.STREAMING_VECTOR_LIMITS.sourceBytes);
  assert.equal(readerLimits.NATIVE_GIS_LIMITS.sourceBytes, 1024 ** 3);
});

test('upload reader declarations match runtime exports and expose finite numeric limits', () => {
  const declarations = readFileSync(
    new URL('../packages/contracts/src/upload-reader-limits.d.ts', import.meta.url),
    'utf8',
  );
  const runtime: Record<string, unknown> = readerLimits;
  const declaredExports = [...declarations.matchAll(
    /^\s*export\s+declare\s+(const|function)\s+([A-Za-z_$][\w$]*)\b/gm,
  )];
  assert.deepEqual(
    [...new Set(declaredExports.map(match => match[2]))].sort(),
    Object.keys(runtime).sort(),
    'Declaration and runtime export names must match',
  );

  for (const [, kind, name] of declaredExports) {
    if (kind === 'function') {
      assert.equal(typeof runtime[name], 'function', `${name} must be a function`);
    }
  }

  const objects = declarations.matchAll(
    /export\s+declare\s+const\s+([A-Za-z_$][\w$]*)\s*:\s*Readonly\s*<\s*\{([^}]*?)\}\s*>/g,
  );
  for (const [, name, body] of objects) {
    const value = runtime[name];
    assert(value !== null && typeof value === 'object', `${name} must be an object`);
    for (const [, key] of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*number\b/g)) {
      assert(Object.hasOwn(value, key), `${name}.${key} must exist at runtime`);
      assert(Number.isFinite(Reflect.get(value, key)), `${name}.${key} must be a finite number`);
    }
  }
});
