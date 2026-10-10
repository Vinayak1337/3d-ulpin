import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  CANONICAL_TARGETS,
  ColumnProfileDocumentSchema,
  MappingV2OperationSchema,
  type ColumnProfileDocument,
  type MappingPlanV2,
} from '@ulpin/contracts';
import type { RequestContext } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
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

export const MAPPING_TEACHER_TEMPLATE = 'mapping-teacher/2.1';
export const MAPPING_TEACHER_MODEL = 'sarvam-105b';
export const MAPPING_TEACHER_METHOD = 'model:sarvam-105b@2026-10-10';
export type TeacherDataPolicy = {
  dataClass: 'public' | 'private' | 'restricted';
  split: 'development' | 'unlabelled' | 'held_out';
};
export type TeacherIssue = { sourceField: string; state: 'needs_input'; code: string };
export type MappingTeacherResult = {
  plan: MappingPlanV2;
  issues: TeacherIssue[];
  state: 'candidate' | 'needs_input';
  profileHash: string;
  attempts: number;
  replayed: boolean;
  validationCodes: string[];
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
  'profileHash' | 'attempts' | 'replayed' | 'validationCodes'
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

function promptColumns(profile: ColumnProfileDocument) {
  return profile.columns.map((column, index) => ({
    // The shared minimizer treats the JSON key "name" as personal information.
    header: headerMask(column.name),
    sourceField: alias(index),
    inferredType: column.inferredType,
    ...(column.declaredUnit ? { declaredUnit: column.declaredUnit } : {}),
    valueShapes: column.valueShapes,
    maskedSamples: column.maskedSamples.map((value) => maskColumnSample(value, column.name)),
  }));
}

export function mappingTeacherRequest(profile: ColumnProfileDocument, errors: string[] = []) {
  const inspected = ColumnProfileDocumentSchema.parse(profile);
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
  return { messages, schema: outputSchema(aliases.map((item) => item.alias)), aliases };
}

export function mappingContextFromColumnProfile(profile: ColumnProfileDocument) {
  return {
    sourceKind: profile.sourceKind,
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

export function teacherFailureCode(error: unknown): string {
  const code = error instanceof AppError ? error.code : '';
  const budgetCodes = [
    'MODEL_PROJECT_CAP',
    'MODEL_DAILY_CAP',
    'MODEL_PRINCIPAL_CAP',
    'MODEL_CONSUMER_CAP',
    'MODEL_QUOTA_EXHAUSTED',
  ];
  if (budgetCodes.includes(code)) return 'TEACHER_BUDGET_EXHAUSTED';
  if (code === 'MODEL_RATE_LIMITED' || code === 'MODEL_COOLDOWN') return 'TEACHER_RATE_LIMITED';
  if (code === 'MODEL_CREDENTIAL_INVALID' || code === 'MODEL_SECRET_UNAVAILABLE')
    return 'TEACHER_AUTH_FAILED';
  if (code === 'MODEL_REPLAY_UNAVAILABLE') return 'TEACHER_REPLAY_UNAVAILABLE';
  if (code === 'MODEL_RECORDING_UNAVAILABLE') return 'TEACHER_RECORDING_UNAVAILABLE';
  return 'TEACHER_UNAVAILABLE';
}

export function manualTeacherPlan(profile: ColumnProfileDocument, code: string): MappingTeacherResult {
  return {
    plan: {
      version: 'mapping-plan/2',
      layoutFingerprint: profile.layoutFingerprint,
      sourceKind: profile.sourceKind,
      method: MAPPING_TEACHER_METHOD,
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
  return { ...fallback, ...metadata, issues: fallback.issues.map((issue) => ({ ...issue, code })) };
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

async function callTeacherOnce(attempt: number, errors: string[], call: TeacherCallContext) {
  const { profile, gateway, options, deadlineAt, invocationKey } = call;
  const request = mappingTeacherRequest(profile, errors);
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
  const resolved = await resolveGateway(options);
  if (!resolved.gateway) return failedResult(fallback, resolved.code ?? 'TEACHER_UNAVAILABLE');
  const prepared = prepareRecordings(resolved.gateway, options);
  if (prepared.code) return failedResult(fallback, prepared.code);
  const call = {
    profile, options, gateway: resolved.gateway, recordings: prepared.recordings,
    deadlineAt: new Date(Date.now() + resolved.gateway.config.timeoutMs),
    invocationKey: options.invocationKey ?? randomUUID(),
  };
  const metadata: AttemptMetadata = {
    profileHash: fallback.profileHash, attempts: 0, replayed: false, validationCodes: [],
  };
  let lastRaw: unknown;
  // Only a complete invalid response uses the single repair; transport/credit failures never retry.
  const maxAttempts = options.maxAttempts === 1 ? 1 : 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await callTeacherOnce(attempt, metadata.validationCodes, call);
      metadata.attempts++;
      metadata.replayed = !!result.replayed;
      lastRaw = result.receipt?.semanticError ? {} : result.output;
      const checked = validateTeacherOutput(lastRaw, profile);
      if (checked.success) return acceptedResult(checked.plan, metadata);
      metadata.validationCodes = checked.errors.map((error) => error.code);
    } catch (error) {
      return failedResult(fallback, teacherFailureCode(error), { ...metadata, attempts: attempt });
    }
  }
  return { ...fallback, ...retainValidFields(lastRaw, profile), ...metadata };
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
