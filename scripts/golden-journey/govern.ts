import assert from 'node:assert/strict';
import { ChunkMappingStatusSchema,
  ChunkMappingChunkResponseSchema } from '../../packages/contracts/src/usp/chunk-mapping';
import { TabularSourceProfileSchema } from '../../packages/contracts/src/usp/ingestion';
import { buildings, areas, mappingRoute, mappingPins, sourceRoute, r1, r2, originalPins, committed } from './inputs';
import { building, site, type Context } from './context';
import { check, object, list, text, ok, knownK6, contract, type Step } from './read';

export async function tables(context: Context): Promise<Step> {
  return check(context.reader, 'tables', 'Retained TNHB mapping, freshness and questions', 'P3.4/A3d',
    '200; freshness fields; counts and learner lineage read, not inferred', async () => {
      const profileRead = await context.reader.get(sourceRoute + '/profile', mappingPins);
      const profile = TabularSourceProfileSchema.parse(ok(profileRead));
      const status = ChunkMappingStatusSchema.parse(ok(await context.reader.get(mappingRoute, mappingPins)));
      assert(status.sourceComplete && status.sealedChunks !== null, 'No sealed TNHB result to rehearse');
      const questions = new Set<string>();
      const versions = new Set<string>();
      let rows = 0;
      for (let chunkIndex = 0; chunkIndex < status.sealedChunks; chunkIndex++) {
        const chunkRead = await context.reader.get(mappingRoute + '/chunks/{chunkIndex}',
          { ...mappingPins, chunkIndex });
        const chunk = ChunkMappingChunkResponseSchema.parse(ok(chunkRead));
        const mapping = chunk.payload?.mapping;
        assert(mapping, 'Chunk lacks retained tabular mapping');
        rows += mapping.rows.length;
        mapping.questions.filter(question => !mapping.fieldSources.some(field =>
          field.sourceField === question.sourceField && field.source === 'officer'))
          .forEach(question => questions.add(question.sourceField));
        versions.add(text(mapping.metrics.learnerVersion));
      }
      assert.equal(rows, status.records, 'Published chunks do not account for status rows');
      assert.equal(rows, profile.records, 'Retained profile/chunk row counts differ');
      assert(status.current || status.reasons.length > 0, 'Stale result has no freshness reasons');
      return { observed: { http: 200, current: status.current, reasons: status.reasons, status: status.status,
        columns: profile.headers.length, rows, chunks: status.sealedChunks, askedColumns: questions.size,
        openQuestions: questions.size, questionScope: 'retained unanswered column questions',
        learnerVersions: [...versions], learnerScope: 'retained chunks, not the global learner head',
        proposalOnly: status.route === 'proposal_only' } };
    });
}

function citedRegister(body: unknown, ledger: boolean): number {
  const data = object(body);
  const sources = list(data.sources).map(object);
  assert(sources.length > 0 && sources.every(source => source.sha256 && source.id), 'No pinned register sources');
  if (ledger) {
    assert(sources.every(source => list(source.locators).length > 0), 'Ledger fact lacks source locators');
    const records = list(object(data.spaces).records).map(object);
    assert(records.every(record => list(record.evidence).length > 0), 'Recorded space lacks evidence');
    return records.length;
  }
  const register = object(data.register);
  const records = list(register.records).map(object);
  assert(records.length > 0 && records.every(record => list(record.evidence).length > 0),
    'Register facts lack citations');
  return records.length;
}

export async function register(context: Context): Promise<Step> {
  return check(context.reader, 'register', 'Both building registers and ledgers', 'K6',
    '200 with cited facts, or the exact known K6 source refusal', async () => {
      const observations = [];
      let blocked = false;
      for (const buildingId of buildings) {
        for (const kind of ['register', 'ledger']) {
          const read = await context.reader.get(`/api/v1/buildings/{buildingId}/${kind}`, { buildingId },
            kind === 'register' ? { format: 'json' } : {});
          if (knownK6(read)) {
            blocked = true;
            observations.push({ buildingId, kind, status: read.status, code: read.code, fixTask: 'K6' });
          } else {
            observations.push({ buildingId, kind, status: read.status, citedRecords: citedRegister(ok(read),
              kind === 'ledger') });
          }
        }
      }
      return { state: blocked ? 'blocked' : 'pass', observed: observations };
    });
}

