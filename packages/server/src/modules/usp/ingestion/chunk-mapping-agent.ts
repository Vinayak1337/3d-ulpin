import { performance } from 'node:perf_hooks';
import { CHUNK_MAPPING_LIMITS, CaseIngestionChangeSchema, type CaseIngestionChange } from '@ulpin/contracts/usp';
import type { ColumnProfileDocument, MappingPlanV2 } from '@ulpin/contracts';
import { AppError } from '../../../infrastructure/errors';
import { profileColumns } from './column-profile';
import { layoutFingerprint, tabularLayoutFingerprint, validateMappingPlanV2 } from './mapping-plan-v2';
import { lookupMappingMemory } from './mapping-memory';
import {
  columnProfileHash, executeTeacherMappingDryRun, manualTeacherPlan, mappingContextFromColumnProfile, proposeMapping,
  learnerVersion, type MappingRoutingResult,
} from './mapping-teacher';

const MAX_JOB_LAYOUTS = 32;
type RoutingOptions = Parameters<typeof proposeMapping>[1] & { approvedPlan?: MappingPlanV2 };
type FieldSource = MappingRoutingResult['fieldSources'][number];
export type MappingQuestion = { sourceField: string; header: string; reason: string; candidates: string[] };
export type TabularChunkInput = {
  jobId: string;
  chunkIndex: number;
  headers: readonly string[];
  rows: readonly (readonly unknown[])[];
  sourceRef: string;
  rowOffset?: number;
  selection?: { sheet: string; headerRows: readonly number[] };
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
    throw new AppError(422, 'MAPPING_TABULAR_SHAPE', 'Use bounded nonempty rows no wider than the headers.');
  }
  if (Buffer.byteLength(JSON.stringify({ headers: input.headers, rows: input.rows })) >
      CHUNK_MAPPING_LIMITS.chunkBytes) {
    throw new AppError(413, 'MAPPING_CHUNK_BUDGET', 'The tabular chunk exceeds the existing mapping budget.');
  }
  // Positional prefixes retain duplicate/blank literal headers without collapsing their identities.
  const fields = input.headers.map((header, index) => ({ name: `${index + 1}|${header}`, literalHeader: header }));
  const rows = input.rows.map(row => Object.fromEntries(fields.map((field, index) => [field.name, row[index]])));
  const observed = profileColumns(rows, fields, 'tabular');
  const profile = input.selection ? { ...observed,
    layoutFingerprint: tabularLayoutFingerprint(observed.columns, input.selection) } : observed;
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

export function mappingQuestions(
  proposal: MappingRoutingResult, input: Pick<TabularChunkInput, 'headers'>,
): MappingQuestion[] {
  const reasons = new Map(proposal.issues.map(issue => [issue.sourceField, issue.code]));
  return proposal.plan.fields.flatMap(field => {
    const reason = reasons.get(field.sourceField);
    const provenance = proposal.fieldSources.find(source => source.sourceField === field.sourceField);
    const officer = provenance?.source === 'officer';
    if (!reason && officer) return [];
    if (!reason && field.target !== 'unknown' && field.confidence >= 0.5) return [];
    const position = input.headers.findIndex((header, index) => field.sourceField === `${index + 1}|${header}`);
    if (position < 0) throw new Error('MAPPING_QUESTION_FIELD_INVALID');
    return [{ sourceField: field.sourceField, header: input.headers[position],
      reason: reason ?? 'MAPPING_REVIEW_REQUIRED', candidates: field.target === 'unknown' ? [] : [field.target] }];
  });
}

function reuseProposal(
  prior: MappingRoutingResult, profile: ColumnProfileDocument, selection?: TabularChunkInput['selection'],
): MappingRoutingResult {
  const checked = validateMappingPlanV2(prior.plan, mappingContextFromColumnProfile(profile, selection));
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
  input: TabularChunkInput, proposal: MappingRoutingResult, questions: MappingQuestion[],
  cached: boolean, latencyMs: number,
): TabularChunkDraft['metrics'] {
  const count = (source: FieldSource['source']) =>
    proposal.fieldSources.filter(field => field.source === source).length;
  const memory = cached || proposal.memoryMatched === true || count('memory') === input.headers.length;
  const event = CaseIngestionChangeSchema.parse({ kind: 'mapping.chunk', jobId: input.jobId,
    chunkIndex: input.chunkIndex, layout: memory ? 'memory' : 'new', teacherCalls: proposal.attempts,
    memoryHits: Number(memory), studentFields: count('student'), teacherFields: count('teacher'),
    needsInput: questions.length, latencyMs,
    learnerVersion: proposal.activeLearnerVersion });
  if (event.kind !== 'mapping.chunk') throw new Error('MAPPING_CHUNK_EVENT_INVALID');
  return event;
}

function verifiedProposal(proposal: MappingRoutingResult, dryRun: TabularChunkDraft['dryRun']): MappingRoutingResult {
  const issues = new Map(proposal.issues.map(issue => [issue.sourceField, issue]));
  for (const row of dryRun.rows) {
    for (const cell of row.fields) {
      if (cell.issueCode) issues.set(cell.sourceField, {
        sourceField: cell.sourceField, state: 'needs_input', code: cell.issueCode,
      });
    }
  }
  return { ...proposal, issues: [...issues.values()], state: issues.size ? 'needs_input' : 'candidate' };
}

