import {
  LevelScheduleSchema, LevelScheduleProposalSchema,
  type LevelSchedule, type LevelScheduleRow, type NormalizedBuilding, type RegistryRecord,
} from '@ulpin/contracts';
import { canonicalValue } from './canonical-building';
import { areaGeo } from '../areas/areas';

type Assessment = NonNullable<NormalizedBuilding['levels'][number]['prismAssessment']>;

/** Unknown limits or missing reviewed geometry never invoke extrusion or create replacement boundaries. */
export async function assessSchedulePrisms(building: NormalizedBuilding,
  schedule: LevelSchedule): Promise<LevelSchedule['prisms']> {
  const assessments: LevelSchedule['prisms'] = {};
  for (const row of schedule.levels) {
    if (row.lowerM === null || row.upperM === null) {
      assessments[row.levelId] = { method: 'prism/2', analyticalEligibility: 'not_assessed',
        state: 'not_assessed', heightState: 'unknown',
        reason: 'level_limits_unknown', prism: null };
      continue;
    }
    if (building.footprint.state !== 'reviewed' || !building.footprint.value) {
      assessments[row.levelId] = { method: 'prism/2', analyticalEligibility: 'not_assessed',
        state: 'not_assessed', heightState: 'known',
        reason: 'reviewed_footprint_unavailable', prism: null };
      continue;
    }
    const result = await areaGeo<{ state: 'ok' | 'unsupported'; reason?: string;
      components: { heightState?: 'known' | 'unknown'; prism?: Assessment['prism'] }[] }>('build-prisms', {
      spaceId: building.buildingId, components: [{ componentId: row.levelId, levelId: row.levelId,
        footprint: { type: 'MultiPolygon', coordinates: building.footprint.value
          .map(polygon => polygon.map(ring => ring.map(point => point.map(String)))) },
        lowerM: String(row.lowerM), upperM: String(row.upperM), verticalReference: row.verticalReference,
        enclosure: row.kind === 'stilt' ? 'open' : 'closed' }],
    });
    assessments[row.levelId] = { method: 'prism/2', analyticalEligibility: 'not_assessed', state: result.state,
      heightState: result.components?.[0]?.heightState ?? 'known', prism: result.components?.[0]?.prism ?? null,
      ...(result.reason ? { reason: result.reason } : {}) };
  }
  return assessments;
}

function projectScheduleRow(row: LevelScheduleRow, schedule: LevelSchedule, building: NormalizedBuilding): void {
  const method = `reviewer:${schedule.decision.actor}`;
  const label = canonicalValue(row.labelLiteral, 'reviewed', row.citations, method);
  const heightState = row.lowerM === null || row.upperM === null ? 'unknown' : 'reviewed';
  const lowerM = canonicalValue(row.lowerM, heightState, row.citations, method, 'm');
  const upperM = canonicalValue(row.upperM, heightState, row.citations, method, 'm');
  building.levels.push({ levelId: row.levelId, order: row.order, label, lowerM, upperM, spaces: [],
    kind: row.kind, heightSource: row.heightSource, heightState,
    roomCandidateIds: building.candidates.filter(candidate => candidate.levelId === row.levelId)
      .map(candidate => candidate.candidateId), prismAssessment: schedule.prisms[row.levelId] });
  building.storeys.value!.push({ levelId: row.levelId, label, lowerM, upperM,
    belowGround: canonicalValue(row.kind === 'basement' ? true : null, undefined, row.citations, method),
    open: canonicalValue(row.kind === 'stilt' ? true : null, undefined, row.citations, method),
    roof: canonicalValue(row.kind === 'roof' ? true : null, undefined, row.citations, method),
    polygons: canonicalValue(null, 'unknown', row.citations, method, 'm') });
}

/** The latest reviewed schedule wins; proposals never add levels and conflicts never expand G+N expressions. */
export function applyLevelSchedules(building: NormalizedBuilding, records: RegistryRecord[]): void {
  const metadata = records.find(record => record.id === building.buildingId) as RegistryRecord & {
    canonicalLevelSchedules?: LevelSchedule[]; levelScheduleProposals?: unknown[];
  } | undefined;
  if (!metadata) return;
  if (metadata.levelScheduleProposals?.length) {
    building.levelScheduleProposals = LevelScheduleProposalSchema.array().parse(metadata.levelScheduleProposals);
  }
  const latest = metadata.canonicalLevelSchedules?.at(-1);
  if (!latest) return;
  const schedule = LevelScheduleSchema.parse(latest);
  building.levelSchedule = schedule;
  const oldGap = 'No detailed level schedule, spaces, rights or parcel association reviewed.';
  building.gaps = building.gaps.filter(gap => gap !== oldGap);
  building.gaps.push(
    'Level schedule review does not create registry spaces, rights, parcel links or surveyed elevations.',
  );
  building.levels = [];
  const citations = schedule.levels.flatMap(row => row.citations);
  const method = `reviewer:${schedule.decision.actor}`;
  if (schedule.state === 'conflicting') {
    const conflictingCitations = schedule.alternatives!.flatMap(row => row.citations);
    building.storeys = canonicalValue(null, 'conflicting', conflictingCitations, method);
    building.conflicts.push({ property: 'building.levelSchedule', reason: schedule.decision.reason,
      alternatives: schedule.alternatives!.map(row => canonicalValue(row.labelLiteral, 'candidate', row.citations)) });
    return;
  }
  building.storeys = canonicalValue([], 'reviewed', citations, method);
  for (const row of schedule.levels) projectScheduleRow(row, schedule, building);
}
