import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { MappingPlanV2Schema, type MappingPlanV2 } from '@ulpin/contracts';
import { assertTeacherOutputOutsideGit } from '../../model-gateway/recordings';
import { validateMappingPlanV2, type MappingValidationContext } from './mapping-plan-v2';

export const MAPPING_MEMORY_PATH = 'E:/BhuAayam-data/task-data/a4/memory/accepted-plans.jsonl';
const lineageSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('teacher'), method: z.string().startsWith('model:'),
    labelFileSha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ source: z.literal('officer'), method: z.string().startsWith('reviewer:'),
    officerDecisionId: z.string().min(1).max(512) }),
]);
const entrySchema = z.strictObject({
  version: z.literal('mapping-memory/1'), plan: MappingPlanV2Schema,
  lineage: lineageSchema, acceptedAt: z.string().datetime(),
});
export type MappingMemoryLineage = z.infer<typeof lineageSchema>;
type MemoryEntry = z.infer<typeof entrySchema>;
export type MappingMemoryLookup = {
  plan: MappingPlanV2 | null;
  reasonCode: string | null;
  lineage?: MappingMemoryLineage;
};

function readEntries(path: string): MemoryEntry[] {
  assertTeacherOutputOutsideGit(path);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.trim());
  // Corrupt append history fails closed; silently skipping an officer decision could expose a teacher plan.
  return lines.map(line => entrySchema.parse(JSON.parse(line)));
}

function selectedEntry(entries: MemoryEntry[], fingerprint: string): MemoryEntry | undefined {
  const matching = entries.filter(entry => entry.plan.layoutFingerprint === fingerprint);
  const officers = matching.filter(entry => entry.lineage.source === 'officer');
  // Append order is acceptance order; wall-clock ties never choose a preceding decision.
  return (officers.length ? officers : matching).at(-1);
}

/** Append only a validated accepted plan with explicit teacher/officer authority and immutable lineage. */
export function rememberMapping(
  plan: MappingPlanV2, context: MappingValidationContext, lineage: MappingMemoryLineage,
  path = MAPPING_MEMORY_PATH,
) {
  assertTeacherOutputOutsideGit(path);
  const checked = validateMappingPlanV2(plan, context);
  if (!checked.success) throw new Error(checked.errors[0]?.code ?? 'MAPPING_MEMORY_PLAN_INVALID');
  const authority = lineageSchema.parse(lineage);
  if (authority.method !== checked.plan.method) throw new Error('MAPPING_MEMORY_METHOD_MISMATCH');
  const entry = entrySchema.parse({ version: 'mapping-memory/1', plan: checked.plan, lineage: authority,
    acceptedAt: new Date().toISOString() });
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
  return entry;
}

/** Exact layout reuse only; revalidate units, citations, parent inventory and all other context invariants. */
export function lookupMappingMemory(
  fingerprint: string, context: MappingValidationContext, path = MAPPING_MEMORY_PATH,
): MappingMemoryLookup {
  try {
    const entry = selectedEntry(readEntries(path), fingerprint);
    if (!entry) return { plan: null, reasonCode: 'MAPPING_MEMORY_MISS' };
    const proposed = { ...entry.plan, method: `memory:${fingerprint.slice(0, 12)}` };
    const checked = validateMappingPlanV2(proposed, context);
    if (!checked.success) return { plan: null, reasonCode: checked.errors[0]?.code ?? 'MAPPING_MEMORY_STALE' };
    return { plan: checked.plan, reasonCode: null, lineage: entry.lineage };
  } catch {
    return { plan: null, reasonCode: 'MAPPING_MEMORY_UNAVAILABLE' };
  }
}
