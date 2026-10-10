import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_TARGETS,
  canonicalTarget,
  ColumnProfileDocumentSchema,
  MappingV2OperationSchema,
  type ColumnProfileDocument,
  type MappingPlanV2,
} from '@ulpin/contracts';
import type { RequestContext } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { minimizeMessages } from '../../model-gateway/adapter';
import { hash } from '../../model-gateway/config';
import type { ModelGateway, TrustedCall } from '../../model-gateway/gateway';
import { TeacherRecordings } from '../../model-gateway/recordings';
import { mappingTeacherGatewayRuntime } from '../../model-gateway/runtime';
import { validateMappingPlanV2, layoutFingerprint, type MappingValidationResult } from './mapping-plan-v2';
import { maskColumnSample } from './column-profile';
import {
  executeMappingPlanV2,
  mappedCellCounts,
  type MappingRow,
  type MappingExecutionContext,
} from './mapping-executor';
import { MAPPING_TEACHER_SYSTEM_PROMPT } from './mapping-teacher-prompt';
import { lookupMappingMemory } from './mapping-memory';

export const MAPPING_TEACHER_TEMPLATE = 'mapping-teacher/2.1';
export const MAPPING_TEACHER_MODEL = 'sarvam-105b';
export const MAPPING_TEACHER_METHOD = 'model:sarvam-105b@2026-10-10';
/** The request is over the gateway's size bound: with no samples left, the gateway is not asked. */
const TEACHER_INPUT_LIMIT = 'TEACHER_INPUT_LIMIT';
const MANUAL_MAPPING_METHOD_PREFIX = 'manual:';
/** Names a plan nobody interpreted, outside the `model:` namespace. */
export const manualMappingMethod = (code: string) => `${MANUAL_MAPPING_METHOD_PREFIX}${code}`;
export const isManualMappingMethod = (method: string) => method.startsWith(MANUAL_MAPPING_METHOD_PREFIX);
export type TeacherDataPolicy = {
  dataClass: 'public' | 'private' | 'restricted';
  split: 'development' | 'unlabelled' | 'held_out';
};
export type TeacherIssue = { sourceField: string; state: 'needs_input'; code: string };
export type GatewayRefusal = { code: string; retryable: boolean };
export type MappingTeacherResult = {
  plan: MappingPlanV2;
  issues: TeacherIssue[];
  state: 'candidate' | 'needs_input';
  profileHash: string;
  attempts: number;
  replayed: boolean;
  validationCodes: string[];
  gatewayRefusal?: GatewayRefusal;
  columnGroups?: number;
  samplesPerColumn?: number[];
};

type TeacherOptions = {
  context: RequestContext;
  dataPolicy: TeacherDataPolicy;
  gateway?: ModelGateway;
  runtime?: () => Promise<ModelGateway | undefined>;
  authorize: () => Promise<void>;
  invocationKey?: string;
  maxAttempts?: 1 | 2;
  recordings?: TeacherRecordings;
};
type AttemptMetadata = Pick<
  MappingTeacherResult,
  'profileHash' | 'attempts' | 'replayed' | 'validationCodes' | 'gatewayRefusal' |
  'columnGroups' | 'samplesPerColumn'
>;
type TeacherCallContext = {
  profile: ColumnProfileDocument;
  options: TeacherOptions;
  gateway: ModelGateway;
  recordings?: TeacherRecordings;
  deadlineAt: Date;
  invocationKey: string;
};

const TeacherOutputSchema = z.strictObject({
  fields: z
    .array(
      z.strictObject({
        sourceField: z.string(),
        target: z.enum(
          Object.keys(CANONICAL_TARGETS) as [
            keyof typeof CANONICAL_TARGETS,
            ...(keyof typeof CANONICAL_TARGETS)[],
          ],
        ),
        operation: MappingV2OperationSchema,
        confidence: z.enum(['none', 'low', 'medium', 'high']),
        rationale: z
          .string()
          .min(1)
          .max(1000)
          .refine((text) => !/[0-9०-९]|EPSG|coordinates?/iu.test(text), 'No literal facts in explanations.'),
      }),
    )
    .min(1)
    .max(256),
});
type TeacherOutputField = z.infer<typeof TeacherOutputSchema>['fields'][number];

export const columnProfileHash = (profile: ColumnProfileDocument) =>
  hash(ColumnProfileDocumentSchema.parse(profile));
export const teacherReplayKey = (profileHash: string) =>
  hash({
    template: MAPPING_TEACHER_TEMPLATE,
    profileHash,
    model: MAPPING_TEACHER_MODEL,
  });

function alias(index: number): string {
  let remaining = index + 1;
  let text = '';
  while (remaining) {
    remaining--;
    text = String.fromCharCode(97 + (remaining % 26)) + text;
    remaining = Math.floor(remaining / 26);
  }
  return 'column_' + text;
}

function headerMask(name: string): string {
  return name
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi, '[PAN]')
    .replace(/[0-9०-९]{6,}/gu, '[identifier]');
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw);
}

