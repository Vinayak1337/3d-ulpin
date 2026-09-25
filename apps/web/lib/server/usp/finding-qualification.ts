import type { PoolClient } from 'pg';
import { UspGeometryMetadataSchema } from '@ulpin/contracts/usp';
import { AppError } from '../errors';
import { sameCanonicalGeometryPayload, withUspAnalyticalReader, withUspAnalyticalReaderTx,
  type UspAnalyticalPurpose } from './geometry';

// Structural metadata types also accept the existing full, saved PhysicalFeature bodies.
// They do not manufacture geometry or fill gaps in legacy findings.
export interface FindingParticipant {
  id: string; revision: number; sourceRevisionId: string;
}
export interface FindingEvidence {
  id: string; featureIds: readonly string[];
  participants?: readonly FindingParticipant[];
  inputRevisions?: readonly { featureId: string; revision: number; sourceRevisionId: string }[];
}
export interface QualifiedParticipantRow {
  id: string; revision: number; body: FindingParticipant; metadata: unknown;
}
export type FindingQualification = {
  state: 'qualified' | 'not_assessed';
  missing: { findingId: string; participantId: string | null; reason: string }[];
};

function sourceRevisionIds(value: unknown, result = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'sourceRevisionId' && typeof child === 'string') result.add(child);
      else if (child && typeof child === 'object') sourceRevisionIds(child, result);
    }
  }
  return result;
}

/** Rows must come from usp_analytic_geometry: SQL verifies exact canonical body hashes,
 * accepted receipts and every source revision/hash against the current source authority.
 * Compare SAVED bodies, never rehydrate an old finding with newer participant geometry. */
export function assessFindingParticipants(findings: readonly FindingEvidence[], rows: readonly QualifiedParticipantRow[]): FindingQualification {
  const missing: FindingQualification['missing'] = [];
  for (const finding of findings) {
    const ids = finding.featureIds;
    const participants = finding.participants ?? [];
    const revisions = finding.inputRevisions ?? [];
    const reject = (participantId: string | null, reason: string) => missing.push({ findingId: finding.id, participantId, reason });
    if (!ids.length || new Set(ids).size !== ids.length || participants.length !== ids.length || revisions.length !== ids.length ||
        participants.some(p => !ids.includes(p.id)) || revisions.some(p => !ids.includes(p.featureId))) {
      reject(null, 'participant_pins_incomplete');
    }
    for (const id of ids) {
      const saved = participants.filter(p => p.id === id);
      const pins = revisions.filter(p => p.featureId === id);
      if (saved.length !== 1 || pins.length !== 1 || !Number.isInteger(saved[0].revision) || saved[0].revision < 1 ||
          !saved[0].sourceRevisionId || saved[0].revision !== pins[0].revision || saved[0].sourceRevisionId !== pins[0].sourceRevisionId) {
        reject(id, 'participant_pins_incomplete'); continue;
      }
      const participant = saved[0];
      const current = rows.filter(row => row.id === id && row.revision === participant.revision);
      if (current.length !== 1 || !sameCanonicalGeometryPayload(
        current[0].body as unknown as Record<string, unknown>, participant as unknown as Record<string, unknown>)) {
        reject(id, 'saved_participant_not_currently_qualified'); continue;
      }
      const metadata = UspGeometryMetadataSchema.safeParse(current[0].metadata);
      if (!metadata.success || !metadata.data.analyticEligible || metadata.data.qualification.state !== 'qualified') {
        reject(id, 'participant_qualification_unavailable'); continue;
      }
      const qualifiedSources = new Set(metadata.data.qualification.sources.filter(pin =>
        pin.source.ref.namespace === 'source_revision' && pin.source.revision > 0).map(pin => pin.source.ref.id));
      if ([...sourceRevisionIds(participant)].some(id => !qualifiedSources.has(id))) {
        reject(id, 'participant_source_pins_incomplete');
      }
    }
  }
  return { state: missing.length ? 'not_assessed' : 'qualified', missing };
}

/** One participant-complete guard for creation, readiness, current projection and exports. */
export async function qualifyFindingParticipants(purpose: UspAnalyticalPurpose, findings: readonly FindingEvidence[], client?: PoolClient) {
  if (findings.length > 10000 || findings.some(finding => finding.featureIds.length > 10000))
    throw new AppError(413, 'USP_GEOMETRY_SCOPE', 'Select a smaller finding scope.');
  const ids = [...new Set(findings.flatMap(finding => [...finding.featureIds]))];
  if (ids.length > 10000) throw new AppError(413, 'USP_GEOMETRY_SCOPE', 'Select a smaller finding scope.');
  const read = async (reader: PoolClient) => (await reader.query<QualifiedParticipantRow>(
    `SELECT id,revision,body,metadata FROM usp_analytic_geometry
     WHERE namespace='area_feature' AND id::text=ANY($1::text[])`, [ids])).rows;
  const rows = ids.length ? (client ? await withUspAnalyticalReaderTx(client, purpose, read)
    : await withUspAnalyticalReader(purpose, read)) : [];
  return assessFindingParticipants(findings, rows);
}
export async function requireQualifiedFindingParticipants(purpose: UspAnalyticalPurpose, findings: readonly FindingEvidence[], client?: PoolClient) {
  const result = await qualifyFindingParticipants(purpose, findings, client);
  if (result.state !== 'qualified') throw new AppError(422, 'USP_FINDING_PARTICIPANTS_NOT_QUALIFIED',
    'Findings are not assessed: every saved participant body, revision and source must remain qualified. Historical findings remain available for inspection.');
  return result;
}

export async function projectFindingHistory<T extends { findings: FindingEvidence[] }>(purpose: UspAnalyticalPurpose, value: T, client?: PoolClient) {
  const qualification = await qualifyFindingParticipants(purpose, value.findings, client);
  return { ...value, findings: qualification.state === 'qualified' ? value.findings : [],
    analysisState: qualification.state, findingQualification: qualification,
    historicalFindings: qualification.state === 'qualified' ? undefined
      : { purpose: 'retained_history_inspection', currentAnalyticalEligibility: false, findings: value.findings } };
}
