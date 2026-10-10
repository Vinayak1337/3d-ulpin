import { createHash } from 'node:crypto';
import {
  CANONICAL_TARGETS,
  canonicalTarget,
  MappingPlanV2Schema,
  MappingLayoutFieldSchema,
  type MappingPlanV2,
  type MappingLayoutField,
  type MappingTarget,
} from '@ulpin/contracts';
import {
  MappingPlanSchema,
  type MappingPlan,
  type SourceProfile,
  type StreamedProfileGeneration,
} from '@ulpin/contracts/usp';
import { UNIT_TABLE } from './unit-table';

export const ENUM_TABLES = {
  'building_use@1': {
    target: 'building.use',
    values: ['residential', 'commercial', 'industrial', 'mixed', 'institutional', 'unknown'],
  },
  'unit_type@1': {
    target: 'unit.type',
    values: ['residential', 'commercial', 'common', 'parking', 'unknown'],
  },
  'level_kind@1': {
    target: 'level.kind',
    values: ['basement', 'ground', 'upper', 'stilt', 'podium', 'mezzanine', 'terrace', 'unknown'],
  },
  'space_kind@1': {
    target: 'space.kind',
    values: ['unit', 'common', 'shaft', 'balcony', 'terrace', 'parking', 'unknown'],
  },
  'document_status@1': {
    target: 'document.status',
    values: ['draft', 'approved', 'sanctioned', 'registered', 'expired', 'revoked', 'unknown'],
  },
} as const;

export type MappingValidationContext = {
  sourceKind: MappingPlanV2['sourceKind'];
  fields: readonly MappingLayoutField[];
  sourceRef?: string;
  rowCount?: number;
  parentFields?: readonly string[];
};
export type MappingValidationError = { code: string; field?: string; message: string };
export type MappingValidationResult =
  | { success: true; plan: MappingPlanV2; errors: [] }
  | { success: false; plan: null; errors: MappingValidationError[] };
type MappingV2Field = MappingPlanV2['fields'][number];
type FieldCheckContext = {
  context: MappingValidationContext;
  fields: ReadonlyMap<string, MappingLayoutField>;
  seenFields: Set<string>;
  seenTargets: Set<string>;
};

export const normalizeMappingHeader = (name: string) =>
  name.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();

/** Ordered columns/types only; no row values, filename, unit assumptions or CRS are hashed. */
export function layoutFingerprint(fields: readonly MappingLayoutField[]): string {
  const layout = fields.map((field) => [normalizeMappingHeader(field.name), field.inferredType]);
  return createHash('sha256').update(JSON.stringify(layout)).digest('hex');
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const knownLiteralKeys = new RegExp(
  [
    '^(?:factor|scale|offset|epsg|crs|coordinates?|identifier|id|value|literal|',
    'default|constant|tool|sql|expression)$',
  ].join(''),
  'i',
);

function hasLiteralKey(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => knownLiteralKeys.test(key));
}

function operationHasLiteral(operation: unknown): boolean {
  if (!record(operation)) return false;
  if (hasLiteralKey(operation)) return true;
  return Object.entries(operation).some(
    ([key, value]) =>
      key !== 'parentField' &&
      (typeof value === 'number' || (typeof value === 'string' && /^(?:EPSG:|\d+(?:\.\d+)?$)/i.test(value))),
  );
}

/** Scan executable parameters only; rationale and citations are inert metadata. */
function hasForbiddenParameter(raw: Record<string, unknown>): boolean {
  if (hasLiteralKey(raw)) return true;
  if (!Array.isArray(raw.fields)) return false;
  return raw.fields.some(
    (field) => record(field) && (hasLiteralKey(field) || operationHasLiteral(field.operation)),
  );
}

function validationError(code: string, message: string, field?: string): MappingValidationError {
  return { code, message, ...(field ? { field } : {}) };
}

function fail(code: string, message: string): MappingValidationResult {
  return { success: false, plan: null, errors: [validationError(code, message)] };
}

function checkOperationAllowed(field: MappingV2Field): MappingValidationError[] {
  const target = canonicalTarget(field.target);
  const definition = CANONICAL_TARGETS[target];
  const errors: MappingValidationError[] = [];
  if (!(definition.allowedOperations as readonly string[]).includes(field.operation.kind)) {
    errors.push(
      validationError(
        'MAPPING_OPERATION_NOT_ALLOWED',
        'Operation is not allowed for this target.',
        field.sourceField,
      ),
    );
  }
  if (!definition.modelMayPropose && field.operation.kind !== 'copy') {
    errors.push(
      validationError(
        'MAPPING_IDENTIFIER_COPY_ONLY',
        'Identifiers and official anchors must be copied from source columns.',
        field.sourceField,
      ),
    );
  }
  if (target === 'unknown' && field.operation.kind !== 'copy') {
    errors.push(
      validationError(
        'MAPPING_UNKNOWN_COPY_ONLY',
        'An unknown field is retained without interpretation.',
        field.sourceField,
      ),
    );
  }
  return errors;
}