function officerProposal(
  plan: MappingPlanV2, profile: ColumnProfileDocument, modelPath?: string,
  selection?: TabularChunkInput['selection'],
): MappingRoutingResult {
  const checked = validateMappingPlanV2({ ...plan, layoutFingerprint: profile.layoutFingerprint,
    ...(selection ? { layoutFingerprintVersion: 'tabular-header/2' as const } : {}) },
    mappingContextFromColumnProfile(profile, selection));
  if (!checked.success) {
    throw new AppError(422, 'MAPPING_APPROVED_PLAN_INVALID', 'The approved plan failed chunk revalidation.');
  }
  return { ...manualTeacherPlan(profile, 'MAPPING_REVIEW_REQUIRED'), plan: checked.plan, issues: [], state: 'candidate',
    activeLearnerVersion: learnerVersion(modelPath), memoryReasonCode: null, studentReasonCode: null,
    fieldSources: profile.columns.map(column => ({
      sourceField: column.name, source: 'officer', method: plan.method,
    })) };
}

function acceptedMemoryProposal(
  memory: ReturnType<typeof lookupMappingMemory>, profile: ColumnProfileDocument, modelPath?: string,
): MappingRoutingResult {
  const base = manualTeacherPlan(profile, 'MAPPING_REVIEW_REQUIRED');
  const officer = memory.lineage?.source === 'officer';
  return { ...base, plan: memory.plan!, ...(officer ? { issues: [], state: 'candidate' as const } : {}),
    activeLearnerVersion: learnerVersion(modelPath), memoryMatched: true,
    memoryReasonCode: null, studentReasonCode: null,
    fieldSources: profile.columns.map(column => ({ sourceField: column.name,
      source: officer ? 'officer' : 'memory', method: memory.plan!.method })) };
}

/** Job-local validated proposal reuse does not create shared accepted memory or learning examples. */
export class TabularChunkMapper {
  private readonly layouts = new Map<string, MappingRoutingResult>();
  private readonly asked = new Map<string, number>();

  async map(input: TabularChunkInput, options: RoutingOptions): Promise<TabularChunkDraft> {
    const started = performance.now();
    await options.authorize(); // Every cached chunk must still pass the current source/fence authorization.
    const prepared = profileTabularChunk(input);
    const layoutKey = `${prepared.profile.layoutFingerprint}/${options.learnerModelPath ?? 'none'}`;
    const prior = options.dataPolicy.split === 'held_out' ? undefined : this.layouts.get(layoutKey);
    const cached = prior && !options.approvedPlan ? reuseProposal(prior, prepared.profile, input.selection) : null;
    const proposal = options.approvedPlan
      ? officerProposal(options.approvedPlan, prepared.profile, options.learnerModelPath, input.selection)
      : cached ?? await this.routeLayout(prepared, options, input.selection);
    const context = mappingContextFromColumnProfile(prepared.profile, input.selection);
    const checked = validateMappingPlanV2(proposal.plan, context);
    if (!checked.success) throw new AppError(422, 'MAPPING_PLAN_INVALID', 'The routed plan failed verification.');
    const dryRun = executeTeacherMappingDryRun(proposal, prepared.rows, {
      ...context, sourceRef: input.sourceRef, rowOffset: input.rowOffset,
    });
    const verified = verifiedProposal(proposal, dryRun);
    if (options.dataPolicy.split !== 'held_out' && this.layouts.size < MAX_JOB_LAYOUTS) {
      this.layouts.set(layoutKey, verified);
    }
    const questions = mappingQuestions(verified, input);
    const draft = { profile: prepared.profile, proposal: verified, dryRun, questions,
      metrics: chunkMetrics(input, verified, questions, Boolean(cached),
        Math.round((performance.now() - started) * 100) / 100) };
    this.deduplicateQuestions(draft);
    return draft;
  }

  /** Permit final native-cell annotation on the same chunk without asking again on a later chunk. */
  deduplicateQuestions(draft: TabularChunkDraft) {
    draft.questions = draft.questions.filter(question => {
      const key = `${draft.profile.layoutFingerprint}/${question.sourceField}/${question.reason}`;
      const firstChunk = this.asked.get(key);
      if (firstChunk !== undefined) return firstChunk === draft.metrics.chunkIndex;
      if (this.asked.size < MAX_JOB_LAYOUTS * 256) this.asked.set(key, draft.metrics.chunkIndex);
      return true;
    });
  }

  private async routeLayout(
    prepared: ReturnType<typeof profileTabularChunk>, options: RoutingOptions,
    selection?: TabularChunkInput['selection'],
  ) {
    const context = mappingContextFromColumnProfile(prepared.profile, selection);
    const memory = selection && options.dataPolicy.split !== 'held_out'
      ? lookupMappingMemory(prepared.profile.layoutFingerprint, context, options.memoryPath) : null;
    if (memory?.plan) return acceptedMemoryProposal(memory, prepared.profile, options.learnerModelPath);
    const routing = { ...options, learnerColumns: prepared.learnerColumns };
    if (this.layouts.size >= MAX_JOB_LAYOUTS) {
      // The layout cap limits teacher dispatch, not already accepted memory or local student inference.
      routing.teacher = async profile => manualTeacherPlan(profile, 'MAPPING_LAYOUT_CAP');
    }
    const observed = { ...prepared.profile, layoutFingerprint: layoutFingerprint(prepared.profile.columns) };
    const proposed = await proposeMapping(observed, routing);
    return { ...proposed, plan: { ...proposed.plan, layoutFingerprint: prepared.profile.layoutFingerprint,
      ...(selection ? { layoutFingerprintVersion: 'tabular-header/2' as const } : {}) } };
  }
}
