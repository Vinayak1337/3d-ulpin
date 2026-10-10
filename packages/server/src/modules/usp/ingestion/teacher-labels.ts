import { createReadStream, openSync, writeSync, closeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import {
  ColumnProfileDocumentSchema,
  type ColumnProfileDocument,
  type MappingV2Operation,
  type MappingTarget,
  type MappingPlanV2,
} from '@ulpin/contracts';
import { assertTeacherOutputOutsideGit } from '../../model-gateway/recordings';
import { validateMappingPlanV2, layoutFingerprint } from './mapping-plan-v2';
import { executeMappingPlanV2, type MappingRow, type MappingExecutionResult } from './mapping-executor';
import {
  columnProfileHash,
  mappingContextFromColumnProfile,
  type TeacherDataPolicy,
} from './mapping-teacher';

export const DEVELOPMENT_TEACHER_METHOD = 'model:claude-opus-5-5@dev-2026-10';
export const MAX_FIELD_ISSUE_RATE = 0.1;
type FieldDryRun = { cells: number; needsInput: number; conflicting: number };
export type TeacherProfileEntry = {
  profile: ColumnProfileDocument;
  dataPolicy: TeacherDataPolicy;
  rows?: MappingRow[];
  sourceRef?: string;
};
export type PseudoLabelExample = {
  layoutFingerprint: string;
  columnProfile: ColumnProfileDocument['columns'][number];
  target: MappingTarget;
  operation: MappingV2Operation;
  method: string;
  verified: boolean;
  dryRun: FieldDryRun;
  labelKind: 'pseudo_label';
  profileHash: string;
};
type ProfileInventory = ReadonlyMap<string, TeacherProfileEntry>;
type LabelCheck = { examples: PseudoLabelExample[] } | { codes: string[] };
const labelSchema = z.strictObject({
  profileHash: z.string().regex(/^[a-f0-9]{64}$/),
  plan: z.unknown(),
  method: z.literal(DEVELOPMENT_TEACHER_METHOD),
});

function fieldDryRun(sourceField: string, execution?: MappingExecutionResult): FieldDryRun {
  const counts = { cells: 0, needsInput: 0, conflicting: 0 };
  for (const row of execution?.rows ?? []) {
    for (const cell of row.fields) {
      if (cell.sourceField !== sourceField) continue;
      counts.cells++;
      if (cell.state === 'needs_input') counts.needsInput++;
      if (cell.state === 'conflicting') counts.conflicting++;
    }
  }
  return counts;
}

function labelExamples(
  plan: MappingPlanV2,
  profileHash: string,
  entry: TeacherProfileEntry,
): PseudoLabelExample[] {
  const { profile } = entry;
  let execution: MappingExecutionResult | undefined;
  if (entry.rows?.length && entry.sourceRef) {
    execution = executeMappingPlanV2(plan, entry.rows, {
      ...mappingContextFromColumnProfile(profile),
      sourceRef: entry.sourceRef,
      rowCount: entry.rows.length,
    });
  }
  return plan.fields.map((field) => {
    const dryRun = fieldDryRun(field.sourceField, execution);
    const verified =
      dryRun.cells > 0 && (dryRun.needsInput + dryRun.conflicting) / dryRun.cells <= MAX_FIELD_ISSUE_RATE;
    return {
      layoutFingerprint: profile.layoutFingerprint,
      columnProfile: profile.columns.find((column) => column.name === field.sourceField)!,
      target: field.target,
      operation: field.operation,
      method: plan.method,
      verified,
      dryRun,
      labelKind: 'pseudo_label',
      profileHash,
    };
  });
}

function checkLabelLine(line: string, profiles: ProfileInventory): LabelCheck {
  try {
    if (line.length > 1024 * 1024) return { codes: ['TEACHER_LABEL_LIMIT'] };
    const label = labelSchema.safeParse(JSON.parse(line));
    if (!label.success) return { codes: ['TEACHER_LABEL_SCHEMA_INVALID'] };
    const entry = profiles.get(label.data.profileHash);
    if (!entry || entry.dataPolicy.dataClass !== 'public' || entry.dataPolicy.split === 'held_out') {
      return { codes: ['TEACHER_LABEL_PROFILE_DENIED'] };
    }
    const profile = ColumnProfileDocumentSchema.parse(entry.profile);
    if (
      columnProfileHash(profile) !== label.data.profileHash ||
      profile.layoutFingerprint !== layoutFingerprint(profile.columns)
    ) {
      return { codes: ['TEACHER_LABEL_PROFILE_MISMATCH'] };
    }
    const checked = validateMappingPlanV2(label.data.plan, mappingContextFromColumnProfile(profile));
    if (!checked.success) return { codes: checked.errors.map((error) => error.code) };
    if (checked.plan.method !== label.data.method) return { codes: ['TEACHER_LABEL_METHOD_MISMATCH'] };
    return { examples: labelExamples(checked.plan, label.data.profileHash, { ...entry, profile }) };
  } catch {
    return { codes: ['TEACHER_LABEL_INVALID'] };
  }
}

function writeExamples(descriptor: number, examples: PseudoLabelExample[]): boolean {
  try {
    writeSync(descriptor, examples.map(example => JSON.stringify(example) + '\n').join(''));
    return true;
  } catch {
    return false;
  }
}

function createLabelReport() {
  return {
    accepted: 0, rejected: 0, examples: 0, verifiedExamples: 0,
    labels: [] as { line: number; verifiedFields: number; unverifiedFields: number }[],
    rejections: [] as { line: number; codes: string[] }[],
  };
}

function recordLabelCheck(report: ReturnType<typeof createLabelReport>, checked: LabelCheck, line: number) {
  if ('codes' in checked) {
    report.rejected++;
    report.rejections.push({ line, codes: checked.codes });
    return;
  }
  const verifiedFields = checked.examples.filter(example => example.verified).length;
  report.examples += checked.examples.length;
  report.verifiedExamples += verifiedFields;
  report.labels.push({ line, verifiedFields, unverifiedFields: checked.examples.length - verifiedFields });
  report.accepted++;
}

/** Accept public-development pseudo-labels; deterministic verification is not truth or officer approval. */
export async function ingestTeacherLabels(inputPath: string, profiles: ProfileInventory, outputPath: string) {
  for (const path of [inputPath, outputPath]) {
    if (/(?:^|[\\/])\.env(?:\.|$)/i.test(path)) throw new Error('TEACHER_LABEL_PATH_FORBIDDEN');
  }
  assertTeacherOutputOutsideGit(outputPath);
  // Exclusive create: never replace or append a pre-existing training artifact.
  const descriptor = openSync(outputPath, 'wx', 0o600);
  const report = createLabelReport();
  const lines = createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber++;
      if (!line.trim()) continue;
      let checked = checkLabelLine(line, profiles);
      if ('examples' in checked && !writeExamples(descriptor, checked.examples)) {
        checked = { codes: ['TEACHER_LABEL_INVALID'] };
      }
      recordLabelCheck(report, checked, lineNumber);
    }
  } finally {
    closeSync(descriptor);
    lines.close();
  }
  return report;
}