function schemaNode(raw: unknown, ...path: string[]): Record<string, unknown> {
  let current = raw;
  for (const key of path) {
    if (!isRecord(current)) throw new Error('MAPPING_TEACHER_SCHEMA_INVALID');
    current = current[key];
  }
  if (!isRecord(current)) throw new Error('MAPPING_TEACHER_SCHEMA_INVALID');
  return current;
}

function outputSchema(sourceAliases: string[]): Record<string, unknown> {
  const schema = z.toJSONSchema(TeacherOutputSchema);
  const properties = schemaNode(schema, 'properties', 'fields', 'items', 'properties');
  properties.sourceField = { type: 'string', enum: sourceAliases };
  const operation = schemaNode(properties, 'operation');
  const variants = operation.oneOf ?? operation.anyOf;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      if (!isRecord(variant) || !isRecord(variant.properties)) continue;
      if ('parentField' in variant.properties) {
        variant.properties.parentField = { type: 'string', enum: sourceAliases };
      }
    }
  }
  return schema;
}

/**
 * The masker's four whole-sample tokens start with "[" and are not JSON, which the shared minimizer refuses.
 * A request carries these forms instead; the profile, its hash and its replay key keep the masker's spelling.
 * The masker cannot write a form from cell text: it masks the word "cell".
 */
const PROMPT_SAMPLE_FORMS = new Map([
  ['[absent]', '(absent cell)'],
  ['[blank]', '(blank cell)'],
  ['[array]', '(array cell)'],
  ['[object]', '(object cell)'],
]);

const promptSample = (sample: string, name: string) =>
  PROMPT_SAMPLE_FORMS.get(sample) ?? maskColumnSample(sample, name);

/** What one request translated, for its evidence: each token present, its form and the number of samples. */
function promptSampleForms(profile: ColumnProfileDocument) {
  const samples = profile.columns.flatMap((column) => column.maskedSamples);
  return [...PROMPT_SAMPLE_FORMS].flatMap(([token, form]) => {
    const count = samples.filter((sample) => sample === token).length;
    return count ? [{ token, form, samples: count }] : [];
  });
}

function promptColumns(profile: ColumnProfileDocument) {
  return profile.columns.map((column, index) => ({
    // The shared minimizer treats the JSON key "name" as personal information.
    header: headerMask(column.name),
    sourceField: alias(index),
    inferredType: column.inferredType,
    ...(column.declaredUnit ? { declaredUnit: column.declaredUnit } : {}),
    valueShapes: column.valueShapes,
    maskedSamples: column.maskedSamples.map((value) => promptSample(value, column.name)),
  }));
}

/** The profile with at most `samples` sample values in each column; every column and its order are kept. */
const withSamples = (profile: ColumnProfileDocument, samples: number): ColumnProfileDocument => ({
  ...profile,
  columns: profile.columns.map((column) => ({ ...column, maskedSamples: column.maskedSamples.slice(0, samples) })),
});

/** The gateway's own answer for these messages: true when it would refuse them for size. */
export function overGatewayBound(messages: Parameters<typeof minimizeMessages>[0]): boolean {
  try {
    minimizeMessages(messages);
    return false;
  } catch (error) {
    return error instanceof AppError && error.code === 'MODEL_INPUT_LIMIT';
  }
}

/**
 * A request within the gateway's size bound is built from every sample of the profile. One over it carries fewer
 * samples per column, the same number for every column, one fewer at a time down to none. `samplesPerColumn` is
 * the number it ended on; `overBound` says that it is still too long with none, and then it must not be asked.
 * The bound checked is the one on messages: beside it the gateway's bound on the whole body, which adds the
 * output schema, cannot be the one that refuses a profile of at most 256 columns.
 */
export function mappingTeacherRequest(profile: ColumnProfileDocument, errors: string[] = []) {
  const inspected = ColumnProfileDocumentSchema.parse(profile);
  const most = Math.max(0, ...inspected.columns.map((column) => column.maskedSamples.length));
  for (let samples = most; ; samples--) {
    const request = requestWithSamples(withSamples(inspected, samples), errors);
    const overBound = overGatewayBound(request.messages);
    if (!overBound || samples === 0) return { ...request, samplesPerColumn: samples, overBound };
  }
}

/** Consecutive balanced subsets; the first groups receive the remainder columns. */
function columnGroupProfiles(profile: ColumnProfileDocument, count: number): ColumnProfileDocument[] {
  const width = Math.floor(profile.columns.length / count);
  const remainder = profile.columns.length % count;
  return Array.from({ length: count }, (_, index) => {
    const start = index * width + Math.min(index, remainder);
    const columns = profile.columns.slice(start, start + width + Number(index < remainder));
    return { ...profile, columns, layoutFingerprint: layoutFingerprint(columns),
      sampleShortfall: columns.some(column => column.maskedSamples.length < 5) };
  });
}

