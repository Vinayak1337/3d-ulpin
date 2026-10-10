import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import type { TargetPin } from '@ulpin/contracts/usp';
import { SourceSpaceControl, retainedTower } from '../officer/source-spaces.test-fixture';
import { control } from './source-stated-identity.test-fixture';
import { localRequestContext } from './principal';
import { captureRegistrySnapshot, captureRegistrySnapshotTx } from './snapshots';

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const receipt = json('docs/evidence/gf-backend/k2/tower3-source-import.json');
const frame = json('docs/evidence/gf1/k4a/site-readiness.json').sites[1].frame;
const golden = json('docs/evidence/gf1/ca2/site-golden.json');
const ctx = () => localRequestContext('ca2-snapshot-protocol');
const protocolId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const pin = (id: string, revision = 1): TargetPin => ({ ref: { namespace: 'registry_record', id }, revision });

/** Retained Tower 3 bodies/hashes and explicit protocol-only rows; no database or object I/O. */
class SnapshotControl {
  site = { id: retainedTower.areaId, identifier: 'CA2-PROTOCOL', revision: 4, frame };
  records: any[] = new SourceSpaceControl().rows.map(row => ({ ...row,
    project_code: null, project_status: null, project_location: null }));
  features: any[] = [{ id: retainedTower.buildingId, area_id: retainedTower.areaId,
    record_id: retainedTower.buildingId, identifier: receipt.features[0].identifier,
    revision: 4, body: receipt.features[0], geometry: null, geographic_geometry: null }];
  sources: any[] = receipt.documentPins.map((document: any, index: number) => ({ id: document.sourceId,
    case_id: receipt.caseId, revision: document.sourceRevision, sha256: document.sourceSha256,
    bytes: [3782332, 1655334, 2448909, 1630108][index], inspection: {} }));
  packages: any[] = [{ featureIds: [retainedTower.buildingId],
    document_pins: receipt.documentPins, parts: [] }];
  qualifications: any[] = [];
  aliases: any[] = [];
  lineage: any[] = [];
  declarations: any[] = [];
  entries: any[] = [];
  applicability: any[] = [];
  queries: string[] = [];
  bodies: any[] = [];

  private recordRows(values: any[]) {
    if (!values[1]) return this.records.slice(0, 1001);
    const ids = new Set<string>(values[1]);
    for (const id of ids) {
      const row = this.records.find(record => record.id === id && record.site_id === values[0]);
      if (!row || row.revision < 1) continue;
      const parents = [row.body.sourceOnly?.parentId, row.body.sourceOnly?.buildingId,
        ...(row.body.links ?? []).filter((link: any) => ['within', 'floor', 'serves', 'crosses'].includes(link.type))
          .map((link: any) => link.targetId)];
      for (const parent of parents) if (parent) ids.add(parent);
    }
    const rows = this.records.filter(row => ids.has(row.id) && row.site_id === values[0] && row.revision > 0);
    return rows.sort((a, b) => Number(values[1].includes(b.id)) - Number(values[1].includes(a.id))).slice(0, 1001);
  }

  private declarationRows(values: any[]) {
    if (!values[1]) return this.declarations;
    return this.declarations.filter(row => {
      const { input, review } = row.body;
      const targets = [...input.population.targets, ...input.entries.map((entry: any) => entry.target),
        ...review.applicability.map((app: any) => app.target)];
      return targets.some(target => values[1].includes(target.ref.id));
    });
  }

