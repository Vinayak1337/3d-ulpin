import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PhysicalFeature } from '@ulpin/contracts';
import { transaction } from '../../infrastructure/db';
import { canonicalBuilding } from '../registry/canonical-building';
import { areaProposals } from './area-display-proposals';
import { areaContext, areaDisplayPackages, getArea } from './areas';

const nyc = JSON.parse(readFileSync('docs/evidence/gf-backend/k1/nyc-import.json', 'utf8'));

type Package = { id: string; revision: number; state: string; datasetNamespace: string; sourceRevisionIds: string[];
  parts: []; factCandidates: []; features: PhysicalFeature[] };

/** Buildings shaped like the NYC import; no citations, so no source read is needed. */
function buildings(areaId: string, count: number, revision: number): PhysicalFeature[] {
  const template: PhysicalFeature = nyc.features[0];
  return Array.from({ length: count }, (_, ordinal) => ({
    ...structuredClone(template), id: randomUUID(), areaId, kind: 'building', identifier: `r${revision}-${ordinal}`,
    sourceKey: `key-${ordinal}`, revision, evidence: [], height: { ...template.height, evidence: [] },
  }) as PhysicalFeature);
}

/** An area's rows and packages behind the pool, answering each statement as the database would, and counting the
 * physical feature rows each statement reads. */
class RegisterControl {
  statements: { sql: string; featureRows: number }[] = [];
  area = { id: randomUUID(), site_id: randomUUID(), name: 'Register control', revision: 2,
    reference: { anchor: [-73.87, 40.9], sourceCrs: 'EPSG:4326', verticalReference: 'unknown',
      analysisCrs: 'EPSG:32618', origin: [0, 0] }, extent: [0, 0, 1, 1], geographic_extent: [0, 0, 1, 1] };
  /** Every row of physical_features: recorded ones above revision 0, proposals at 0. */
  rows: PhysicalFeature[] = [];
  /** Newest first, as the package read orders them. */
  packages: Package[] = [];
  source = { id: randomUUID(), case_id: randomUUID(), archived: false, site_id: this.area.site_id,
    sha256: 'a'.repeat(64), revision: 1, created_at: '2026-10-17T00:00:00Z' };

  /** A reviewed package of this area proposing the features, each with a row at revision 0, the oldest so far. */
  propose(features: PhysicalFeature[], state = 'REVIEWED'): Package {
    const pkg: Package = { id: randomUUID(), revision: 1, state, datasetNamespace: 'register',
      sourceRevisionIds: [this.source.id], parts: [], factCandidates: [],
      features: features.map(item => ({ ...item, sourceRevisionId: this.source.id })) };
    this.packages.push(pkg);
    this.rows.push(...features.filter(item => !this.rows.some(row => row.id === item.id)));
    return pkg;
  }

  private answer(sql: string, values: any[]): any[] {
    const recorded = this.rows.filter(row => row.revision > 0);
    if (sql.includes('FROM map_areas a')) return [{ ...this.area, feature_count: recorded.length }];
    if (sql.startsWith('SELECT area_id')) {
      const row = this.rows.find(item => item.id === values[0]);
      return row ? [{ area_id: this.area.id, revision: row.revision, body: row }] : [];
    }
    if (sql.startsWith('SELECT body FROM physical_features WHERE id=$1 AND revision>0')) {
      return recorded.filter(row => row.id === values[0]).map(body => ({ body }));
    }
    if (sql.startsWith('SELECT id,revision FROM physical_features')) {
      return this.rows.filter(row => values.length === 1 || row.id === values[1])
        .map(({ id, revision }) => ({ id, revision }));
    }
    if (sql.startsWith('SELECT f.body,f.area_id')) {
      return recorded.slice(0, values[4]).map(body => ({ body, area_id: this.area.id, local_geometry: null }));
    }
    if (sql.includes('FROM import_packages WHERE area_id')) {
      const rule = ({ id, sourceKey, areaId, revision, sourceRevisionId }: PhysicalFeature) =>
        ({ id, sourceKey, areaId, revision, sourceRevisionId });
      const ruleOnly = sql.includes('jsonb_agg');
      return this.packages.map(pkg => ({ body: ruleOnly ? { ...pkg, features: pkg.features.map(rule) } : pkg }));
    }
    if (sql.includes("e.feature->>'id'=$2")) {
      const pkg = this.packages.find(item => item.id === values[0]);
      return (pkg?.features ?? []).filter(item => item.id === values[1]).map(feature => ({ feature }));
    }
    if (sql.includes('FROM sources')) return [this.source];
    if (sql.includes("current_setting('role')")) return [{ role: 'none' }];
    if (sql.includes('FROM registry_sites')) return [{ revision: 1, frame: { benchmark: 'building' } }];
    return [];
  }