function checkParseKind(field: MappingV2Field): MappingValidationError[] {
  if (field.operation.kind !== 'parse_literal') return [];
  const valueKind = CANONICAL_TARGETS[canonicalTarget(field.target)].valueKind;
  let allowed: string[] = [];
  if (valueKind === 'text_literal') allowed = ['text_literal'];
  else if (valueKind === 'number_unit') allowed = ['number'];
  else if (valueKind === 'date') allowed = ['date_dmy', 'date_iso'];
  if (allowed.includes(field.operation.literalKind)) return [];
  return [
    validationError(
      'MAPPING_PARSE_KIND_NOT_ALLOWED',
      'Literal parser must preserve the target value kind.',
      field.sourceField,
    ),
  ];
}

function checkEnumTable(field: MappingV2Field): MappingValidationError[] {
  if (field.operation.kind !== 'enum_lookup') return [];
  if (ENUM_TABLES[field.operation.tableId].target === canonicalTarget(field.target)) return [];
  return [
    validationError(
      'MAPPING_ENUM_TABLE_MISMATCH',
      'Choose the code-owned lookup table for this target.',
      field.sourceField,
    ),
  ];
}

function checkUnitConversion(field: MappingV2Field, ctx: FieldCheckContext): MappingValidationError[] {
  if (field.operation.kind !== 'unit_convert') return [];
  const definition = CANONICAL_TARGETS[canonicalTarget(field.target)];
  const errors: MappingValidationError[] = [];
  if (UNIT_TABLE[field.operation.sourceUnit].family !== definition.unitFamily) {
    errors.push(
      validationError(
        'MAPPING_UNIT_FAMILY_MISMATCH',
        'Source unit has the wrong dimension.',
        field.sourceField,
      ),
    );
  }
  if (ctx.fields.get(field.sourceField)?.declaredUnit !== field.operation.sourceUnit) {
    errors.push(
      validationError(
        'MAPPING_UNIT_NOT_DECLARED',
        'Unit conversion requires matching inspected source-unit evidence.',
        field.sourceField,
      ),
    );
  }
  return errors;
}

function checkParentField(field: MappingV2Field, ctx: FieldCheckContext): MappingValidationError[] {
  if (
    field.operation.kind !== 'link_parent_key' ||
    ctx.context.parentFields?.includes(field.operation.parentField)
  ) {
    return [];
  }
  return [
    validationError(
      'MAPPING_PARENT_FIELD_UNKNOWN',
      'Choose a field in the supplied parent inventory.',
      field.sourceField,
    ),
  ];
}

function checkCitations(field: MappingV2Field, ctx: FieldCheckContext): MappingValidationError[] {
  const invalid = field.citations?.some(
    (citation) =>
      !ctx.fields.has(citation.column) ||
      ctx.context.sourceRef === undefined ||
      citation.sourceRef !== ctx.context.sourceRef ||
      ctx.context.rowCount === undefined ||
      citation.row >= ctx.context.rowCount,
  );
  if (!invalid) return [];
  return [
    validationError(
      'MAPPING_CITATION_INVALID',
      'Citations must reference cells in the inspected source.',
      field.sourceField,
    ),
  ];
}

function checkSourceField(field: MappingV2Field, ctx: FieldCheckContext): MappingValidationError[] {
  const errors: MappingValidationError[] = [];
  if (!ctx.fields.has(field.sourceField)) {
    errors.push(
      validationError(
        'MAPPING_SOURCE_FIELD_UNKNOWN',
        'Choose an exact source inventory column.',
        field.sourceField,
      ),
    );
  }
  if (ctx.seenFields.has(field.sourceField)) {
    errors.push(
      validationError(
        'MAPPING_SOURCE_FIELD_DUPLICATE',
        'A source field may be mapped only once.',
        field.sourceField,
      ),
    );
  }
  ctx.seenFields.add(field.sourceField);
  return errors;
}

function checkTargetDuplicate(field: MappingV2Field, ctx: FieldCheckContext): MappingValidationError[] {
  const target = canonicalTarget(field.target);
  const errors: MappingValidationError[] = [];
  if (target !== 'unknown' && ctx.seenTargets.has(target)) {
    errors.push(
      validationError(
        'MAPPING_TARGET_DUPLICATE',
        'Conflicting fields need separate proposals, not last-value-wins.',
        field.sourceField,
      ),
    );
  }
  ctx.seenTargets.add(target);
  return errors;
}

function checkField(field: MappingV2Field, ctx: FieldCheckContext): MappingValidationError[] {
  return [
    ...checkSourceField(field, ctx),
    ...checkTargetDuplicate(field, ctx),
    ...checkOperationAllowed(field),
    ...checkParseKind(field),
    ...checkEnumTable(field),
    ...checkUnitConversion(field, ctx),
    ...checkParentField(field, ctx),
    ...checkCitations(field, ctx),
  ];
}

