import { CANONICAL_TARGETS } from '@ulpin/contracts';
import type { ChunkMapping, Freshness, MappingJob, Metrics, Recipe, TableProfile, Target } from './types';

const STALE_REASON_WORDS: Record<Freshness['reasons'][number], string> = {
  case_advanced: 'case advanced', reader_changed: 'reader changed',
  converter_changed: 'converter changed', source_superseded: 'source superseded',
};

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

/**
 * Every chunk the job has published. The job lists only its latest 32 slots, but the first chunks raise the
 * questions and each chunk carries its own learner counts, so all of them are read by index.
 */
export function publishedChunkIndexes(job?: MappingJob): number[] {
  return Array.from({ length: job?.nextPublishIndex ?? 0 }, (_, index) => index);
}

type Question = ChunkMapping['questions'][number];

/**
 * One review per job from all of its mapped chunks: the plan and field sources of the latest chunk, and each
 * question from the first chunk that raises it. The server asks once per layout, so later chunks may carry none.
 */
export function reviewMapping(mappings: ChunkMapping[]): ChunkMapping | undefined {
  const ordered = [...mappings].sort((left, right) => left.metrics.chunkIndex - right.metrics.chunkIndex);
  const latest = ordered.at(-1);
  if (!latest) return undefined;
  const questions = new Map<string, Question>();
  for (const question of ordered.flatMap((mapping) => mapping.questions)) {
    if (!questions.has(question.sourceField)) questions.set(question.sourceField, question);
  }
  return { ...latest, questions: [...questions.values()] };
}

/** Why any of these responses is from an earlier case state, in words; null when all are current. */
export function staleReasons(responses: (Freshness | undefined)[]): string[] | null {
  const stale = responses.flatMap((response) => (response?.current === false ? [response] : []));
  if (!stale.length) return null;
  const reasons = new Set(stale.flatMap((response) => response.reasons));
  return [...reasons].map((reason) => STALE_REASON_WORDS[reason]);
}

/** A result from an earlier case state stays readable; nothing can be written from it. */
export function reviewControls(stale: boolean, recipeState: Recipe['state'] | undefined, answering: boolean) {
  return { approve: !stale && recipeState === 'proposed' && !answering, sharedReason: !stale, record: !stale,
    replay: !stale };
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