/** Keep a fitting request byte-for-byte; otherwise find the fewest balanced groups, at most four. */
export function mappingTeacherColumnGroups(profile: ColumnProfileDocument) {
  profile = ColumnProfileDocumentSchema.parse(profile);
  const single = { profile, request: mappingTeacherRequest(profile) };
  if (!single.request.overBound) return { groups: [single], overBound: false };
  for (let count = 2; count <= Math.min(4, profile.columns.length); count++) {
    const groups = columnGroupProfiles(profile, count)
      .map(group => ({ profile: group, request: mappingTeacherRequest(group) }));
    if (groups.every(group => !group.request.overBound)) return { groups, overBound: false };
  }
  return { groups: [] as typeof single[], overBound: true };
}

function requestWithSamples(inspected: ColumnProfileDocument, errors: string[]) {
  const aliases = inspected.columns.map((column, index) => ({ alias: alias(index), name: column.name }));
  const targetVocabulary = Object.entries(CANONICAL_TARGETS).map(([target, definition]) => ({
    target,
    meaning: definition.meaning,
    allowedOperations: definition.allowedOperations,
  }));
  const input = {
    columnProfile: {
      version: inspected.version,
      sourceKind: inspected.sourceKind,
      sampleShortfall: inspected.sampleShortfall,
      columns: promptColumns(inspected),
    },
    targetVocabulary,
    ...(errors.length
      ? {
          validationErrorCodes: [...new Set(errors)].slice(0, 40),
          instruction: 'One bounded repair; unsupported fields must be unknown.',
        }
      : {}),
  };
  const messages = [
    {
      role: 'system' as const,
      content: `Template ${MAPPING_TEACHER_TEMPLATE}. ${MAPPING_TEACHER_SYSTEM_PROMPT}`,
    },
    { role: 'user' as const, content: JSON.stringify(input) },
  ];
  const schema = outputSchema(aliases.map((item) => item.alias));
  return { messages, schema, aliases, sampleForms: promptSampleForms(inspected) };
}

export function mappingContextFromColumnProfile(
  profile: ColumnProfileDocument, layoutSelection?: { sheet: string; headerRows: readonly number[] },
) {
  return {
    sourceKind: profile.sourceKind,
    ...(layoutSelection ? { layoutSelection } : {}),
    fields: profile.columns.map(({ name, inferredType, declaredUnit }) => ({
      name,
      inferredType,
      ...(declaredUnit ? { declaredUnit } : {}),
    })),
  };
}

function planField(field: TeacherOutputField, names: ReadonlyMap<string, string>) {
  const confidence = { none: 0, low: 0.25, medium: 0.5, high: 0.9 };
  let operation = field.operation;
  if (operation.kind === 'link_parent_key') {
    operation = { ...operation, parentField: names.get(operation.parentField) ?? operation.parentField };
  }
  return {
    ...field,
    sourceField: names.get(field.sourceField) ?? field.sourceField,
    operation,
    confidence: confidence[field.confidence],
  };
}

export function validateTeacherOutput(raw: unknown, profile: ColumnProfileDocument): MappingValidationResult {
  const parsed = TeacherOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      plan: null,
      errors: [
        {
          code: 'MAPPING_TEACHER_SCHEMA_INVALID',
          message: 'The teacher response must contain closed tokens and no literals.',
        },
      ],
    };
  }
  const names = new Map(profile.columns.map((column, index) => [alias(index), column.name]));
  const plan = {
    version: 'mapping-plan/2',
    layoutFingerprint: profile.layoutFingerprint,
    sourceKind: profile.sourceKind,
    method: MAPPING_TEACHER_METHOD,
    fields: parsed.data.fields.map((field) => planField(field, names)),
  };
  return validateMappingPlanV2(plan, mappingContextFromColumnProfile(profile));
}

/** Preserve a refusal thrown by the asked gateway; an omitted retryable flag means false, as at the gateway. */
export function gatewayRefusal(error: unknown): GatewayRefusal | undefined {
  if (!(error instanceof AppError) || !error.code.startsWith('MODEL_')) return undefined;
  const details = error.details as { retryable?: boolean } | undefined;
  return { code: error.code, retryable: details?.retryable === true };
}

export function teacherFailureCode(error: unknown): string {
  const code = error instanceof AppError ? error.code : '';
  const budgetCodes = [
    'MODEL_PROJECT_CAP',
    'MODEL_DAILY_CAP',
    'MODEL_PRINCIPAL_CAP',
    'MODEL_CONSUMER_CAP',
    'MODEL_QUOTA_EXHAUSTED',
    'MODEL_KEYS_EXHAUSTED',
  ];
  if (budgetCodes.includes(code)) return 'TEACHER_BUDGET_EXHAUSTED';
  if (code === 'MODEL_RATE_LIMITED' || code === 'MODEL_COOLDOWN') return 'TEACHER_RATE_LIMITED';
  if (code === 'MODEL_CREDENTIAL_INVALID' || code === 'MODEL_SECRET_UNAVAILABLE')
    return 'TEACHER_AUTH_FAILED';
  if (code === 'MODEL_REPLAY_UNAVAILABLE') return 'TEACHER_REPLAY_UNAVAILABLE';
  if (code === 'MODEL_RECORDING_UNAVAILABLE') return 'TEACHER_RECORDING_UNAVAILABLE';
  if (code === 'MODEL_INPUT_LIMIT') return TEACHER_INPUT_LIMIT;
  return 'TEACHER_UNAVAILABLE';
}

