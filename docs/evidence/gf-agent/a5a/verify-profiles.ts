import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { prepareTable, type PreparedColumn, type TableInventory } from '../../../../scripts/agent/t1-profiles';
import { digest, sourceTables } from '../../../../scripts/agent/t1-sources';
import { columnProfileHash } from '../../../../packages/server/src/modules/usp/ingestion/mapping-teacher';

function reproduce(task: 't1' | 't1b', evidence: string) {
  const root = `E:/BhuAayam-data/task-data/${task}`;
  const recorded = JSON.parse(readFileSync(evidence, 'utf8')) as { profilesSha256: string };
  const path = join(root, 'profiles/profiles.jsonl');
  assert.equal(digest(path), recorded.profilesSha256, `${task}: recorded bytes changed`);
  const inventory = JSON.parse(readFileSync(join(root, 'verifier/inventory.json'), 'utf8')) as TableInventory[];
  const profiles: PreparedColumn[] = [];
  for (const entry of inventory) {
    const tables = sourceTables(entry.asset);
    const table = tables.find(candidate => candidate.name === entry.sheet);
    assert(table, `${task}: recorded table missing`);
    const prepared = prepareTable(entry.asset, table);
    assert.equal(columnProfileHash(prepared.inventory.profile), columnProfileHash(entry.profile));
    profiles.push(...prepared.profiles);
  }
  const bytes = profiles.map(profile => JSON.stringify(profile)).join('\n') + '\n';
  const reproducedSha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(reproducedSha256, recorded.profilesSha256, `${task}: reproduced bytes changed`);
  return { task, tables: inventory.length, columns: profiles.length, reproducedSha256, byteIdentical: true };
}

function verifyD1fBytes() {
  const recorded = JSON.parse(readFileSync('docs/evidence/gf-agent/d1f/result.json', 'utf8')) as {
    artifacts: Record<string, string>;
  };
  const products = ['profiles.jsonl', 'profile-links.jsonl', 'dictionary.jsonl',
    'profiles/summary.json', 'verifier/inventory.json'];
  for (const product of products) {
    assert.equal(digest(join('E:/BhuAayam-data/task-data/d1f', product)), recorded.artifacts[product]);
  }
  return { task: 'd1f', columns: 198, products: products.length,
    profilesSha256: recorded.artifacts['profiles.jsonl'], byteIdentical: true };
}

console.log(JSON.stringify([
  reproduce('t1', 'docs/evidence/gf-agent/t1/prep.json'),
  reproduce('t1b', 'docs/evidence/gf-agent/t1b/result.json'),
  verifyD1fBytes(),
]));
