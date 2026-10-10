import { CANONICAL_TARGETS } from '@ulpin/contracts';
import type { ChunkMapping, Metrics, TableProfile, Target } from './types';

export function targetDefinition(target: Target) {
  if (target === 'building.geometry') return CANONICAL_TARGETS['building.footprint'];
  return CANONICAL_TARGETS[target];
}

export function columnRows(profile: TableProfile, mapping?: ChunkMapping) {
  return profile.profile.columns.map((column, index) => {
    const sourceField = mapping?.profile.columns[index]?.name ?? column.name;
    const field = mapping?.plan.fields.find((item) => item.sourceField === sourceField);
    const origin = mapping?.fieldSources.find((item) => item.sourceField === sourceField)?.source;
    const question = mapping?.questions.find((item) => item.sourceField === sourceField);
    return { position: index + 1, header: profile.headers[index] ?? '', column, sourceField,
      target: field?.target ?? 'unknown', confidence: origin === 'officer' ? null : field?.confidence ?? null,
      origin, question };
  });
}

export function learnerTotals(chunks: Metrics[]) {
  return chunks.reduce((total, chunk) => ({
    teacherCalls: total.teacherCalls + chunk.teacherCalls,
    memoryHits: total.memoryHits + chunk.memoryHits,
    studentFields: total.studentFields + chunk.studentFields,
    teacherFields: total.teacherFields + chunk.teacherFields,
    needsInput: total.needsInput + chunk.needsInput,
    latencyMs: total.latencyMs + chunk.latencyMs,
  }), { teacherCalls: 0, memoryHits: 0, studentFields: 0, teacherFields: 0, needsInput: 0, latencyMs: 0 });
}

export function mergeMetrics(events: Metrics[], mappings: ChunkMapping[], jobId: string) {
  const byChunk = new Map<number, Metrics>();
  for (const metric of [...mappings.map((mapping) => mapping.metrics), ...events]) {
    if (metric.jobId === jobId) byChunk.set(metric.chunkIndex, metric);
  }
  return [...byChunk.values()].sort((left, right) => left.chunkIndex - right.chunkIndex);
}