export function manualTeacherPlan(profile: ColumnProfileDocument, code: string): MappingTeacherResult {
  return {
    plan: {
      version: 'mapping-plan/2',
      layoutFingerprint: profile.layoutFingerprint,
      ...(profile.layoutFingerprint !== layoutFingerprint(profile.columns)
        ? { layoutFingerprintVersion: 'tabular-header/2' as const } : {}),
      sourceKind: profile.sourceKind,
      method: manualMappingMethod(code),
      fields: profile.columns.map((column) => ({
        sourceField: column.name,
        target: 'unknown',
        operation: { kind: 'copy' },
        confidence: 0,
        rationale: 'Manual mapping required; no teacher interpretation accepted.',
      })),
    },
    issues: profile.columns.map((column) => ({ sourceField: column.name, state: 'needs_input', code })),
    state: 'needs_input',
    profileHash: columnProfileHash(profile),
    attempts: 0,
    replayed: false,
    validationCodes: [],
  };
}

function unknownFields(profile: ColumnProfileDocument): TeacherOutputField[] {
  return profile.columns.map((_, index) => ({
    sourceField: alias(index),
    target: 'unknown',
    operation: { kind: 'copy' },
    confidence: 'none',
    rationale: 'Manual mapping required.',
  }));
}

function suppliedFields(raw: unknown): unknown[] {
  if (!isRecord(raw) || Object.keys(raw).length !== 1 || !Array.isArray(raw.fields)) return [];
  return raw.fields;
}

function validIsolatedField(
  supplied: unknown[],
  index: number,
  unknowns: TeacherOutputField[],
  profile: ColumnProfileDocument,
): TeacherOutputField | undefined {
  const matches = supplied.filter((field) => isRecord(field) && field.sourceField === alias(index));
  if (matches.length !== 1) return undefined;
  const parsed = TeacherOutputSchema.shape.fields.element.safeParse(matches[0]);
  if (!parsed.success) return undefined;
  const fields = unknowns.map((unknown, position) => (position === index ? parsed.data : unknown));
  if (!validateTeacherOutput({ fields }, profile).success) return undefined;
  return parsed.data;
}

function retainValidFields(lastRaw: unknown, profile: ColumnProfileDocument) {
  const unknowns = unknownFields(profile);
  const retained = [...unknowns];
  const supplied = suppliedFields(lastRaw);
  const seenTargets = new Set<string>();
  const duplicateFields = new Set<string>();
  for (let index = 0; index < unknowns.length; index++) {
    const field = validIsolatedField(supplied, index, unknowns, profile);
    if (!field) continue;
    if (field.target !== 'unknown' && seenTargets.has(field.target)) {
      duplicateFields.add(profile.columns[index].name);
      continue;
    }
    retained[index] = field;
    if (field.target !== 'unknown') seenTargets.add(field.target);
  }
  const checked = validateTeacherOutput({ fields: retained }, profile);
  const plan = checked.success ? checked.plan : manualTeacherPlan(profile, 'TEACHER_INVALID_PLAN').plan;
  const issues: TeacherIssue[] = plan.fields
    .filter((field) => field.target === 'unknown' || field.confidence < 0.5)
    .map((field) => ({
      sourceField: field.sourceField,
      state: 'needs_input',
      code: duplicateFields.has(field.sourceField) ? 'TEACHER_DUPLICATE_TARGET' : 'TEACHER_INVALID_PLAN',
    }));
  return { plan, issues };
}

function failedResult(fallback: MappingTeacherResult, code: string, metadata: Partial<AttemptMetadata> = {}) {
  return {
    ...fallback,
    ...metadata,
    plan: { ...fallback.plan, method: manualMappingMethod(code) },
    issues: fallback.issues.map((issue) => ({ ...issue, code })),
  };
}

async function resolveGateway(options: TeacherOptions) {
  try {
    return { gateway: options.gateway ?? (await (options.runtime ?? mappingTeacherGatewayRuntime)()) };
  } catch (error) {
    return { code: teacherFailureCode(error) };
  }
}

function prepareRecordings(gateway: ModelGateway, options: TeacherOptions) {
  try {
    let recordings = options.recordings;
    if (!recordings && gateway.adapterKind === 'sarvam') recordings = new TeacherRecordings();
    if (recordings && gateway.adapterKind === 'sarvam') recordings.prepare();
    return { recordings };
  } catch {
    return { code: 'TEACHER_RECORDING_UNAVAILABLE' };
  }
}

async function recordTeacherResponse(
  event: Parameters<NonNullable<TrustedCall['observeResponse']>>[0],
  attempt: number,
  call: TeacherCallContext,
) {
  const { profile, gateway, recordings } = call;
  const raw = event.result?.semanticError ? {} : event.result?.output;
  const validation = validateTeacherOutput(raw, profile);
  const profileHash = columnProfileHash(profile);
  await recordings?.record({
    adapterKind: gateway.adapterKind, templateVersion: MAPPING_TEACHER_TEMPLATE,
    model: MAPPING_TEACHER_MODEL, profileHash, replayKey: teacherReplayKey(profileHash), attempt, ...event,
    parsedPlan: validation.plan, validation, price: gateway.config.price,
  });
}

