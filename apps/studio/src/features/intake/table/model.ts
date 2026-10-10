import { CANONICAL_TARGETS } from '@ulpin/contracts';
import type { ChunkMapping, Freshness, MappingJob, Metrics, Recipe, TableProfile, Target } from './types';

const STALE_REASON_WORDS: Record<Freshness['reasons'][number], string> = {
  case_advanced: 'case advanced', reader_changed: 'reader changed',
  converter_changed: 'converter changed', source_superseded: 'source superseded',
};

// Reasons the server gives when nobody answered a column, in words. A code not listed here is shown as it is.
const NO_ANSWER_WORDS: Record<string, string> = {
  TEACHER_UNAVAILABLE: 'teacher unavailable',
  TEACHER_INPUT_LIMIT: 'table too long; mapping teacher not asked',
  TEACHER_BUDGET_EXHAUSTED: 'teacher budget exhausted',
  TEACHER_RATE_LIMITED: 'teacher rate limited',
  TEACHER_AUTH_FAILED: 'teacher authorisation failed',
  TEACHER_REPLAY_UNAVAILABLE: 'teacher replay unavailable',
  TEACHER_RECORDING_UNAVAILABLE: 'teacher recording unavailable',
  TEACHER_INVALID_PLAN: 'teacher plan invalid',
  TEACHER_DUPLICATE_TARGET: 'teacher plan repeated a target',
  MAPPING_CACHED_PLAN_STALE: 'cached plan stale',
  MAPPING_TEACHER_SCHEMA_INVALID: 'teacher answer failed its schema',
};
const MANUAL_METHOD = 'manual:';

type FieldSource = ChunkMapping['fieldSources'][number];

/** Nobody answered this column: an `unanswered` source, or a `manual:` method that an older job stored as memory. */
function noAnswerReason(source: FieldSource | undefined): string | null {
  if (!source) return null;
  const manual = source.method.startsWith(MANUAL_METHOD);
  if (source.source !== 'unanswered' && !(source.source === 'memory' && manual)) return null;
  const code = manual ? source.method.slice(MANUAL_METHOD.length) : source.method;
  return NO_ANSWER_WORDS[code] ?? code;
}

/**
 * Nobody answered a column either when the server still asks about it with one of those codes and its plan
 * proposes no target: the stored job of a table imported without a teacher names a model as the field's source.
 */
function unansweredQuestion(question: Question | undefined, target: Target, origin: FieldSource['source'] | undefined) {
  if (!question || target !== 'unknown' || origin === 'officer') return null;
  return NO_ANSWER_WORDS[question.reason] ?? null;
}

// A question whose reason is a code, as a sentence. A reason not listed here is the server's own wording.
const QUESTION_WORDS: Record<string, string> = {
  TEACHER_UNAVAILABLE: 'No teacher was available when this table was imported: this column is unmapped.',
  TEACHER_INPUT_LIMIT: 'This table is too long for one request, so the mapping teacher was not asked '
    + 'and the columns are left for the officer.',
};

export function questionWords(reason: string): string {
  return QUESTION_WORDS[reason] ?? reason;
}

export function targetDefinition(target: Target) {
  if (target === 'building.geometry') return CANONICAL_TARGETS['building.footprint'];
  return CANONICAL_TARGETS[target];
}

export function columnRows(profile: TableProfile, mapping?: ChunkMapping) {
  return profile.profile.columns.map((column, index) => {
    const sourceField = mapping?.profile.columns[index]?.name ?? column.name;
    const field = mapping?.plan.fields.find((item) => item.sourceField === sourceField);
    const source = mapping?.fieldSources.find((item) => item.sourceField === sourceField);
    const origin = source?.source;
    const target = field?.target ?? 'unknown';
    const question = mapping?.questions.find((item) => item.sourceField === sourceField);
    const noAnswer = noAnswerReason(source) ?? unansweredQuestion(question, target, origin);
    return { position: index + 1, header: profile.headers[index] ?? '', column, sourceField, target,
      confidence: origin === 'officer' || noAnswer !== null ? null : field?.confidence ?? null,
      origin, noAnswer, question };
  });
}

type ColumnRow = ReturnType<typeof columnRows>[number];

/** A column nobody answered and no target is proposed for: it says "Unmapped", not the name of a target. */
export function isUnmapped(row: Pick<ColumnRow, 'noAnswer' | 'target'>): boolean {
  return row.noAnswer !== null && row.target === 'unknown';
}

/**
 * The confidence cell in words: who decided, or a percentage only when the answer holds a confidence. Null when
 * nobody answered: there is no confidence to print, and 0% would read as a measured one.
 */
export function confidenceText(row: Pick<ColumnRow, 'origin' | 'noAnswer' | 'confidence'>): string | null {
  if (row.origin === 'officer') return 'Officer decision';
  if (row.noAnswer !== null) return null;
  return row.confidence === null ? 'Unknown' : `${Math.round(row.confidence * 100)}%`;
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

/**
 * Sums of the chunk counts. Questions are not summed: the same question is raised for each chunk of a layout, so
 * the open questions are the review's joined list. The unanswered count is summed over the chunks that report it.
 */
export function learnerTotals(chunks: Metrics[]) {
  const reporting = chunks.filter((chunk) => chunk.unansweredFields !== undefined);
  return {
    chunks: chunks.length,
    teacherCalls: sumOf(chunks, 'teacherCalls'),
    memoryHits: sumOf(chunks, 'memoryHits'),
    studentFields: sumOf(chunks, 'studentFields'),
    teacherFields: sumOf(chunks, 'teacherFields'),
    unansweredFields: sumOf(reporting, 'unansweredFields'),
    unansweredNotReported: chunks.length - reporting.length,
    latencyMs: sumOf(chunks, 'latencyMs'),
  };
}

function sumOf(chunks: Metrics[], key: Exclude<keyof Metrics, 'kind' | 'jobId' | 'layout' | 'learnerVersion'>) {
  return chunks.reduce((total, chunk) => total + (chunk[key] ?? 0), 0);
}

/** The total of unanswered fields: never 0 for chunks that did not report the count. */
export function unansweredTotalText(totals: ReturnType<typeof learnerTotals>): string {
  const { chunks, unansweredFields, unansweredNotReported } = totals;
  if (unansweredNotReported === 0) return String(unansweredFields);
  const missing = `Not reported for ${unansweredNotReported} of ${chunks} chunks`;
  return unansweredNotReported === chunks ? missing : `${unansweredFields} · ${missing}`;
}

export function mergeMetrics(events: Metrics[], mappings: ChunkMapping[], jobId: string) {
  const byChunk = new Map<number, Metrics>();
  for (const metric of [...mappings.map((mapping) => mapping.metrics), ...events]) {
    if (metric.jobId === jobId) byChunk.set(metric.chunkIndex, metric);
  }
  return [...byChunk.values()].sort((left, right) => left.chunkIndex - right.chunkIndex);
}
