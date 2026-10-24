import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import {
  NormalizedAreaSchema,
  NormalizedBuildingSchema,
  toSceneInputs,
  type AreaFrame,
  type NormalizedBuilding,
} from '@ulpin/contracts';
import {
  canonicalValue as value,
  geographicToEnu,
  finishBuilding,
} from '@ulpin/server/modules/registry/canonical-building';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { CanonicalController } from './canonical.controller';
import { CanonicalProjectionService } from './canonical.service';
import { RegisterModule } from './register.module';
import { ApiExceptionFilter } from '../../common/api-exception.filter';
import { guardLocalRequest } from '../../common/request-context';
import { setRuntimeLoopbackPort } from '@ulpin/server/infrastructure/loopback-host';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

const nycFrame: AreaFrame = {
  areaId: 'fixture:nyc-bronx-353927-context',
  origin: { lon: -73.869957915648, lat: 40.900305259723, hEllipsoidal: null },
  axes: 'ENU',
  unit: 'm',
  placement: 'source_supported',
  sourceCrs: ['EPSG:4326'],
  verticalRefs: ['building_relative'],
  horizontalOperation: 'deterministic:wgs84-surface-to-enu@1',
};

function emptyBuilding(buildingId: string, areaFrame: AreaFrame): NormalizedBuilding {
  return {
    schemaVersion: 'normalized-building/1',
    buildingId,
    areaId: areaFrame.areaId,
    revisionId: 'pending',
    recordState: 'candidate',
    frame: areaFrame,
    name: value<string>(null),
    inputRevisions: [],
    parcelRefs: [],
    footprint: value(null),
    footprintKind: value(null),
    baseM: value(null),
    heightM: value(null),
    heightState: 'unknown',
    storeyCount: value(null),
    storeyLabel: value(null),
    storeys: value(null),
    levels: [],
    conflicts: [],
    gaps: [],
    candidates: [],
  };
}

/** The real NYC building 353927 from the retained original, with its footprint projected to ENU metres. */
function nycBuilding(): NormalizedBuilding {
  const original = readFileSync('fixtures/real-area/original.geojson');
  const manifest = read('fixtures/real-area/manifest.json');
  assert.equal(createHash('sha256').update(original).digest('hex'), manifest.sourceSha256);
  const feature = JSON.parse(original.toString()).features.find((f: any) => f.properties.doitt_id === '353927');
  const citation = {
    sourceId: 'fixture:real-area/original.geojson',
    sourceSha256: manifest.sourceSha256,
    locator: { kind: 'feature' as const, featureId: feature.properties.doitt_id },
  };
  const nyc = emptyBuilding(`fixture:NYC:doitt_id:${feature.properties.doitt_id}`, nycFrame);
  nyc.name = value(feature.properties.doitt_id, 'source_supported', [citation]);
  nyc.footprint = value(
    geographicToEnu(feature.geometry, nycFrame),
    'source_supported',
    [citation],
    nycFrame.horizontalOperation!,
    'm',
  );
  nyc.heightM = value(
    Number(feature.properties.height_roof) * manifest.vertical.metresPerFoot,
    'source_supported',
    [citation],
    'deterministic:international-foot-to-metre@1',
    'm',
  );
  nyc.heightState = nyc.heightM.state;
  nyc.gaps = [
    'test_only foreign fixture; source keys are not allocated registry identities.',
    'Outline role and measured terrain base remain unknown.',
  ];
  return finishBuilding(nyc);
}

function towerFrame(truth: any): AreaFrame {
  return {
    areaId: 'fixture:haryana-rera-2831',
    origin: { lon: null, lat: null, hEllipsoidal: null },
    axes: 'ENU',
    unit: 'm',
    placement: 'unknown',
    sourceCrs: [],
    verticalRefs: [truth.reference.verticalReference],
    horizontalOperation: null,
  };
}