async function callTeacherOnce(
  attempt: number, request: ReturnType<typeof mappingTeacherRequest>, call: TeacherCallContext,
) {
  const { profile, gateway, options, deadlineAt, invocationKey } = call;
  const profileHash = columnProfileHash(profile);
  const replayKey = teacherReplayKey(profileHash);
  return gateway.propose(
    options.context,
    {
      taskKind: 'mapping_v2',
      evidenceRefs: [],
      input: { messages: request.messages },
      outputSchemaId: MAPPING_TEACHER_TEMPLATE,
      policyVersion: gateway.config.policyVersion,
      budget: { maxInputBytes: 32768, deadlineMs: Math.max(1, deadlineAt.getTime() - Date.now()) },
    },
    {
      invocationKey,
      attempt,
      consumer: 'INGEST',
      scopeHash: profileHash,
      sourceHashes: [profileHash],
      deadlineAt,
      taskKind: 'mapping_v2',
      outputSchemaId: MAPPING_TEACHER_TEMPLATE,
      outputSchema: request.schema,
      replayKey,
      authorize: options.authorize,
      minimizeOutput: (output) => output,
      observeResponse: event => recordTeacherResponse(event, attempt, call),
    },
  );
}

function acceptedResult(plan: MappingPlanV2, metadata: AttemptMetadata): MappingTeacherResult {
  const issues: TeacherIssue[] = plan.fields
    .filter((field) => field.target === 'unknown' || field.confidence < 0.5)
    .map((field) => ({ sourceField: field.sourceField, state: 'needs_input', code: 'TEACHER_UNCERTAIN' }));
  return { plan, issues, state: issues.length ? 'needs_input' : 'candidate', ...metadata };
}

/** Provider/configuration/budget failures return issue dispositions; nothing writes the registry. */
export async function proposeMappingWithTeacher(
  profile: ColumnProfileDocument,
  options: TeacherOptions,
): Promise<MappingTeacherResult> {
  profile = ColumnProfileDocumentSchema.parse(profile);
  profile = { ...profile, layoutFingerprint: layoutFingerprint(profile.columns) };
  const fallback = manualTeacherPlan(profile, 'TEACHER_UNAVAILABLE');
  if (options.dataPolicy.dataClass !== 'public' || options.dataPolicy.split === 'held_out') {
    return failedResult(fallback, 'TEACHER_DATA_DENIED');
  }
  const grouped = mappingTeacherColumnGroups(profile);
  if (grouped.overBound) return failedResult(fallback, TEACHER_INPUT_LIMIT);
  const resolved = await resolveGateway(options);
  if (!resolved.gateway) return failedResult(fallback, resolved.code ?? 'TEACHER_UNAVAILABLE');
  const prepared = prepareRecordings(resolved.gateway, options);
  if (prepared.code) return failedResult(fallback, prepared.code);
  if (grouped.groups.length === 1) {
    return askMappingProfile(profile, options, resolved.gateway, prepared.recordings);
  }
  return askColumnGroups(profile, grouped.groups, options, resolved.gateway, prepared.recordings);
}

async function askMappingProfile(
  profile: ColumnProfileDocument, options: TeacherOptions, gateway: ModelGateway, recordings?: TeacherRecordings,
): Promise<MappingTeacherResult> {
  const fallback = manualTeacherPlan(profile, 'TEACHER_UNAVAILABLE');
  const call = { profile, options, gateway, recordings,
    deadlineAt: new Date(Date.now() + gateway.config.timeoutMs), invocationKey: options.invocationKey ?? randomUUID() };
  const metadata: AttemptMetadata = {
    profileHash: fallback.profileHash, attempts: 0, replayed: false, validationCodes: [],
    columnGroups: 1, samplesPerColumn: [mappingTeacherRequest(profile).samplesPerColumn],
  };
  let lastRaw: unknown;
  // Only a complete invalid response uses the single repair; transport/credit failures never retry.
  const maxAttempts = options.maxAttempts === 1 ? 1 : 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const request = mappingTeacherRequest(profile, metadata.validationCodes);
    // Too long even with no samples: the gateway is not asked. A repair that is too long ends as an exhausted one.
    if (request.overBound && attempt === 1) return failedResult(fallback, TEACHER_INPUT_LIMIT, metadata);
    if (request.overBound) break;
    try {
      metadata.samplesPerColumn = [request.samplesPerColumn];
      const result = await callTeacherOnce(attempt, request, call);
      metadata.attempts++;
      metadata.replayed = !!result.replayed;
      lastRaw = result.receipt?.semanticError ? {} : result.output;
      const checked = validateTeacherOutput(lastRaw, profile);
      if (checked.success) return acceptedResult(checked.plan, metadata);
      metadata.validationCodes = checked.errors.map((error) => error.code);
    } catch (error) {
      const refusal = gatewayRefusal(error);
      return failedResult(fallback, teacherFailureCode(error), {
        ...metadata, attempts: attempt, ...(refusal ? { gatewayRefusal: refusal } : {}),
      });
    }
  }
  return { ...fallback, ...retainValidFields(lastRaw, profile), ...metadata };
}

