import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

assert.deepEqual(process.argv.slice(2, 4), ['--runtime', 'ulpin-reh-01']);
const require = createRequire(import.meta.url);
const compilerPath = require.resolve('esbuild', { paths: [dirname(require.resolve('tsx'))] });
const { build } = await import(pathToFileURL(compilerPath).href);
const directory = 'E:/BhuAayam-data/task-data/reh1';
mkdirSync(directory, { recursive: true });
const part = process.argv[4] ?? 'b';
assert(['b', 'c1', 'c2', '--compile-only'].includes(part));
const entry = part.startsWith('c') ? 'part-c.ts' : 'journey.ts';
const output = `${directory}/journey-${Date.now()}.mjs`;
await build({
  entryPoints: [`docs/evidence/runtime/reh1/${entry}`], outfile: output,
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  define: { 'import.meta.env': '{"DEV":false}' }, logLevel: 'warning',
});
console.log('Journey compiled with the actual Studio builders; no application/runtime file was edited.');
if (!process.argv.includes('--compile-only')) {
  globalThis.location = new URL('http://127.0.0.1:21016');
  await import(pathToFileURL(output).href);
}