  private reads(query: string, values: any[]): any[] | null {
    if (query.startsWith('SELECT * FROM registry_sites')) return [this.site];
    if (query.startsWith('SELECT r.*,c.')) return this.recordRows(values);
    if (query.startsWith('SELECT f.id,f.area_id')) {
      return this.features.filter(feature => !values[1] || values[1].includes(feature.record_id)).slice(0, 1001);
    }
    if (query.startsWith('SELECT s.* FROM sources')) {
      return this.sources.filter(source => !values[1] || values[1].includes(source.id)).slice(0, 2001);
    }
    if (query.startsWith('SELECT * FROM sources')) return this.sources.filter(source => source.id === values[0]);
    if (query.startsWith('SELECT case_id,body')) {
      if (query.includes('document_pins')) return this.packages.filter(pkg =>
        pkg.featureIds.some((id: string) => values[0].includes(id)));
      return this.packages;
    }
    if (query.startsWith('SELECT DISTINCT ON(q.')) return this.qualifications.filter(row => !values[1]
      || (row.namespace === 'registry_record' ? values[1] : values[2]).includes(row.record_id));
    if (query.startsWith('SELECT DISTINCT ON(id)')) return this.declarationRows(values);
    if (query.includes('FROM usp_declaration_entries')) return this.entries.filter(row =>
      row.declaration_id === values[0] && row.declaration_revision === values[1]);
    if (query.includes('FROM usp_declaration_applicability')) return this.applicability.filter(row =>
      row.declaration_id === values[0] && row.declaration_revision === values[1]
      && (!values[2] || values[2].includes(row.body.target.ref.id)));
    if (query.startsWith('SELECT predecessor_id')) return this.lineage.filter(row =>
      !values[1] || values[1].includes(row.predecessor_id));
    if (query.startsWith('SELECT record_id,alias')) return this.aliases.filter(row =>
      !values[1] || values[1].includes(row.record_id));
    return null;
  }

  async query(sql: string, values: any[] = []): Promise<any> {
    const query = sql.replace(/\s+/g, ' ').trim();
    this.queries.push(query);
    let rows = this.reads(query, values);
    if (query.startsWith('INSERT INTO usp_snapshot_bodies')) {
      this.bodies.push({ namespace: values[1], id: values[2], revision: values[3], body: values[5] });
      rows = [];
    } else if (query.startsWith('INSERT INTO usp_snapshots')) rows = [];
    if (rows === null) throw new Error(`Unimplemented snapshot query: ${query}`);
    return { rows: structuredClone(rows), rowCount: rows.length };
  }

  capture(selection: { kind: 'site' } | { kind: 'targets'; pins: readonly TargetPin[] }) {
    return captureRegistrySnapshotTx(this as unknown as PoolClient, ctx(), this.site.id, selection);
  }
}