  query = async (sql: string, values: any[] = []) => {
    const rows = this.answer(sql, values);
    const featureRows = /FROM physical_features/.test(sql) && !sql.includes('FROM map_areas a') ? rows.length : 0;
    this.statements.push({ sql, featureRows });
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
}

async function memory(work: (control: RegisterControl) => Promise<void>) {
  const control = new RegisterControl();
  const globals = globalThis as any;
  const previousPool = globals.ulpinPool;
  const previousSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  globals.ulpinPool = { query: control.query, connect: async () => ({ query: control.query, release() {} }) };
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'area-feature-read-test';
  try { await work(control); }
  finally {
    globals.ulpinPool = previousPool;
    if (previousSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previousSubject;
  }
}

/** The proposals the area's window reads draw, by the full rule. */
async function drawnProposals(control: RegisterControl): Promise<Set<string>> {
  return transaction(async client => {
    const area = await getArea(control.area.id, client);
    const chosen = await areaProposals(client, area, await areaDisplayPackages(client, area.id, true));
    return new Set(chosen.flatMap(({ features }) => features.map(feature => feature.id)));
  });
}

/** The statements of one read, from its first. */
async function statementsOf(control: RegisterControl, read: () => Promise<unknown>) {
  const first = control.statements.length;
  await read();
  return control.statements.slice(first);
}

test('a building in an area over the 2,000 limit answers with its own values, recorded or proposed', async () =>
  memory(async control => {
    control.rows = buildings(control.area.id, 2001, 1);
    const proposals = buildings(control.area.id, 2001, 0).map(item => ({ ...item, sourceKey: `new-${item.id}` }));
    control.propose(proposals);
    const [recorded, proposal] = [control.rows[7], proposals[11]];

    const recordedStatements = await statementsOf(control, async () => {
      const building = await canonicalBuilding(recorded.id);
      assert.equal(building.buildingId, recorded.id);
      assert.equal(building.recordState, 'reviewed');
      assert.equal(building.heightM.value, recorded.height.value);
    });
    const proposalStatements = await statementsOf(control, async () => {
      const building = await canonicalBuilding(proposal.id);
      assert.equal(building.buildingId, proposal.id);
      assert.equal(building.recordState, 'candidate');
      assert.equal(building.footprint.state, 'candidate');
      assert.equal(building.heightM.value, proposal.height.value);
      assert.ok(building.gaps.some(gap => gap.startsWith('Unrecorded source proposal; candidate geometry')));
    });
    for (const statement of [...recordedStatements, ...proposalStatements]) {
      assert.doesNotMatch(statement.sql, /^SELECT f\.body,f\.area_id/);
      assert.ok(statement.featureRows <= 1, `${statement.featureRows} feature rows read by ${statement.sql}`);
    }
    assert.ok(proposalStatements.some(statement => statement.sql.endsWith('WHERE area_id=$1 AND id=$2')));
    await assert.rejects(areaContext(control.area.id), (error: any) => error.code === 'AREA_LIMIT');
  }));

test('a proposal the window reads do not draw answers 404, and every drawn one answers', async () =>
  memory(async control => {
    const [kept, superseded, committed] = buildings(control.area.id, 3, 0);
    const replacement = { ...buildings(control.area.id, 1, 0)[0], sourceKey: superseded.sourceKey };
    control.propose([replacement]);
    control.propose([kept, superseded]);
    control.propose([{ ...committed, sourceKey: 'committed' }], 'COMMITTED');
    const drawn = await drawnProposals(control);
    assert.deepEqual(drawn, new Set([replacement.id, kept.id]));
    for (const feature of [replacement, kept, superseded, committed]) {
      const read = canonicalBuilding(feature.id);
      if (drawn.has(feature.id)) assert.equal((await read).buildingId, feature.id);
      else await assert.rejects(read, (error: any) => error.status === 404 && error.message === 'Building not found.');
    }
  }));

test('a small area answers exactly as its whole context read does', async () => memory(async control => {
  control.rows = buildings(control.area.id, 5, 1);
  const [proposal] = buildings(control.area.id, 1, 0);
  control.propose([proposal]);
  for (const id of [control.rows[2].id, proposal.id]) {
    const context = await areaContext(control.area.id);
    assert.deepEqual(await canonicalBuilding(id), await canonicalBuilding(id, 'current', context));
  }
}));
