import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildings, areas, installed, ramp, r1, r2, schedule, demoCheckout } from './inputs';
import { area, building, site, type Context, type Building } from './context';
import { check, object, list, ok, valueCounts, type Step } from './read';

export async function doctor(context: Context): Promise<Step> {
  return check(context.reader, 'doctor', 'Live stack doctor', 'P0.3', 'Doctor 0; gateway disabled; served HEAD read',
    async () => {
      const args = ['platform:doctor', '--profile', 'demo'];
      const result = process.platform === 'win32'
        ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], doctorOptions())
        : spawnSync('pnpm', args, doctorOptions());
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      const head = spawnSync('git', ['rev-parse', 'HEAD'], doctorOptions());
      assert.equal(head.status, 0, 'Cannot read serving checkout HEAD');
      context.servedCommit = head.stdout.trim();
      assert(/^[a-f0-9]{40}$/.test(context.servedCommit), 'Invalid serving commit');
      const disabled = /^\s*enabled: false\s*$/m.test(output);
      const failedComponents = output.split(/\r?\n/).filter(line => line.startsWith('FAIL '));
      const observed = { exitCode: result.status, gatewayDisabled: disabled, servedCommit: context.servedCommit,
        failedComponents };
      return { state: result.status === 0 && disabled ? 'pass' : 'fail', observed };
    });
}
function doctorOptions() {
  // Existing doctor alone may read its private configuration. This runner never opens runtime files.
  return { cwd: demoCheckout, encoding: 'utf8' as const, timeout: 180000, windowsHide: true };
}

export async function installedStep(context: Context): Promise<Step> {
  return check(context.reader, 'installed', 'Story inputs installed', 'P3.1', 'Pinned areas/buildings/cases exist',
    async () => {
      const observations: Record<string, number> = {};
      const rows = new Map<string, Record<string, unknown>[]>();
      for (const route of ['areas', 'registry', 'sites', 'cases']) {
        const read = await context.reader.get(`/api/v1/${route}`);
        const items = list(ok(read)).map(object);
        observations[route] = items.length;
        rows.set(route, items);
      }
      const required = { areas, registry: buildings, sites: [r2.inputs.siteId],
        cases: [r1.step2.caseId, r1.step3.case.id] };
      const missing = Object.entries(required).flatMap(([kind, ids]) => ids.filter(id =>
        !rows.get(kind)!.some(item => item.id === id)).map(id => ({ kind, id })));
      return { state: missing.length ? 'skipped' : 'pass', observed: { counts: observations, missing } };
    });
}

export async function canonical(context: Context): Promise<Step> {
  return check(context.reader, 'canonical', 'Canonical values and citations', 'P1.1',
    '200; frames; supported/reviewed values cited; unknown is null', async () => {
      const areaReads = [];
      for (const areaId of areas) {
        const data = await area(context, areaId);
        if (areaId !== ramp.imagery.areaId) assert(data.buildings.length > 0, 'Story building missing from area');
        areaReads.push({ areaId, frameAreaId: data.frame.areaId, buildings: data.buildings.length,
          valuesPerState: valueCounts(data) });
      }
      const buildingReads = [];
      for (const buildingId of buildings) {
        const data = await building(context, buildingId);
        assert.equal(data.buildingId, buildingId);
        buildingReads.push({ buildingId, frameAreaId: data.frame.areaId, recordState: data.recordState,
          valuesPerState: valueCounts(data) });
      }
      return { observed: { areas: areaReads, buildings: buildingReads } };
    });
}

export async function roofprints(context: Context): Promise<Step> {
  return check(context.reader, 'roofprints', 'Retained roof candidates, not registry truth', 'P4.5',
    'Model and test_only original lineage; decided candidates reviewed; no unreviewed registry admission', async () => {
      const data = await area(context, ramp.imagery.areaId);
      const candidates = (data.candidates ?? []).filter(candidate => candidate.kind === 'roofprint');
      assert(candidates.length > 0, 'No roof candidates');
      const chips = (data.imagery ?? []).flatMap(group => {
        assert.equal(group.classification, 'test_only');
        return group.chips;
      });
      assert(chips.length > 0, 'No test_only original chips');
      for (const candidate of candidates) {
        assert(candidate.modelId && candidate.modelHash, 'Candidate lacks model pins');
        assert(candidate.citations?.length, 'Candidate lacks original citations');
        assert(candidate.citations.every(citation => chips.some(chip => chip.sourceId === citation.sourceId
          && chip.sourceSha256 === citation.sourceSha256)), 'Candidate original is not test_only imagery');
        if (candidate.state === 'reviewed') assert(candidate.review, 'Decision has no review');
        if (candidate.review) assert.equal(candidate.state, 'reviewed');
      }
      const detail = await site(context, ramp.imagery.areaId);
      const records = list(detail.records);
      if (records.length) throw new Error('Cannot decide roof registry lineage without an exposed admission receipt');
      context.roofVerified = true;
      return { observed: { candidates: candidates.length, decided: candidates.filter(item => item.review).length,
        accepted: candidates.filter(item => item.review?.outcome === 'accepted').length,
        rejected: candidates.filter(item => item.review?.outcome === 'rejected').length,
        modelIds: [...new Set(candidates.map(item => item.modelId))], testOnlyChips: chips.length,
        registryRecords: records.length, unreviewedRegistryFacts: 0 } };
    });
}

