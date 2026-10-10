import { performance } from 'node:perf_hooks';
import { CHUNK_MAPPING_LIMITS, CaseIngestionChangeSchema, type CaseIngestionChange } from '@ulpin/contracts/usp';
import type { ColumnProfileDocument } from '@ulpin/contracts';
import { AppError } from '../../../infrastructure/errors';
import { profileColumns } from './column-profile';
import { validateMappingPlanV2 } from './mapping-plan-v2';
import {
  columnProfileHash, executeTeacherMappingDryRun, manualTeacherPlan, mappingContextFromColumnProfile, proposeMapping,
  type MappingRoutingResult,
} from './mapping-teacher';

const MAX_JOB_LAYOUTS = 32;
type RoutingOptions = Parameters<typeof proposeMapping>[1];
type FieldSource = MappingRoutingResult['fieldSources'][number];
export type MappingQuestion = { sourceField: string; header: string; reason: string; candidates: string[] };
export type TabularChunkInput = {
  jobId: string;
  chunkIndex: number;
  headers: readonly string[];
  rows: readonly (readonly unknown[])[];
  sourceRef: string;
};
export type TabularChunkDraft = {
  profile: ColumnProfileDocument;
  proposal: MappingRoutingResult;
  questions: MappingQuestion[];
  dryRun: ReturnType<typeof executeTeacherMappingDryRun>;
  metrics: Extract<CaseIngestionChange, { kind: 'mapping.chunk' }>;
};

/** Bounded kernel for the existing worker; not an admission, storage, approval or registry authority. */
export function profileTabularChunk(input: TabularChunkInput) {
  if (!input.rows.length || input.rows.length > CHUNK_MAPPING_LIMITS.chunkFeatures ||
      !input.headers.length || input.rows.some(row => row.length > input.headers.length)) {
    throw new AppError(422, 'MAPPING_TABULAR_SHAPE', 'Use a nonempty bounded complete-row chunk.');
  }
  if (Buffer.byteLength(JSON.stringify({ headers: input.headers, rows: input.rows })) >
      CHUNK_MAPPING_LIMITS.chunkBytes) {
    throw new AppError(413, 'MAPPING_CHUNK_BUDGET', 'The tabular chunk exceeds the existing mapping budget.');
  }
  // Positional prefixes retain duplicate/blank literal headers without collapsing their identities.
  const fields = input.headers.map((header, index) => ({ name: `${index + 1}|${header}` }));
  const rows = input.rows.map(row => Object.fromEntries(fields.map((field, index) => [field.name, row[index]])));
  const profile = profileColumns(rows, fields, 'tabular');
  const learnerColumns = input.headers.map((header, index) => ({
    profileId: `${columnProfileHash(profile)}/${index + 1}`, header,
    neighbourHeaders: input.headers.slice(Math.max(0, index - 2), index)
      .concat(input.headers.slice(index + 1, index + 3)),
    cellCount: rows.length,
    emptyCount: input.rows.filter(row => row[index] === undefined || row[index] === null ||
      (typeof row[index] === 'string' && !(row[index] as string).trim())).length,
  }));
  return { profile, rows, learnerColumns };
}

export function mappingQuestions(proposal: MappingRoutingResult, input: TabularChunkInput): MappingQuestion[] {
  const reasons = new Map(proposal.issues.map(issue => [issue.sourceField, issue.code]));
  return proposal.plan.fields.flatMap(field => {
    const reason = reasons.get(field.sourceField);
    if (!reason && field.target !== 'unknown' && field.confidence >= 0.5) return [];
    const position = input.headers.findIndex((header, index) => field.sourceField === `${index + 1}|${header}`);
    if (position < 0) throw new Error('MAPPING_QUESTION_FIELD_INVALID');
    return [{ sourceField: field.sourceField, header: input.headers[position],
      reason: reason ?? 'MAPPING_REVIEW_REQUIRED', candidates: field.target === 'unknown' ? [] : [field.target] }];
  });
}

