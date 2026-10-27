import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { cityjsonReaderSha } from '../../../packages/server/src/modules/usp/ingestion/cityjson';
import { compareSourcePins } from '../../../packages/server/src/modules/usp/ingestion/source-pin';

function previousReaderSha(): string {
  const files = ['native_cityjson.py', 'cityjson_processing.py'];
  const bytes = files.map(file => execFileSync('git', ['show', `5761865a:services/geo/geo/${file}`]));
  return createHash('sha256').update(Buffer.concat(bytes)).digest('hex');
}

test('TypeScript and the isolated Python reader_sha hash the same current file bytes', () => {
  const program = [
    'import runpy, sys',
    'sys.path.insert(0, "services/geo")',
    'checks = runpy.run_path("services/geo/tests/test_cityjson_processing_pins.py")["isolated_pin_checks"]()',
    'print(checks["reader_sha"]())',
  ].join('\n');
  const python = execFileSync('python', ['-B', '-c', program], { encoding: 'utf8' }).trim();
  assert.equal(cityjsonReaderSha(), python);
});

test('the key allowlist change moves the reader pin and cannot silently reuse the previous pin', () => {
  const previous = previousReaderSha();
  const current = cityjsonReaderSha();
  assert.notEqual(current, previous);
  const compared = compareSourcePins(
    { caseRevision: 2, readerSha256: current },
    { caseRevision: 1, readerSha256: previous },
  );
  assert.equal(compared.current, false);
  assert.deepEqual(compared.moved, ['readerSha256']);
});
