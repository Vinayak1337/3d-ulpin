import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ImportPackage, PhysicalFeature } from '@ulpin/contracts';
import { areaContextResponse } from './area-intake-service';
import { AREA_DISPLAY_LIMIT, areaContext } from './areas';
import { canonicalArea } from './canonical-area';

const nyc = JSON.parse(readFileSync('docs/evidence/gf-backend/k1/nyc-import.json', 'utf8'));
const kinds = ['building', 'public_land', 'road'] as const;
// The demo area's recorded counts: 1,661 buildings, 41 parks and 446 roads (ZB1 final observations).
const DEMO_COUNTS = [1661, 41, 446];

/** Recorded features shaped like the NYC import; no citations, so no source read is needed. */
function demoFeatures(areaId: string, counts = DEMO_COUNTS): PhysicalFeature[] {
  const template: PhysicalFeature = nyc.features[0];
  return counts.flatMap((count, index) => Array.from({ length: count }, (_, ordinal) => ({
    ...structuredClone(template), id: randomUUID(), areaId, kind: kinds[index], identifier: `${index}-${ordinal}`,
    revision: 1, evidence: [], height: { ...template.height, evidence: [] },
  }) as PhysicalFeature));
}

class DisplayControl {
  statements: string[] = [];
  area = { id: randomUUID(), site_id: randomUUID(), name: 'Display control', revision: 3,
    reference: { anchor: [-73.87, 40.9], sourceCrs: 'EPSG:4326', verticalReference: 'unknown',
      analysisCrs: 'EPSG:32618', origin: [0, 0] }, extent: [0, 0, 1, 1], geographic_extent: [0, 0, 1, 1] };
  features: PhysicalFeature[] = [];

  private rows(sql: string, values: any[]): any[] {
    if (sql.includes('FROM map_areas a')) return [{ ...this.area, feature_count: this.features.length }];
    if (sql.startsWith('SELECT f.body,f.area_id')) {
      return this.features.slice(0, values[4]).map(body => ({ body, area_id: this.area.id, local_geometry: null }));
    }
    return [];
  }

  query = async (sql: string, values: any[] = []) => {
    this.statements.push(sql);
    const rows = this.rows(sql, values);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
}

async function memory(work: (control: DisplayControl) => Promise<void>) {
  const control = new DisplayControl();
  const globals = globalThis as any;
  const previousPool = globals.ulpinPool;
  const previousSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  globals.ulpinPool = { query: control.query, connect: async () => ({ query: control.query, release() {} }) };
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'area-display-read-test';
  try { await work(control); }
  finally {
    globals.ulpinPool = previousPool;
    if (previousSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previousSubject;
  }
}

test('the display read answers the 2,148-feature demo area while checks keep their 2,000 bound', async () =>
  memory(async control => {
    control.features = demoFeatures(control.area.id);
    const display = await areaContext(control.area.id, AREA_DISPLAY_LIMIT);
    assert.equal(display.features.length, 2148);
    await assert.rejects(areaContext(control.area.id), (error: any) => {
      assert.equal(error.code, 'AREA_LIMIT');
      assert.equal(error.message,
        'This block and its explicit group members exceed 2,000 features. Choose a smaller bounded group.');
      return true;
    });
  }));

test('the display read refuses beyond its own bound instead of dropping features', async () => memory(async control => {
  control.features = demoFeatures(control.area.id, [AREA_DISPLAY_LIMIT + 1]);
  await assert.rejects(areaContext(control.area.id, AREA_DISPLAY_LIMIT), (error: any) => {
    assert.equal(error.code, 'AREA_LIMIT');
    assert.match(error.message, /exceed 10,000 features/);
    return true;
  });
}));

test('the canonical area summarizes every recorded building without a read per building', async () =>
  memory(async control => {
    control.features = demoFeatures(control.area.id);
    const area = await canonicalArea(control.area.id);
    assert.equal(area.buildings.length, 1661);
    assert.equal(area.baseFeatures.filter(feature => feature.kind === 'public_land').length, 41);
    assert.equal(area.baseFeatures.filter(feature => feature.kind === 'road').length, 446);
    const building = area.buildings[0];
    assert.equal(building.recordState, 'reviewed');
    assert.equal(building.heightM.value, nyc.features[0].height.value);
    assert.equal(building.heightM.method, 'deterministic:international-foot-to-metre@1');
    assert.ok(building.footprint.value?.length);
    assert.equal(building.footprint.revisionId, building.revisionId);
    assert(control.statements.length < 40, `${control.statements.length} statements for 2,148 features`);
  }));

test('the context route sends the display features without unread geometry, and package summaries', async () =>
  memory(async control => {
    control.features = demoFeatures(control.area.id, [2, 1, 1]);
    const context = await areaContext(control.area.id, AREA_DISPLAY_LIMIT);
    const quarantine = { message: 'Two rings are not closed.', sourceSha256: 'a'.repeat(64) };
    const [held, recorded] = [randomUUID(), randomUUID()];
    context.packages = [
      { id: held, state: 'NEEDS_INPUT', features: context.features, quarantine: { ...quarantine, complete: false } },
      { id: recorded, state: 'COMMITTED', features: context.features, parts: [] },
    ] as unknown as ImportPackage[];
    const { displayFeatures, packages, ...rest } = areaContextResponse(context);
    const unread = ['sourceGeometry', 'geographicGeometry', 'sourceReference'];
    assert.deepEqual(Object.keys(rest).sort(),
      ['area', 'latestCheck', 'parcelAssociations', 'parcelIdentifiers', 'sceneAssets']);
    for (const key of Object.keys(rest) as (keyof typeof rest)[]) assert.equal(rest[key], context[key]);
    assert.equal(displayFeatures.length, context.displayFeatures!.length);
    displayFeatures.forEach((sent, index) => {
      const full = context.displayFeatures![index] as unknown as Record<string, unknown>;
      assert.ok(unread.every(key => key in full));
      assert.deepEqual(Object.keys(sent), Object.keys(full).filter(key => !unread.includes(key)));
      for (const [key, value] of Object.entries(sent)) assert.equal(value, full[key]);
    });
    assert.deepEqual(packages, [
      { id: held, state: 'NEEDS_INPUT', quarantine },
      { id: recorded, state: 'COMMITTED', quarantine: null },
    ]);
  }));