function checkLayout(plan: MappingPlanV2, context: MappingValidationContext): MappingValidationError[] {
  const errors: MappingValidationError[] = [];
  if (plan.sourceKind !== context.sourceKind) {
    errors.push(
      validationError(
        'MAPPING_SOURCE_KIND_MISMATCH',
        'Plan source kind differs from the inspected inventory.',
      ),
    );
  }
  if (plan.layoutFingerprint !== layoutFingerprint(context.fields)) {
    errors.push(
      validationError('MAPPING_LAYOUT_MISMATCH', 'The plan must pin the inspected layout fingerprint.'),
    );
  }
  return errors;
}

function checkInventory(context: MappingValidationContext): MappingValidationError[] {
  if (context.fields.some((field) => !MappingLayoutFieldSchema.safeParse(field).success)) {
    return [validationError('MAPPING_LAYOUT_INVALID', 'Supply valid source inventory fields and inferred types.')];
  }
  const names = context.fields.map((field) => normalizeMappingHeader(field.name));
  if (new Set(names).size !== names.length) {
    return [validationError('MAPPING_LAYOUT_AMBIGUOUS', 'Normalised source headers must be unique.')];
  }
  return [];
}

/** Mechanical verifier only; passing never grants registry write authority or approves source meaning. */
export function validateMappingPlanV2(
  raw: unknown,
  context: MappingValidationContext,
): MappingValidationResult {
  if (record(raw) && hasForbiddenParameter(raw)) {
    return fail(
      'MAPPING_LITERAL_FORBIDDEN',
      'Plans may contain inventory references and allowlisted tokens, never literal parameters or tools.',
    );
  }
  const parsed = MappingPlanV2Schema.safeParse(raw);
  if (!parsed.success) {
    const targetIssue = parsed.error.issues.some((issue) => issue.path.includes('target'));
    return fail(
      targetIssue ? 'MAPPING_TARGET_UNKNOWN' : 'MAPPING_SCHEMA_INVALID',
      'The plan does not match the closed MappingPlan v2 contract.',
    );
  }
  const inventoryErrors = checkInventory(context);
  if (inventoryErrors.length) return { success: false, plan: null, errors: inventoryErrors };
  const plan = parsed.data;
  const errors = checkLayout(plan, context);
  const ctx: FieldCheckContext = {
    context,
    fields: new Map(context.fields.map((field) => [field.name, field])),
    seenFields: new Set(),
    seenTargets: new Set(),
  };
  for (const field of plan.fields) errors.push(...checkField(field, ctx));
  if (context.fields.some((field) => !ctx.seenFields.has(field.name))) {
    errors.push(
      validationError(
        'MAPPING_SOURCE_FIELD_UNMAPPED',
        'Every source column needs a mapping or explicit unknown disposition.',
      ),
    );
  }
  if (errors.length) return { success: false, plan: null, errors };
  return { success: true, plan, errors: [] };
}

/** Narrow legacy adapter; original pinned/profile and reviewer safeguards are not weakened. */
export function legacyPlanToV2(
  raw: MappingPlan,
  context: MappingValidationContext,
  method: MappingPlanV2['method'],
): MappingPlanV2 {
  const plan = MappingPlanSchema.parse(raw);
  return {
    version: 'mapping-plan/2',
    sourceKind: context.sourceKind,
    layoutFingerprint: layoutFingerprint(context.fields),
    method,
    fields: context.fields.map((field) => {
      const operation = plan.operations.find((item) => item.sourcePath === field.name);
      return {
        sourceField: field.name,
        target: operation?.target ?? 'unknown',
        operation: { kind: 'copy' },
        confidence: operation ? 1 : 0,
        rationale: operation
          ? 'Adapted exact legacy source operation; existing review requirements remain.'
          : 'Legacy plan does not interpret this source field.',
      };
    }),
  };
}

function gisPathType(path: (SourceProfile | StreamedProfileGeneration)['paths'][number]) {
  if (path.path === '/features/*/geometry') return 'geometry' as const;
  if (path.types.length !== 1) return 'mixed' as const;
  if (path.types[0] === 'string') return 'text' as const;
  return path.types[0];
}

/** Inventory adapter only; reference metadata stays with the existing GIS reader/profile. */
export function mappingContextFromGisProfile(
  profile: SourceProfile | StreamedProfileGeneration,
): MappingValidationContext {
  return {
    sourceKind: 'gis_attributes',
    sourceRef: profile.source.sourceId,
    rowCount: profile.version === 'manual-geojson/1' ? profile.featureCount : profile.recordsSeen,
    fields: profile.paths.map((path) => ({ name: path.path, inferredType: gisPathType(path) })),
  };
}

export const isMappingPlanV2 = (raw: unknown): raw is MappingPlanV2 =>
  record(raw) && raw.version === 'mapping-plan/2';

export function targetExists(target: string): target is MappingTarget {
  return target === 'building.geometry' || Object.hasOwn(CANONICAL_TARGETS, target);
}