type ColumnGroup = ReturnType<typeof mappingTeacherColumnGroups>['groups'][number];

async function askColumnGroups(
  profile: ColumnProfileDocument, groups: ColumnGroup[], options: TeacherOptions,
  gateway: ModelGateway, recordings?: TeacherRecordings,
): Promise<MappingTeacherResult> {
  const results: MappingTeacherResult[] = [];
  const invocation = options.invocationKey ?? randomUUID();
  for (const group of groups) {
    // A group is a new call, not repair attempt two: keep the gateway's pace before its admission.
    if (results.length && gateway.adapterKind !== 'replay') {
      await new Promise(resolve => setTimeout(resolve, gateway.config.paceMs));
    }
    const invocationKey = hash({ invocation, profileHash: columnProfileHash(group.profile) });
    const result = await askMappingProfile(group.profile, { ...options, invocationKey }, gateway, recordings);
    results.push(result);
    if (isManualMappingMethod(result.plan.method)) {
      const code = result.issues[0]?.code ?? 'TEACHER_UNAVAILABLE';
      return failedResult(manualTeacherPlan(profile, code), code, {
        ...groupMetadata(profile, groups.map((item, index) =>
          results[index]?.samplesPerColumn?.[0] ?? item.request.samplesPerColumn), results),
        ...(result.gatewayRefusal ? { gatewayRefusal: result.gatewayRefusal } : {}),
      });
    }
  }
  return mergeColumnGroupResults(profile, results);
}

function groupMetadata(profile: ColumnProfileDocument, samples: number[], results: MappingTeacherResult[]) {
  return { profileHash: columnProfileHash(profile), columnGroups: samples.length, samplesPerColumn: samples,
    attempts: results.reduce((sum, result) => sum + result.attempts, 0),
    replayed: results.length === samples.length && results.every(result => result.replayed),
    validationCodes: [...new Set(results.flatMap(result => result.validationCodes))] };
}

/** The whole inventory decides validity; every repeated non-unknown target is withheld from both claimants. */
function mergeColumnGroupResults(
  profile: ColumnProfileDocument, results: MappingTeacherResult[],
): MappingTeacherResult {
  const samples = results.map(result => result.samplesPerColumn?.[0] ?? 0);
  const metadata = groupMetadata(profile, samples, results);
  const fields = results.flatMap(result => result.plan.fields);
  const order = new Map(profile.columns.map((column, index) => [column.name, index]));
  const plan = { ...manualTeacherPlan(profile, 'TEACHER_INVALID_PLAN').plan, method: MAPPING_TEACHER_METHOD,
    fields: [...fields].sort((left, right) =>
      (order.get(left.sourceField) ?? -1) - (order.get(right.sourceField) ?? -1)) };
  const checked = validateMappingPlanV2(plan, mappingContextFromColumnProfile(profile));
  const duplicates = duplicateTargets(fields);
  const repaired = { ...plan, fields: plan.fields.map(field => duplicates.has(canonicalTarget(field.target))
    ? { ...field, target: 'unknown' as const, operation: { kind: 'copy' as const }, confidence: 0 } : field) };
  const validated = validateMappingPlanV2(repaired, mappingContextFromColumnProfile(profile));
  if (!validated.success) return failedResult(manualTeacherPlan(profile, 'TEACHER_INVALID_PLAN'),
    'TEACHER_INVALID_PLAN', { ...metadata, validationCodes: validated.errors.map(error => error.code) });
  const result = acceptedResult(validated.plan, { ...metadata,
    validationCodes: [...new Set([...metadata.validationCodes, ...checked.errors.map(error => error.code)])] });
  const duplicateNames = new Set(fields.filter(field => duplicates.has(canonicalTarget(field.target)))
    .map(field => field.sourceField));
  const groupIssues = new Map(results.flatMap(group => group.issues).map(issue => [issue.sourceField, issue]));
  result.issues = result.issues.map(issue => duplicateNames.has(issue.sourceField)
    ? { ...issue, code: 'MAPPING_TARGET_DUPLICATE' } : groupIssues.get(issue.sourceField) ?? issue);
  return result;
}

function duplicateTargets(fields: MappingPlanV2['fields']): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const field of fields) {
    const target = canonicalTarget(field.target);
    if (target !== 'unknown' && seen.has(target)) duplicates.add(target);
    seen.add(target);
  }
  return duplicates;
}