async function local(work: () => Promise<void>) {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'ca2-offline-protocol';
  try { await work(); }
  finally {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
}

function hierarchy() {
  const memory = new SnapshotControl();
  const building = memory.records[0];
  const floor = { ...building, id: protocolId(1), kind: 'floor', revision: 1,
    body: { links: [{ type: 'within', targetId: building.id }], evidence: [] } };
  const space = { ...floor, id: protocolId(2), kind: 'space', body: {
    links: [{ type: 'floor', targetId: floor.id }],
    evidence: [{ sourceId: memory.sources[1].id, locator: 'protocol-only locator' }] } };
  memory.records.push(floor, space);
  memory.packages[0].document_pins = [receipt.documentPins[2]];
  return { memory, floor, space, building, selection: { kind: 'targets' as const, pins: [pin(space.id)] } };
}

function unrelated(memory: SnapshotControl, recordCount: number, sourceCount: number) {
  while (memory.records.length < recordCount) memory.records.push({ ...memory.records[0],
    id: protocolId(100 + memory.records.length), body: { links: [], evidence: [], synthetic: true } });
  while (memory.sources.length < sourceCount) memory.sources.push({ ...memory.sources[0],
    id: protocolId(10000 + memory.sources.length), case_id: protocolId(9999) });
}

test('small site members and digest remain identical to the recorded staging capture', async () => local(async () => {
  // Golden origin: 944f7a22 captureRegistrySnapshotTx, run before any production edit in this task.
  const snapshot = await new SnapshotControl().capture({ kind: 'site' });
  assert.equal(snapshot.digest, golden.digest);
  assert.deepEqual(snapshot.members, golden.members);
}));

test('one space can be captured on a 1200-record 2100-source site; the site is still refused',
  async () => local(async () => {
    const { memory, selection, space } = hierarchy();
    unrelated(memory, 1200, 2100);
    const snapshot = await memory.capture(selection);
    assert(snapshot.members.some(member => member.pin.ref.id === space.id));
    assert.equal(snapshot.members.length, 8);
    await assert.rejects(memory.capture({ kind: 'site' }), { status: 413, code: 'USP_SCOPE_LIMIT' });
  }));

test('space closure holds only its level, building, feature, cited/package sources and stable site',
  async () => local(async () => {
    const { memory, selection, floor, space, building } = hierarchy();
    unrelated(memory, 4, 5);
    const snapshot = await memory.capture(selection);
    const ids = (namespace: string) => snapshot.members.filter(member => member.pin.ref.namespace === namespace)
      .map(member => member.pin.ref.id).sort();
    assert.deepEqual(ids('registry_record'), [space.id, floor.id, building.id].sort());
    assert.deepEqual(ids('area_feature'), [building.id]);
    assert.deepEqual(ids('source_revision'), memory.sources.slice(0, 3).map(source => source.id).sort());
    const site = memory.bodies.find(row => row.namespace === 'registry_site');
    assert.equal(site.revision, 0);
    assert.deepEqual(site.body, { id: memory.site.id, identifier: memory.site.identifier, frame });
  }));

test('a file in another case and an unrelated record/site revision leave the scoped digest unchanged',
  async () => local(async () => {
    const { memory, selection } = hierarchy();
    unrelated(memory, 4, 5);
    const first = await memory.capture(selection);
    memory.records[3].revision++;
    memory.site.revision++;
    unrelated(memory, 4, 6);
    assert.equal((await memory.capture(selection)).digest, first.digest);
  }));

test('a cited source revision changes the digest; a changed or absent target refuses its old pin',
  async () => local(async () => {
    const { memory, selection, space } = hierarchy();
    const first = await memory.capture(selection);
    memory.sources[1].revision++;
    const superseded = await memory.capture(selection);
    assert.notEqual(superseded.digest, first.digest);
    space.revision++;
    await assert.rejects(memory.capture(selection), { status: 409, code: 'USP_STALE_TARGET' });
    const revised = await memory.capture({ kind: 'targets', pins: [pin(space.id, 2)] });
    assert.notEqual(revised.digest, superseded.digest);
    await assert.rejects(memory.capture({ kind: 'targets', pins: [pin(protocolId(404))] }),
      { status: 409, code: 'USP_STALE_TARGET' });
  }));

test('zero and 101 pins are refused before any query, including at the public capture boundary',
  async () => local(async () => {
    const memory = new SnapshotControl();
    for (const count of [0, 101]) {
      const selection = { kind: 'targets' as const,
        pins: Array.from({ length: count }, () => pin(memory.records[0].id)) };
      await assert.rejects(memory.capture(selection), { status: 422, code: 'USP_SELECTION' });
      await assert.rejects(captureRegistrySnapshot(ctx(), memory.site.id, selection),
        { status: 422, code: 'USP_SELECTION' });
    }
    assert.deepEqual(memory.queries, []);
  }));

test('parents, frame, aliases and own package parts contribute; unrelated parts do not',
  async () => local(async () => {
    const { memory, selection, floor, space } = hierarchy();
    unrelated(memory, 4, 5);
    memory.qualifications = [{ namespace: 'registry_record', record_id: memory.records[3].id,
      record_revision: 4, revision: 1, body: {} }];
    memory.aliases = [{ record_id: space.id, alias: 'protocol-only alias' }];
    memory.packages[0].parts = [{ sourceRevisionId: memory.sources[1].id, locator: 'protocol part' }];
    const first = await memory.capture(selection);
    assert(!first.members.some(member => member.pin.ref.namespace === 'geometry_qualification'));
    memory.qualifications[0].revision++;
    memory.packages[0].parts.push({ sourceRevisionId: memory.sources[4].id, locator: 'unrelated part' });
    assert.equal((await memory.capture(selection)).digest, first.digest);
    floor.revision++;
    assert.notEqual((await memory.capture(selection)).digest, first.digest);
    floor.revision--;
    memory.aliases[0].alias = 'changed protocol-only alias';
    assert.notEqual((await memory.capture(selection)).digest, first.digest);
    memory.aliases[0].alias = 'protocol-only alias';
    memory.packages[0].parts[0].locator = 'changed protocol part';
    assert.notEqual((await memory.capture(selection)).digest, first.digest);
    memory.packages[0].parts[0].locator = 'protocol part';
    memory.site.frame = { ...frame, benchmark: 'protocol-only changed benchmark' };
    assert.notEqual((await memory.capture(selection)).digest, first.digest);
  }));

test('sourceOnly parent fields close the hierarchy when a level has no link entries',
  async () => local(async () => {
    const { memory, selection, floor, building } = hierarchy();
    floor.body.links = [];
    floor.body.sourceOnly = { parentId: building.id, buildingId: building.id };
    const snapshot = await memory.capture(selection);
    assert.equal(snapshot.members.filter(member => member.pin.ref.namespace === 'registry_record').length, 3);
  }));

test('closure limits apply to dependencies, features and sources rather than site totals',
  async () => local(async () => {
    const { memory, selection, space } = hierarchy();
    unrelated(memory, 1001, 4);
    space.body.links.push(...memory.records.slice(3).map(row => ({ type: 'serves', targetId: row.id })));
    await assert.rejects(memory.capture(selection), { status: 413, code: 'USP_SCOPE_LIMIT' });
    const featureScope = hierarchy();
    featureScope.memory.features = Array.from({ length: 1001 }, (_, index) => ({
      ...featureScope.memory.features[0], id: protocolId(index + 2000) }));
    await assert.rejects(featureScope.memory.capture(featureScope.selection), { status: 413, code: 'USP_SCOPE_LIMIT' });
    const sourceScope = hierarchy();
    unrelated(sourceScope.memory, 3, 2001);
    sourceScope.space.body.evidence = sourceScope.memory.sources.map(source => ({ sourceId: source.id }));
    await assert.rejects(sourceScope.memory.capture(sourceScope.selection), { status: 413, code: 'USP_SCOPE_LIMIT' });
  }));

test('relevant declarations keep entry integrity, target applicability and contributing sources',
  async () => local(async () => {
    const { memory, selection, space } = hierarchy();
    unrelated(memory, 4, 5);
    const citation = { pointer: { sourceRevision: {
      ref: { namespace: 'source_revision', id: memory.sources[3].id }, revision: 1 } } };
    const declaration = (target: TargetPin, index: number) => ({ id: protocolId(index), revision: 1, body: {
      input: { instrument: citation, population: { targets: [target], evidence: citation },
        denominator: { evidence: citation }, entries: [{ target, evidence: citation }] },
      review: { consentEvidence: [], applicability: [{ target, evidence: citation }] } } });
    memory.declarations = [declaration(pin(space.id), 3000), declaration(pin(memory.records[3].id, 4), 3001)];
    const relevant = memory.declarations[0];
    memory.entries = [space, memory.records[3]].map((row, index) => ({ id: protocolId(4000 + index),
      revision: 1, declaration_id: relevant.id, declaration_revision: 1, body: { entry: { target: pin(row.id) } } }));
    memory.applicability = [space, memory.records[3]].map((row, index) => ({ id: protocolId(5000 + index),
      revision: 1, declaration_id: relevant.id, declaration_revision: 1, body: { target: pin(row.id) } }));
    const snapshot = await memory.capture(selection);
    const count = (namespace: string) => snapshot.members
      .filter(member => member.pin.ref.namespace === namespace).length;
    assert.equal(count('declaration'), 1);
    assert.equal(count('declaration_entry'), 2);
    assert.equal(count('applicability'), 1);
    assert.equal(count('source_revision'), 4);
    assert.equal(count('registry_record'), 3);
    memory.declarations[1].revision++;
    assert.equal((await memory.capture(selection)).digest, snapshot.digest);
  }));

test('retained source-only Tower 3 space still captures parent floor/building and original-only document pins',
  async () => control(async fixture => {
    const snapshot = await fixture.capture();
    assert(snapshot.members.some(member => member.pin.ref.id === fixture.recorded.floorId));
    assert(snapshot.members.some(member => member.pin.ref.id === retainedTower.buildingId));
    const bodies = fixture.memory.captured.get(snapshot.id)!;
    const originals = bodies.filter(row => row.namespace === 'source_revision');
    assert.equal(originals.length, receipt.documentPins.length);
    assert(originals.every(row => row.body.sourceStatedOriginal?.version === 'source-stated-space/1'));
    assert(fixture.memory.assertSourceIntegrity());
  }));
