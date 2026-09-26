import type { AreaFeature, RegisterRecord } from '../../../api/queries';
import { parseLocator, type EvidenceRef } from '../../evidence/refs';

/** Evidence refs for an area feature's geometry and its height, from the record's own pointers. */
export function featureEvidence(feature: AreaFeature): { geometry: EvidenceRef[]; height: EvidenceRef[] } {
  const subject = { id: feature.id, name: feature.name };
  const geometry = feature.evidence.map((e) => ({
    sourceId: e.sourceRevisionId, label: feature.datasetNamespace, subject,
    locator: parseLocator({ jsonPointer: e.jsonPointer, row: e.row }),
  }));
  const height = (feature.height.evidence ?? []).map((e) => ({
    sourceId: e.sourceRevisionId, label: 'Roof height', subject,
    locator: parseLocator({ jsonPointer: e.jsonPointer, row: e.row }),
  }));
  return { geometry, height };
}

export function recordEvidence(record: RegisterRecord, sourceName: (id: string) => string, subjectName: string): EvidenceRef[] {
  return record.evidence.map((e) => ({
    sourceId: e.sourceId, label: sourceName(e.sourceId), subject: { id: record.id, name: subjectName },
    locator: parseLocator({ locator: e.locator }),
  }));
}