type StudentColumnMetadata = {
  profileId: string;
  header: string;
  neighbourHeaders: string[];
  cellCount: number;
  emptyCount: number;
};
type RoutingOptions = TeacherOptions & {
  memoryPath?: string;
  learnerModelPath?: string;
  learnerColumns?: StudentColumnMetadata[];
  teacher?: (profile: ColumnProfileDocument, options: TeacherOptions) => Promise<MappingTeacherResult>;
};
type FieldSourceKind = 'memory' | 'student' | 'teacher' | 'officer' | 'unanswered';
export type MappingRoutingResult = MappingTeacherResult & {
  activeLearnerVersion: string | null;
  memoryMatched?: boolean;
  fieldSources: { sourceField: string; source: FieldSourceKind; method: string }[];
  memoryReasonCode: string | null;
  studentReasonCode: string | null;
};
const StudentPredictionSchema = z.strictObject({
  profileId: z.string(), target: z.enum(Object.keys(CANONICAL_TARGETS) as [
    keyof typeof CANONICAL_TARGETS, ...(keyof typeof CANONICAL_TARGETS)[],
  ]), probability: z.number().min(0).max(1), committed: z.boolean(), version: z.string().regex(/^v[1-9]\d*$/),
});
type StudentPrediction = z.infer<typeof StudentPredictionSchema>;

export function learnerVersion(path?: string): string | null {
  if (!path) return null;
  try {
    const manifest = JSON.parse(readFileSync(resolve(path, 'manifest.json'), 'utf8'));
    return /^v[1-9]\d*$/.test(manifest.version) ? manifest.version : null;
  } catch {
    return null;
  }
}

function studentInputs(profile: ColumnProfileDocument, options: RoutingOptions) {
  if (options.learnerColumns && options.learnerColumns.length !== profile.columns.length) {
    throw new Error('STUDENT_COLUMN_METADATA_MISMATCH');
  }
  return profile.columns.map((column, index) => {
    const metadata = options.learnerColumns?.[index];
    return {
      profileId: metadata?.profileId ?? column.name, header: metadata?.header ?? column.name,
      neighbourHeaders: metadata?.neighbourHeaders ?? profile.columns.slice(Math.max(0, index - 2), index)
        .concat(profile.columns.slice(index + 1, index + 3)).map(column => column.name),
      inferredType: column.inferredType, declaredUnit: column.declaredUnit ?? null, valueShapes: column.valueShapes,
      cellCount: metadata?.cellCount ?? 0, emptyCount: metadata?.emptyCount ?? 0,
    };
  });
}

function callStudent(profile: ColumnProfileDocument, options: RoutingOptions, version: string | null) {
  if (!options.learnerModelPath || !version) return { fields: [] as StudentPrediction[], code: 'STUDENT_UNAVAILABLE' };
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
    const inputs = studentInputs(profile, options);
    const run = spawnSync(process.env.ULPIN_PROFILE_PYTHON ?? 'python', [
      '-m', 'geo.usp_learning.stage_a', 'predict', '--model', resolve(options.learnerModelPath), '--profiles', '-',
    ], { encoding: 'utf8', input: JSON.stringify(inputs), timeout: 30000, maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONPATH: resolve(root, 'services/geo'), PYTHONDONTWRITEBYTECODE: '1' } });
    if (run.status !== 0) throw new Error('STUDENT_UNAVAILABLE');
    const fields = run.stdout.trim().split('\n').map(line => StudentPredictionSchema.parse(JSON.parse(line)));
    if (fields.length !== inputs.length || fields.some((field, index) =>
      field.profileId !== inputs[index].profileId || field.version !== version)) {
      throw new Error('STUDENT_OUTPUT_INVALID');
    }
    return { fields, code: null };
  } catch {
    return { fields: [] as StudentPrediction[], code: 'STUDENT_UNAVAILABLE' };
  }
}

function studentPlanFields(profile: ColumnProfileDocument, predictions: StudentPrediction[]) {
  return predictions.flatMap((prediction, index) => prediction.committed ? [{
    sourceField: profile.columns[index].name, target: prediction.target, operation: { kind: 'copy' as const },
    confidence: prediction.probability, rationale: 'Local calibrated Stage A classifier proposes this interpretation.',
  }] : []);
}

async function remainingTeacher(
  profile: ColumnProfileDocument, confident: MappingPlanV2['fields'], options: RoutingOptions,
) {
  const names = new Set(confident.map(field => field.sourceField));
  const columns = profile.columns.filter(column => !names.has(column.name));
  if (!columns.length) return undefined;
  const remaining = { ...profile, columns, layoutFingerprint: layoutFingerprint(columns),
    sampleShortfall: columns.some(column => column.maskedSamples.length < 5) };
  if (options.dataPolicy.split === 'held_out' || options.dataPolicy.dataClass !== 'public') {
    return manualTeacherPlan(remaining, 'TEACHER_DATA_DENIED');
  }
  return (options.teacher ?? proposeMappingWithTeacher)(remaining, options);
}

function routedMethod(student: string, confident: number, teacher: MappingTeacherResult | undefined): string {
  const answered = teacher && !isManualMappingMethod(teacher.plan.method);
  if (confident && answered) return 'model:mapping-router@1';
  if (confident || !teacher) return student;
  return teacher.plan.method;
}