export async function storeys(context: Context): Promise<Step> {
  return check(context.reader, 'storeys', 'Cited schedule conflict and reviewed inventory', 'P5.1',
    { towerAlternatives: installed.difficultInput.alternatives, magnoliaLabels: schedule.magnolia.literalLabels },
    async () => {
      const tower = (await building(context, buildings[0])).levelSchedule;
      const magnolia = (await building(context, buildings[1])).levelSchedule;
      assert(tower && magnolia, 'Schedule missing');
      assert.equal(tower.state, 'conflicting');
      assert.equal(tower.alternatives?.length, 2, 'Story requires two unresolved alternatives');
      assert.deepEqual(tower.alternatives.map(item => item.labelLiteral).sort(),
        [...installed.difficultInput.alternatives].sort());
      assert(tower.alternatives.every(item => item.citations.length > 0));
      assert.equal(magnolia.state, 'reviewed');
      assert.deepEqual(magnolia.levels.map(item => item.labelLiteral), schedule.magnolia.literalLabels);
      assert(magnolia.levels.every(item => item.citations.length > 0));
      return { observed: { tower: tower.state, alternatives: tower.alternatives.map(item => ({
        label: item.labelLiteral, citations: item.citations.length })),
      magnolia: magnolia.state, reviewedLevels: magnolia.levels.length } };
    });
}

function recordedFacts(data: Building) {
  const floors = data.levels.filter(level => level.registryFloorId);
  const spaces = floors.flatMap(level => level.spaces);
  assert.equal(floors.length, 1, 'Exactly one recorded floor required');
  assert.equal(spaces.length, 1, 'Exactly one recorded space required');
  const floor = floors[0];
  const space = spaces[0];
  assert.equal(floor.registryFloorId, r2.step2.record.floorId);
  assert.equal(space.spaceId, r2.step2.record.spaceId);
  assert.equal(floor.label.value, r2.step2.readBack.floorLabel);
  assert.equal(space.label?.value, r2.step2.readBack.spaceLabel);
  for (const item of [floor, space]) {
    assert.equal(item.recordState, 'reviewed');
    assert.equal(item.label?.state, 'reviewed');
    assert.equal(item.polygons?.state, 'absent');
    assert.equal(item.polygons?.value, null);
    assert.equal(item.lowerM.state, 'unknown');
    assert.equal(item.upperM.state, 'unknown');
    assert.equal(item.lowerM.value, null);
    assert.equal(item.upperM.value, null);
    citedLabel(item.label!);
  }
  assert.equal(space.areaM2?.state, 'unknown');
  assert.equal(space.kind.state, 'unknown');
  assert.equal(data.parcelRefs.length, 0);
  return { floorId: floor.registryFloorId, spaceId: space.spaceId, codeState: space.proposedCode.state };
}

function citedLabel(label: Building['levels'][number]['label']) {
  const cite = label.citations;
  assert.equal(cite.length, 1);
  assert.equal(cite[0].sourceId, r2.inputs.sourceId);
  assert.equal(cite[0].sourceRevision, r2.inputs.sourceRevision);
  assert.equal(cite[0].sourceSha256, r2.inputs.sourceSha256);
  const pin = r2.step3.citations.find(pin => pin.literal === label.value);
  assert(pin && cite[0].locator.kind === 'region' && cite[0].locator.unit === 'pt');
  const locator = cite[0].locator;
  assert.equal(locator.page, pin.page);
  assert.deepEqual([locator.x, locator.y, locator.x + locator.width, locator.y + locator.height], pin.regionPt);
}

export async function recorded(context: Context): Promise<Step> {
  return check(context.reader, 'recorded', 'Source-stated floor and space', 'K4b/R2',
    'One reviewed floor/space; pinned regions; no geometry, heights, area, use, parcels or rights', async () => {
      const facts = recordedFacts(await building(context, r2.inputs.buildingId));
      const records = list((await site(context, r2.inputs.siteId)).records).map(object);
      for (const id of [facts.floorId, facts.spaceId]) {
        const record = records.find(record => record.id === id);
        assert(record, 'Source-stated registry child absent');
        assert.equal(list(record.rights).length, 0);
        assert.equal(list(record.footprint).length, 0);
        assert(!record.geometry && !record.officialUlpin && !record.owner, 'Unqualified assertion recorded');
        assert(!record.use || record.use === 'unspecified', 'Source-stated use became known');
      }
      context.recordedVerified = true;
      return { observed: { ...facts, recordedFloors: 1, recordedSpaces: 1, rights: 0, parcels: 0,
        geometry: 'absent', heights: 'unknown', area: 'unknown', use: 'unknown' } };
    });
}