/** The real Tower 3 same-sheet G+41/G+42 conflict: kept as a conflict, no integer level schedule inferred. */
function towerBuilding(): NormalizedBuilding {
  const truth = read('docs/evidence/usp/finale/GF-DATA/storey-truth/demo/haryana-2831-tower3.json');
  const tower = emptyBuilding(
    `fixture:haryana-rera:${truth.projectSourceId}:${truth.buildingLiteral}`,
    towerFrame(truth),
  );
  const statements = truth.documentStatements.filter((s: any) => s.kind === 'floor_expression');
  const alternatives = statements.map((s: any) => value(s.value, 'source_supported', [{
    sourceId: 'fixture:haryana-2831-site-plan.pdf',
    sourceSha256: s.citation.sha256,
    locator: { kind: 'page', page: s.citation.page, text: s.citation.locator },
  }]));
  const citations = alternatives.flatMap((a: any) => a.citations);
  tower.name = value(truth.buildingLiteral, 'source_supported', alternatives[0].citations);
  tower.storeyLabel = value(null, 'conflicting', citations);
  tower.storeyCount = value(null, 'conflicting', citations, 'source_literal', 'count');
  tower.conflicts = [{
    property: 'building.storeyLabel',
    alternatives,
    reason: 'Same-sheet G+41/G+42 conflict; no integer level schedule inferred.',
  }];
  tower.gaps = truth.limitations;
  return finishBuilding(tower);
}

function examples() {
  return { nyc: nycBuilding(), tower: towerBuilding() };
}

function areaFor(building: NormalizedBuilding) {
  return NormalizedAreaSchema.parse({
    schemaVersion: 'normalized-building/1',
    revisionId: building.revisionId,
    frame: building.frame,
    buildings: [{
      buildingId: building.buildingId,
      revisionId: building.revisionId,
      recordState: building.recordState,
      name: building.name,
      footprint: building.footprint,
      heightM: building.heightM,
      heightState: building.heightState,
    }],
    baseFeatures: [],
    overlays: [],
    tilesets: [],
    gaps: [],
  });
}

function originPolygon() {
  const { lon, lat } = nycFrame.origin;
  const corner = [lon!, lat!];
  return { type: 'Polygon' as const, coordinates: [[corner, corner, corner, corner]] };
}

function checkRealFixturesProject(): void {
  const { nyc, tower } = examples();
  const before = JSON.stringify([nyc, tower]);
  const inputs = toSceneInputs(areaFor(nyc), [nyc]);
  assert(Math.abs(inputs.footprints[0].heightM! - 10.207752) < 1e-12);
  assert.equal(inputs.footprints[0].polygons[0][0].length, nyc.footprint.value![0][0].length);
  const local = nyc.footprint.value![0][0];
  assert(local.some(([x, y]) => Math.abs(x) > 1 || Math.abs(y) > 1));
  assert.deepEqual(geographicToEnu(originPolygon(), nycFrame)![0][0][0], [0, 0]);
  assert.equal(tower.heightM.value, null);
  assert.equal(tower.storeyCount.state, 'conflicting');
  assert.deepEqual(tower.conflicts[0].alternatives.map(a => a.value), ['G+41', 'G+42']);
  assert.equal(toSceneInputs(areaFor(tower), [tower]).footprints.length, 0);
  const unknownHeight = structuredClone(nyc);
  unknownHeight.heightM = value(null);
  unknownHeight.heightState = 'unknown';
  const flat = toSceneInputs(areaFor(unknownHeight), [unknownHeight]);
  assert.equal(flat.footprints[0].heightM, null);
  assert.equal(flat.footprints[0].heightState, 'unknown');
  const estimated = structuredClone(nyc);
  estimated.heightM.state = 'estimated';
  estimated.heightState = 'estimated';
  assert.equal(toSceneInputs(areaFor(estimated), [estimated]).styles[nyc.buildingId].hatch, true);
  const candidate = structuredClone(nyc);
  candidate.footprint.state = 'candidate';
  assert.equal(toSceneInputs(areaFor(candidate), [candidate]).styles[nyc.buildingId].candidate, true);
  assert.equal(JSON.stringify([nyc, tower]), before);
  const zeroedHeight = { ...tower, heightM: { ...tower.heightM, value: 0 } };
  assert.equal(NormalizedBuildingSchema.safeParse(zeroedHeight).success, false);
  const footHeight = { ...nyc, heightM: { ...nyc.heightM, unit: 'ft' } };
  assert.equal(NormalizedBuildingSchema.safeParse(footHeight).success, false);
  writeFileSync('docs/evidence/gf-backend/k1/nyc-example.json', JSON.stringify(nyc, null, 2) + '\n');
  writeFileSync('docs/evidence/gf-backend/k1/tower3-example.json', JSON.stringify(tower, null, 2) + '\n');
}
test(
  'real NYC footprint and real Tower 3 conflict validate and project without mutating sources or filling unknowns',
  checkRealFixturesProject,
);

