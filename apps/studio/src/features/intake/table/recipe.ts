import { CANONICAL_TARGETS } from '@ulpin/contracts';
import type { ChunkMapping, RecipeBody, TableProfile, Target } from './types';

export interface OfficerAnswer {
  target: Target | '';
  reason: string;
  sharedReason?: boolean;
}
export type OfficerAnswers = Record<string, OfficerAnswer>;

export function initialAnswers(profile: TableProfile, mapping: ChunkMapping): OfficerAnswers {
  return Object.fromEntries(profile.profile.columns.map((column) => {
    const question = mapping.questions.some((item) => item.sourceField === column.name);
    const field = mapping.plan.fields.find((item) => item.sourceField === column.name);
    return [column.name, { target: question ? '' : field?.target ?? '', reason: '' }];
  }));
}

export function unansweredColumns(profile: TableProfile, answers: OfficerAnswers) {
  return profile.profile.columns.flatMap((column, index) => {
    const answer = answers[column.name];
    if (answer?.target && answer.reason.trim()) return [];
    return [`${index + 1}: ${profile.headers[index] || 'Empty header'}`];
  });
}

export function unansweredUnknownColumns(profile: TableProfile, answers: OfficerAnswers) {
  return profile.profile.columns.filter((column) => {
    const answer = answers[column.name];
    if (answer?.target && answer.target !== 'unknown') return false;
    return !answer?.target || !answer.reason.trim();
  }).map((column) => column.name);
}

export function fillUnknownAnswers(profile: TableProfile, answers: OfficerAnswers, reason: string) {
  const sharedReason = reason.trim();
  if (!sharedReason) throw new Error('Give a reason for marking unanswered fields as unknown.');
  const next = { ...answers };
  for (const name of unansweredUnknownColumns(profile, answers)) {
    next[name] = { target: 'unknown', reason: sharedReason, sharedReason: true };
  }
  return next;
}

export function targetOptions(candidates: Target[]) {
  const first = [...new Set(candidates)];
  const all = (Object.keys(CANONICAL_TARGETS) as Target[]).filter((target) => !first.includes(target));
  return { first, all };
}

export function recipeBody(profile: TableProfile, mapping: ChunkMapping, answers: OfficerAnswers,
  requestKey: string, expectedRecipeRevision: number): RecipeBody {
  const unanswered = unansweredColumns(profile, answers);
  if (unanswered.length) throw new Error(`Answer every column and give a reason: ${unanswered.join('; ')}`);
  const fields = profile.profile.columns.map((column) => {
    const answer = answers[column.name]!;
    const prior = mapping.plan.fields.find((field) => field.sourceField === column.name);
    const operation = prior?.target === answer.target ? prior.operation : { kind: 'copy' as const };
    return { sourceField: column.name, target: answer.target as Target, operation,
      confidence: 1, rationale: answer.reason.trim() };
  });
  return { requestKey, expectedRecipeRevision, destination: null, plan: {
    version: 'manual-tabular/1', mode: 'manual_mapping', caseId: profile.caseId,
    source: profile.source, workspaceRevision: profile.workspaceRevision,
    workspaceFingerprint: profile.workspaceFingerprint, tabular: profile.tabular,
    mapping: { version: 'mapping-plan/2', sourceKind: 'tabular', method: 'reviewer:pending-local-operator',
      layoutFingerprint: profile.profile.layoutFingerprint, fields },
    decisions: fields.map((field) => ({ sourceField: field.sourceField, reason: field.rationale })),
  } };
}