export async function identity(context: Context): Promise<Step> {
  return check(context.reader, 'identity', 'Recorded unit project code', 'K6/P5.5',
    'Unknown remains blocked by K6; a reviewed code must resolve to this record', async () => {
      const data = await building(context, r2.inputs.buildingId);
      const space = data.levels.flatMap(level => level.spaces).find(space => space.spaceId === r2.step2.record.spaceId);
      assert(space, 'Recorded unit absent');
      if (space.proposedCode.state === 'unknown') {
        assert.equal(space.proposedCode.value, null);
        return { state: 'blocked', observed: { state: 'unknown', fixTask: 'K6',
          precondition: 'Snapshot refused in R2; check mode cannot attempt a new snapshot',
          priorStatus: 409, priorCode: 'STALE_REVISION', refusalEvidence: 'docs/evidence/runtime/r2/result.json' } };
      }
      assert.equal(space.proposedCode.state, 'reviewed');
      assert(space.proposedCode.value, 'Reviewed code is empty');
      // Exact P3 resolution requires POST + snapshot scope. Legacy GET resolve is not that authority.
      return { state: 'fail', observed: { state: space.proposedCode.state, code: space.proposedCode.value,
        reason: 'Cannot verify exact P3 resolution: published P3 resolver is POST-only; check mode sends no POST' } };
    });
}

export async function geometry(context: Context): Promise<Step> {
  return check(context.reader, 'geometry', 'Real reviewed prism prerequisites', 'P5.2/K4',
    'Placed reviewed geometry, cited heights and nonempty prisms; otherwise skipped', async () => {
      const observations = [];
      let prisms = 0;
      for (const buildingId of buildings) {
        const data = await building(context, buildingId);
        const assessments = Object.values(data.levelSchedule?.prisms ?? {});
        const present = assessments.filter(assessment => assessment.prism !== null);
        if (present.length) {
          assert.equal(data.footprint.state, 'reviewed');
          assert(data.footprint.value && data.frame.origin.lon !== null && data.frame.origin.lat !== null,
            'Prism lacks placed footprint');
          assert(data.levels.some(level => level.spaces.some(space => space.recordState === 'reviewed'
            && space.polygons.state === 'reviewed')), 'No reviewed space geometry');
          assert(present.every(assessment => assessment.heightState === 'known' && assessment.prism!.volumeM3 > 0));
        }
        prisms += present.length;
        observations.push({ buildingId, prisms: present.length, footprint: data.footprint.state,
          height: data.heightState, reasons: assessments.map(assessment => assessment.reason ?? assessment.state),
          canonicalGapLines: data.gaps.map(gap => gap.match(/.{1,90}/g)) });
      }
      return { state: prisms ? 'pass' : 'skipped', observed: { prisms, buildings: observations,
        missing: prisms ? [] : ['Placed reviewed footprint and stated heights; no real prism inputs'] } };
    });
}

export async function exchange(context: Context): Promise<Step> {
  return check(context.reader, 'exchange', 'CityJSON export availability', 'P5.3',
    'Nonempty export only; no POST export in check mode', async () => {
      // Published POST path, probed with GET only: a 404 is capability evidence, not a successful export.
      const read = await context.reader.get('/api/v1/usp/exchange/cityjson/export', {}, {}, true);
      if (read.status === 404) return { state: 'skipped', observed: { status: read.status, code: read.code,
        missing: 'No GET CityJSON export; POST export needs a snapshot and reviewed exchange frame' } };
      const data = object(object(ok(read)).data);
      const cityjson = object(data.cityjson);
      const vertices = list(cityjson.vertices).length;
      const objects = Object.keys(object(cityjson.CityObjects)).length;
      assert(vertices > 0 && objects > 0, 'Empty CityJSON is not a pass');
      return { observed: { vertices, objects } };
    });
}