function routedSources(
  profile: ColumnProfileDocument, student: ReadonlyMap<string, unknown>, studentMethod: string,
  teacher: MappingTeacherResult | undefined, fallbackMethod: string,
): MappingRoutingResult['fieldSources'] {
  const answered = teacher && !isManualMappingMethod(teacher.plan.method);
  return profile.columns.map(column => {
    if (student.has(column.name)) return { sourceField: column.name, source: 'student', method: studentMethod };
    if (!answered) {
      return { sourceField: column.name, source: 'unanswered', method: teacher?.plan.method ?? fallbackMethod };
    }
    return { sourceField: column.name, source: 'teacher', method: teacher.plan.method };
  });
}

function routedResult(
  profile: ColumnProfileDocument, version: string | null, confident: MappingPlanV2['fields'],
  teacher: MappingTeacherResult | undefined, memoryReasonCode: string | null, studentReasonCode: string | null,
): MappingRoutingResult {
  const student = new Map(confident.map(field => [field.sourceField, field]));
  const supplied = new Map(teacher?.plan.fields.map(field => [field.sourceField, field]) ?? []);
  const fallback = manualTeacherPlan(profile, 'MAPPING_ROUTING_INVALID');
  const fields = profile.columns.map(column => student.get(column.name) ?? supplied.get(column.name));
  const method = `model:stage-a@${version ?? 'unavailable'}`;
  const routed = { ...fallback.plan, fields, method: routedMethod(method, confident.length, teacher) };
  const checked = validateMappingPlanV2(routed, mappingContextFromColumnProfile(profile));
  const accepted = checked.success ? acceptedResult(checked.plan, {
    profileHash: columnProfileHash(profile), attempts: teacher?.attempts ?? 0,
    replayed: teacher?.replayed ?? false, validationCodes: teacher?.validationCodes ?? [],
  }) : fallback;
  const issues = checked.success ? [...accepted.issues, ...(teacher?.issues ?? [])] : fallback.issues;
  const fieldSources = checked.success ? routedSources(profile, student, method, teacher, fallback.plan.method)
    : routedSources(profile, new Map(), method, fallback, fallback.plan.method);
  return { ...accepted, issues, state: issues.length ? 'needs_input' : 'candidate', activeLearnerVersion: version,
    ...(teacher?.gatewayRefusal ? { gatewayRefusal: teacher.gatewayRefusal } : {}),
    ...(teacher?.columnGroups
      ? { columnGroups: teacher.columnGroups, samplesPerColumn: teacher.samplesPerColumn } : {}),
    memoryReasonCode, studentReasonCode, fieldSources };
}

/** Proposal-only exact memory → calibrated local student → governed teacher; held-outs never reach a teacher. */
export async function proposeMapping(
  profile: ColumnProfileDocument, options: RoutingOptions,
): Promise<MappingRoutingResult> {
  profile = ColumnProfileDocumentSchema.parse(profile);
  const version = learnerVersion(options.learnerModelPath);
  try {
    await options.authorize();
  } catch {
    return { ...manualTeacherPlan(profile, 'MAPPING_AUTHORIZATION_DENIED'), activeLearnerVersion: version,
      fieldSources: [], memoryReasonCode: null, studentReasonCode: null };
  }
  const memory = lookupMappingMemory(profile.layoutFingerprint, mappingContextFromColumnProfile(profile),
    options.memoryPath);
  if (memory.plan) {
    const accepted = acceptedResult(memory.plan, { profileHash: columnProfileHash(profile), attempts: 0,
      replayed: false, validationCodes: [] });
    if (memory.lineage?.source === 'officer') { accepted.issues = []; accepted.state = 'candidate'; }
    return { ...accepted, activeLearnerVersion: version, memoryMatched: true,
      memoryReasonCode: null, studentReasonCode: null, fieldSources: profile.columns.map(column => ({
        sourceField: column.name, source: memory.lineage?.source === 'officer' ? 'officer' : 'memory',
        method: memory.plan!.method,
      })) };
  }
  const student = callStudent(profile, options, version);
  const confident = studentPlanFields(profile, student.fields);
  let teacher: MappingTeacherResult | undefined;
  try {
    teacher = await remainingTeacher(profile, confident, options);
  } catch {
    teacher = manualTeacherPlan(profile, 'TEACHER_UNAVAILABLE');
  }
  return routedResult(profile, version, confident, teacher, memory.reasonCode, student.code);
}

/** Dry-run only; keep teacher issues on cells without collapsing null, absent or conflict states. */
export function executeTeacherMappingDryRun(
  result: MappingTeacherResult,
  rows: readonly MappingRow[],
  executionContext: MappingExecutionContext,
) {
  const dry = executeMappingPlanV2(result.plan, rows, executionContext);
  const issues = new Map(result.issues.map((issue) => [issue.sourceField, issue.code]));
  for (const row of dry.rows) {
    for (const cell of row.fields) {
      const code = issues.get(cell.sourceField);
      if (!code) continue;
      if (!['null', 'absent', 'withheld', 'conflicting'].includes(cell.state)) {
        cell.state = 'needs_input';
        cell.value = null;
      }
      cell.issueCode = code;
    }
  }
  dry.counts = mappedCellCounts(dry.rows);
  return dry;
}
