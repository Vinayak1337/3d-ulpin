import type { TabularMappingPlan, TabularSourceProfile } from '@ulpin/contracts/usp';
import { AppError, conflict } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { mappingContextFromColumnProfile } from './mapping-teacher';
import { validateMappingPlanV2 } from './mapping-plan-v2';
import { executeMappingPlanV2 } from './mapping-executor';
import { readTabularSource } from './tabular-source';

function assertRecipePins(plan: TabularMappingPlan, profile: TabularSourceProfile) {
  const sameSource = fingerprint(plan.source) === fingerprint(profile.source);
  const sameSelection = fingerprint(plan.tabular) === fingerprint(profile.tabular);
  if (!sameSource || !sameSelection || plan.workspaceRevision !== profile.workspaceRevision ||
      plan.workspaceFingerprint !== profile.workspaceFingerprint ||
      plan.caseId !== profile.caseId || plan.mapping.sourceKind !== 'tabular') {
    conflict('The tabular source, selection or workspace changed; author a current recipe.');
  }
  if (plan.mapping.fields.some((field, index) => field.sourceField !== profile.profile.columns[index]?.name)) {
    throw new AppError(422, 'MAPPING_TABULAR_ORDER', 'Keep officer decisions in the pinned source-column order.');
  }
  const reasons = new Map(plan.decisions.map(decision => [decision.sourceField, decision.reason]));
  if (reasons.size !== plan.decisions.length || reasons.size !== plan.mapping.fields.length ||
      plan.mapping.fields.some(field => !reasons.has(field.sourceField))) {
    throw new AppError(422, 'MAPPING_OFFICER_REASON', 'Each field requires one explicit officer decision and reason.');
  }
}

/** Existing manual author/approve commands use this verifier; it grants no approval or registry authority. */
export function validateTabularRecipe(plan: TabularMappingPlan, profile: TabularSourceProfile, bytes: Uint8Array) {
  assertRecipePins(plan, profile);
  const context = mappingContextFromColumnProfile(profile.profile, profile.tabular.selection);
  const checked = validateMappingPlanV2(plan.mapping, context);
  if (!checked.success) {
    throw new AppError(422, 'MAPPING_PLAN_INVALID', 'The officer plan failed canonical verification.');
  }
  const table = readTabularSource(bytes, profile.tabular.selection);
  const rows = table.rows.map(row => Object.fromEntries(table.headers.map((header, index) =>
    [`${index + 1}|${header}`, row[index]])));
  const dry = executeMappingPlanV2(checked.plan, rows, { ...context, sourceRef: `source:${profile.source.sourceId}` });
  for (const field of checked.plan.fields) {
    const cells = dry.rows.flatMap(row => row.fields.filter(cell => cell.sourceField === field.sourceField));
    if (cells.filter(cell => ['needs_input', 'conflicting'].includes(cell.state)).length / cells.length > 0.1) {
      throw new AppError(422, 'MAPPING_DRY_RUN', 'A selected field exceeds the existing ten-percent issue bound.');
    }
  }
  return { table, dry };
}

/** Stable method token; the full configured subject stays in the server approval receipt. */
export function officerMappingMethod(subject: string) {
  return `reviewer:${fingerprint(subject)}`;
}

export function officerTabularPlan(plan: TabularMappingPlan, subject: string): TabularMappingPlan {
  const reasons = new Map(plan.decisions.map(decision => [decision.sourceField, decision.reason]));
  return { ...plan, mapping: { ...plan.mapping, method: officerMappingMethod(subject),
    fields: plan.mapping.fields.map(field =>
    ({ ...field, confidence: 1, rationale: reasons.get(field.sourceField) ?? field.rationale })) } };
}