export async function card(context: Context): Promise<Step> {
  return check(context.reader, 'card', 'Discover recorded unit card', 'K5/card-listing',
    'Unit-scoped card discovery is missing; verification route availability is not card verification', async () => {
      const route = committed<{ route: string }>('docs/evidence/gf4/k5/result.json').route;
      // Use the real R2 SPACE uuid as an explicitly non-card routing token, never as a discovered card id.
      const read = await context.reader.get(route, { cardId: r2.step2.record.spaceId, revision: 1 });
      assert.equal(read.status, 404, 'Non-card route probe unexpectedly found a resource; cannot decide target');
      const error = object(read.body);
      const message = error.message ?? object(error.error).message;
      return { state: 'skipped', observed: { missing: 'No published unit-scoped card listing; no actual cardId known',
        verificationGetPublished: Boolean(contract.paths[route]?.get), routeProbeStatus: read.status,
        routeProbeCode: read.code, tokenKind: 'existing registry_record UUID, not a card',
        verificationRouteAbsent: text(message).includes('Cannot GET'), cardVerified: false } };
    });
}

function tabularHashPins() {
  // R1 names these development assets; hashes come from their committed publisher/derivative receipts.
  const manifest = committed<{ assets: { id: string; original: { sha256: string } }[] }>(
    'fixtures/usp/D8-messy-india/manifest.json');
  const derivatives = committed<{ derivatives: { developmentCopy: string; sha256: string }[] }>(
    'fixtures/usp/D8-messy-india/dev/d1c/derivatives.json');
  const csv = manifest.assets.find(asset => asset.id === r1.step2.import.asset);
  const derived = derivatives.derivatives.find(item => item.developmentCopy.endsWith('/' + r1.step3.asset.id));
  assert(csv && derived, 'R1 development source hash pins missing');
  return [{ caseId: r1.step2.caseId, sourceId: r1.step2.import.sourceId, sha256: csv.original.sha256 },
    { caseId: r1.step3.case.id, sourceId: r1.step3.sourceId, sha256: derived.sha256 }];
}

export async function invariants(context: Context): Promise<Step> {
  return check(context.reader, 'invariants', 'Original hashes and review-only registry facts', 'P9.1',
    'API-reported originals match committed hashes; no unreviewed model facts', async () => {
      const sources: Record<string, unknown>[] = [];
      for (const siteId of areas) sources.push(...list((await site(context, siteId)).sources).map(object));
      const checked = [];
      for (const pin of originalPins()) {
        const source = sources.find(source => source.id === pin.sourceId);
        assert(source, 'Pinned original missing');
        assert.equal(source.sha256, pin.sourceSha256, 'Original SHA changed');
        checked.push({ sourceId: pin.sourceId, sha256: source.sha256 });
      }
      for (const pin of tabularHashPins()) {
        const profile = TabularSourceProfileSchema.parse(ok(await context.reader.get(sourceRoute + '/profile', pin)));
        assert.equal(profile.source.sourceSha256, pin.sha256, 'Retained tabular bytes changed');
        if (pin.sourceId === r1.step3.sourceId) assert.equal(profile.tabular.derivativeOf?.originalSha256,
          r1.step3.asset.derivativeOf.originalSha256, 'TNHB derivative lost original lineage');
        checked.push({ sourceId: pin.sourceId, sha256: profile.source.sourceSha256 });
      }
      assert(context.roofVerified && context.recordedVerified, 'Roof/recorded review invariant was not established');
      return { observed: { apiReportedHashesChecked: checked.length, pins: checked,
        statement: 'Roof candidate/registry and recorded label reads found no unreviewed model/agent registry facts',
        reviewChecksReused: ['roofprints', 'recorded'], byteDownloadOrRehashClaimed: false } };
    });
}