function reuseProposal(prior: MappingRoutingResult, profile: ColumnProfileDocument): MappingRoutingResult {
  const checked = validateMappingPlanV2(prior.plan, mappingContextFromColumnProfile(profile));
  if (!checked.success) {
    return { ...manualTeacherPlan(profile, 'MAPPING_CACHED_PLAN_STALE'),
      activeLearnerVersion: prior.activeLearnerVersion, memoryReasonCode: checked.errors[0].code,
      studentReasonCode: null, fieldSources: profile.columns.map(column => ({
        sourceField: column.name, source: 'memory', method: prior.plan.method,
      })) };
  }
  return { ...prior, plan: checked.plan, profileHash: columnProfileHash(profile), attempts: 0,
    activeLearnerVersion: prior.activeLearnerVersion,
    fieldSources: prior.fieldSources.map(field => ({ ...field,
      source: field.source === 'officer' ? 'officer' : 'memory' })) };
}

function chunkMetrics(
  input: TabularChunkInput, proposal: MappingRoutingResult, cached: boolean, latencyMs: number,
): TabularChunkDraft['metrics'] {
  const count = (source: FieldSource['source']) =>
    proposal.fieldSources.filter(field => field.source === source).length;
  const memory = cached || count('memory') + count('officer') === input.headers.length;
  const event = CaseIngestionChangeSchema.parse({ kind: 'mapping.chunk', jobId: input.jobId,
    chunkIndex: input.chunkIndex, layout: memory ? 'memory' : 'new', teacherCalls: proposal.attempts,
    memoryHits: Number(memory), studentFields: count('student'), teacherFields: count('teacher'),
    needsInput: mappingQuestions(proposal, input).length, latencyMs,
    learnerVersion: proposal.activeLearnerVersion });
  if (event.kind !== 'mapping.chunk') throw new Error('MAPPING_CHUNK_EVENT_INVALID');
  return event;
}

/** Job-local validated proposal reuse does not create shared accepted memory or learning examples. */
export class TabularChunkMapper {
  private readonly layouts = new Map<string, MappingRoutingResult>();

  async map(input: TabularChunkInput, options: RoutingOptions): Promise<TabularChunkDraft> {
    const started = performance.now();
    await options.authorize(); // Every cached chunk must still pass the current source/fence authorization.
    const prepared = profileTabularChunk(input);
    const prior = options.dataPolicy.split === 'held_out'
      ? undefined : this.layouts.get(prepared.profile.layoutFingerprint);
    const cached = prior ? reuseProposal(prior, prepared.profile) : null;
    const proposal = cached ?? await this.routeLayout(prepared, options);
    const checked = validateMappingPlanV2(proposal.plan, mappingContextFromColumnProfile(prepared.profile));
    if (!checked.success) throw new AppError(422, 'MAPPING_PLAN_INVALID', 'The routed plan failed verification.');
    const dryRun = executeTeacherMappingDryRun(proposal, prepared.rows, {
      ...mappingContextFromColumnProfile(prepared.profile), sourceRef: input.sourceRef,
    });
    const issues = new Map(proposal.issues.map(issue => [issue.sourceField, issue]));
    for (const row of dryRun.rows) {
      for (const cell of row.fields) {
        if (cell.issueCode) issues.set(cell.sourceField, {
          sourceField: cell.sourceField, state: 'needs_input', code: cell.issueCode,
        });
      }
    }
    const verified: MappingRoutingResult = { ...proposal, issues: [...issues.values()],
      state: issues.size ? 'needs_input' : 'candidate' };
    if (options.dataPolicy.split !== 'held_out' && this.layouts.size < MAX_JOB_LAYOUTS) {
      this.layouts.set(prepared.profile.layoutFingerprint, verified);
    }
    return { profile: prepared.profile, proposal: verified, dryRun, questions: mappingQuestions(verified, input),
      metrics: chunkMetrics(input, verified, Boolean(cached), Math.round((performance.now() - started) * 100) / 100) };
  }

  private async routeLayout(prepared: ReturnType<typeof profileTabularChunk>, options: RoutingOptions) {
    if (this.layouts.size >= MAX_JOB_LAYOUTS) {
      const fallback = manualTeacherPlan(prepared.profile, 'MAPPING_LAYOUT_CAP');
      return { ...fallback, activeLearnerVersion: null, fieldSources: prepared.profile.columns.map(column => ({
        sourceField: column.name, source: 'teacher' as const, method: fallback.plan.method,
      })), memoryReasonCode: 'MAPPING_LAYOUT_CAP', studentReasonCode: null };
    }
    return proposeMapping(prepared.profile, { ...options, learnerColumns: prepared.learnerColumns });
  }
}