@Module({ controllers: [CanonicalController], providers: [CanonicalProjectionService] })
class TestModule {}

/** Transport controls only. Production readers are exercised separately against ulpin-demo, never substituted there. */
function stubService(
  service: CanonicalProjectionService,
  ids: { areaId: string; buildingId: string },
  area: ReturnType<typeof areaFor>,
  building: NormalizedBuilding,
): void {
  service.area = async id => {
    if (id !== ids.areaId) throw new AppError(404, 'NOT_FOUND', 'Area not found.');
    return area;
  };
  service.building = async (id, revision = 'current') => {
    if (id !== ids.buildingId || (revision !== 'current' && revision !== building.revisionId)) {
      throw new AppError(404, 'CANONICAL_REVISION_NOT_FOUND', 'Revision not found.');
    }
    return building;
  };
}

/** Native producer and published document must carry exactly the Zod response contracts used by the routes. */
async function assertPublishedContracts(): Promise<void> {
  const registered = await NestFactory.create(RegisterModule, { logger: false, bodyParser: false });
  await registered.close();
  const published = read('docs/api/openapi.json');
  const routes = [
    ['/api/v1/areas/{areaId}/canonical', NormalizedAreaSchema],
    ['/api/v1/buildings/{buildingId}/canonical', NormalizedBuildingSchema],
  ] as const;
  for (const [path, validator] of routes) {
    const op = published.paths[path].get;
    const ref = op.responses['200'].content['application/json'].schema.$ref;
    const expected = z.toJSONSchema(validator, { target: 'openapi-3.0' });
    delete expected.$schema;
    assert.deepEqual(published.components.schemas[ref.split('/').at(-1)], expected);
  }
}

async function checkHttpRoutes(): Promise<void> {
  const { nyc } = examples();
  const area = areaFor(nyc);
  const app = await NestFactory.create(TestModule, { logger: false, bodyParser: false });
  const ids = { areaId: randomUUID(), buildingId: randomUUID() };
  stubService(app.get(CanonicalProjectionService), ids, area, nyc);
  let port = 0;
  app.use((req: any, res: any, next: () => void) => guardLocalRequest(req, res, next, port, []));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, '127.0.0.1');
  port = app.getHttpServer().address().port;
  setRuntimeLoopbackPort(port);
  try {
    const base = `http://127.0.0.1:${port}/api/v1`;
    const routes = [
      [`areas/${ids.areaId}/canonical`, NormalizedAreaSchema, area],
      [`buildings/${ids.buildingId}/canonical?revision=${nyc.revisionId}`, NormalizedBuildingSchema, nyc],
    ] as const;
    for (const [path, validator, expected] of routes) {
      const response = await fetch(`${base}/${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('etag'), `"${expected.revisionId}"`);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(validator.parse(await response.json()), expected);
      assert.equal((await fetch(`${base}/${path}`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    }
    assert.equal((await fetch(`${base}/areas/${randomUUID()}/canonical`)).status, 404);
    assert.equal((await fetch(`${base}/buildings/${ids.buildingId}/canonical?revision=${'0'.repeat(64)}`)).status, 404);
    assert.equal((await fetch(`${base}/buildings/${ids.buildingId}/canonical?revision=1`)).status, 422);
    await assertPublishedContracts();
  } finally {
    await app.close();
    setRuntimeLoopbackPort(undefined);
  }
}
test(
  'both HTTP routes match the published contracts, private ETags, exact revision, 404 and genuine cross-site 403',
  checkHttpRoutes,
);
