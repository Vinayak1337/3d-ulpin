import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { buildInventory, checkInventory, inspectSeam, repositoryRoot, seams, writeInventory } from '../scripts/usp/gf/GF-CONTRACT.mjs';

test('current inventory names every required seam with source evidence and explicit production gaps', async () => {
  const inventory = await buildInventory(repositoryRoot);
  assert.deepEqual(inventory.rows.map(row => row.id), ['schema', 'registry', 'source', 'geometry', 'job', 'sse', 'ui']);
  for (const row of inventory.rows) {
    assert.equal(row.fileEvidence.producer.markerFound, true, `${row.id} producer`);
    assert.equal(row.fileEvidence.contract.markerFound, true, `${row.id} contract`);
    assert.equal(row.fileEvidence.test.markerFound, true, `${row.id} test`);
    assert.match(row.testCommand, /^(pnpm|node) /);
  }
  assert.equal(inventory.rows.find(row => row.id === 'job').consumer, null);
  assert.equal(inventory.rows.find(row => row.id === 'sse').status, 'missing');
  assert.equal(await checkInventory(repositoryRoot), true);
});

test('missing production consumer or test evidence changes the reported status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gf-contract-test-'));
  try {
    const spec = { ...seams[0], producer: 'producer.ts', producerMarker: 'produce()',
      consumer: 'consumer.ts', consumerMarker: 'produce()', contract: 'contract.ts', contractMarker: 'shape',
      test: 'test.ts', testMarker: 'assert', declaredStatus: 'works' };
    for (const [name, body] of [['producer.ts', 'produce()'], ['consumer.ts', 'produce()'],
      ['contract.ts', 'shape'], ['test.ts', 'assert']]) await writeFile(join(root, name), body);
    assert.equal((await inspectSeam(root, spec)).status, 'works');
    const noConsumer = await inspectSeam(root, { ...spec, consumer: null, consumerMarker: null });
    assert.equal(noConsumer.status, 'partial');
    assert.deepEqual(noConsumer.problems, ['production_consumer_not_found']);
    await rm(join(root, 'consumer.ts'));
    assert.deepEqual((await inspectSeam(root, spec)).problems, ['consumer_file_missing']);
    assert.equal((await inspectSeam(root, spec)).status, 'missing');
    await writeFile(join(root, 'consumer.ts'), 'produce()');
    await rm(join(root, 'test.ts'));
    assert.deepEqual((await inspectSeam(root, spec)).problems, ['test_file_missing']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('inventory check rejects changed producer bytes and stale receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gf-contract-test-'));
  try {
    const spec = { ...seams[0], producer: 'p.ts', producerMarker: 'produce',
      consumer: 'c.ts', consumerMarker: 'consume', contract: 'contract.ts', contractMarker: 'shape',
      test: 'test.ts', testMarker: 'assert', declaredStatus: 'works' };
    for (const [name, body] of [['p.ts', 'produce'], ['c.ts', 'consume'],
      ['contract.ts', 'shape'], ['test.ts', 'assert']]) await writeFile(join(root, name), body);
    const path = 'evidence/inventory.json';
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeInventory(root, path, [spec]);
    assert.equal(await checkInventory(root, path, [spec]), true);
    const before = await readFile(join(root, path), 'utf8');
    await writeFile(join(root, 'p.ts'), 'produce changed');
    await assert.rejects(checkInventory(root, path, [spec]), /stale/);
    assert.equal(await readFile(join(root, path), 'utf8'), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
