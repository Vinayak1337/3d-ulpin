import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// Read-only audit check, not a runtime rehearsal or a substitute for one.
const audit = JSON.parse(readFileSync('docs/evidence/gf1/ca0/step0.json', 'utf8'));
const references = new Map();
for (const reference of audit.refs) {
  assert(!references.has(reference.id), 'Reference IDs must be unique.');
  const lines = readFileSync(reference.file, 'utf8').split(/\r?\n/);
  const [first, last] = reference.lines;
  assert(first > 0 && first <= last && last <= lines.length, reference.id);
  references.set(reference.id, lines.slice(first - 1, last).join('\n'));
}
for (const answer of audit.answers) {
  for (const id of answer.refs) assert(references.has(id), id);
}
assert.deepEqual(audit.answers.map(answer => answer.question), [1, 2, 3, 4, 5, 6]);
assert.deepEqual([audit.stop.a, audit.stop.b, audit.stop.c], [false, true, true]);

function contains(id, needle) {
  assert(references.get(id)?.includes(needle), `${id}: expected source condition`);
}

contains('source-case', 'INSERT INTO cases(id,name,description,frame)');
contains('retained-id', 'sourceId = retained?.id || randomUUID()');
contains('new-site-case', 'Boolean(retained)');
contains('new-site-case', 'if (!retained) await client.query(');
contains('package-insert', 'await assertPackageDocumentAuthority(client, pkg)');
contains('package-quarantine', 'scope.site_id!==scope.area_site');
contains('package-quarantine', "'AREA_SOURCE_DENIED'");
contains('target-sources', 'WHERE c.site_id=$1 AND s.id=ANY($2::uuid[])');
contains('plan-context', "conflict('The exact captured context is unavailable.')");
contains('declaration-site', 'site.site_id !== scope.scopeId');
contains('review-evidence', 'WHERE s.id=$1 AND c.site_id=$2');
contains('feature-policy', 'source.status === "inspected"');
contains('source-frame', 'const frame=source.inspection?.frame');
contains('jobs-admission', "'USP_JOB_OPERATION'");
assert(!references.get('jobs-admission').includes("job.operation==='intake-draft'"));
contains('document-capture', 'return {...source,inspection:{...(source.inspection??{})');
contains('manual-retain', "object_key,status,inspection) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'needs_input'");

const bytes = readFileSync(audit.input.path);
assert.equal(bytes.length, audit.input.bytes);
assert.equal(createHash('sha256').update(bytes).digest('hex'), audit.input.sha256);
assert.equal(JSON.parse(bytes.toString('utf8')).features.length, audit.input.sourceFeatures);
const folder = dirname(audit.input.path);
const otherVectors = readdirSync(folder)
  .filter(name => name.endsWith('.geojson') && name !== basename(audit.input.path))
  .map(name => ({ name, bytes: statSync(join(folder, name)).size }))
  .sort((left, right) => right.bytes - left.bytes);
assert.deepEqual(otherVectors[0], {
  name: audit.input.largestOtherVector.name, bytes: audit.input.largestOtherVector.bytes,
});
for (const name of ['step0.json', 'verify-step0.mjs']) {
  const lines = readFileSync(`docs/evidence/gf1/ca0/${name}`, 'utf8').split(/\r?\n/);
  assert(lines.every(line => line.length <= 120), `${name}: line width`);
}
console.log(JSON.stringify({ task: 'CA0', staticAudit: 'pass', references: references.size,
  answers: audit.answers.length, originalHashMatches: true, largestOtherVector: otherVectors[0],
  runtimeExecuted: false, stop: ['b', 'c'] }));
