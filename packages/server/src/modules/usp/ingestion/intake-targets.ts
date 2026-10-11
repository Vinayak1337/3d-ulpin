import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { ImportPackage, PhysicalFeature } from '@ulpin/contracts';
import { INTAKE_TARGET_LIMITS, IntakeTargetCountsSchema, IntakeTargetPageSchema,
  IntakeTargetReadinessSchema, IntakeTargetSchema,
  type IntakeTarget, type IntakeTargetArtefacts, type IntakeTargetReadiness } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, notFound } from '../../../infrastructure/errors';
import { isSourceNativeCandidate } from '../geometry';
import { appendCaseIngestionTx, appendIntakeTargetsTx } from './events';
import { intakeCaseTx } from './intake-context';
import { queueIntakeRunTx, stableUuid } from './intake-run';

export type IntakeTargetRow = {
  target_id: string; case_id: string; anchor_item_id: string; package_id: string; feature_id: string;
  locator: string; kind: 'building'; stage: number; readiness: IntakeTargetReadiness; blocked_by: string[];
  reason: string | null; confirmation_id: string | null; priority_at: Date | null;
  artefacts: IntakeTargetArtefacts; updated_at: Date;
};
export type Readiness = { readiness: IntakeTargetReadiness; reason: string; blockedBy: string[] };
const uuid = z.string().uuid();
const open = ['preparing', 'ready', 'needs_answer', 'held'];
const notCandidate = "Not a candidate read from the publisher's retained original; "
  + 'recorded or derived geometry keeps its qualification gate.';

function held(reason: string): Readiness {
  return { readiness: 'held', reason, blockedBy: [] };
}

function tally(codes: string[]): string {
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].map(([code, count]) => `${code} (${count})`).join(', ');
}

function unknowns(feature: PhysicalFeature): string {
  const role = feature.geometryRole ?? feature.semantics?.geometryRole;
  const unknown = [...(!role || role === 'unknown' ? ['role'] : []),
    ...(feature.height.value === null ? ['height'] : []), 'floors', 'units'];
  return `The record states as unknown: ${unknown.join(', ')}.`;
}

function readyReason(feature: PhysicalFeature, review: NonNullable<ImportPackage['review']>): string {
  const codes = review.findings.filter(finding => finding.featureIds.includes(feature.id)).map(finding => finding.code);
  const named = codes.length ? `The review names it in ${codes.length} finding(s): ${tally(codes)}.`
    : 'The review names it in no finding.';
  return `Ready to record. ${named} ${unknowns(feature)}`;
}

/** Ready is decided here only, by rules. No finding blocks a commit (it has no severity), and unknowns never block. */
export function intakeTargetReadiness(target: { featureId: string }, pkg: ImportPackage,
  review: ImportPackage['review']): Readiness {
  if (pkg.sourceWorkspace) return held('This package is a source workspace; it is not reviewed as map observations.');
  if (!review || review.packageRevision !== pkg.revision) {
    return { readiness: 'preparing', reason: 'The package review has not run on its current revision.', blockedBy: [] };
  }
  const feature = pkg.features.find(value => value.id === target.featureId);
  if (!feature) return held('This feature is no longer in its package.');
  if (!isSourceNativeCandidate(feature, pkg)) return held(notCandidate);
  return { readiness: 'ready', reason: readyReason(feature, review), blockedBy: [] };
}

/** The citation CA4 takes: the feature key the record's evidence will name. */
export function targetLocator(feature: PhysicalFeature): string {
  const own = feature.evidence.find(entry => entry.sourceRevisionId === feature.sourceRevisionId && entry.featureId);
  return `feature ${own?.featureId ?? feature.sourceKey}`;
}

/** One row per building of a drafted package, in one statement; called where the draft item becomes read. */
export async function createIntakeTargetsTx(client: PoolClient, caseId: string, itemId: string,
  pkg: ImportPackage, sourceId: string): Promise<number> {
  const buildings = pkg.features.filter(feature => feature.kind === 'building');
  if (buildings.length > INTAKE_TARGET_LIMITS.draftTargets) {
    throw new AppError(413, 'INTAKE_TARGET_LIMIT', 'A drafted package offers at most 2000 targets.');
  }
  const locators = buildings.map(targetLocator);
  const inserted = (await client.query(`INSERT INTO usp_intake_targets(target_id,case_id,anchor_item_id,package_id,
    feature_id,locator,kind,stage,readiness,reason)
    SELECT t.id,$1,$2,$3,t.feature,t.locator,'building',2,'preparing','The package review has not run yet.'
    FROM unnest($4::uuid[],$5::uuid[],$6::text[]) AS t(id,feature,locator)
    ON CONFLICT (package_id,locator) DO NOTHING RETURNING target_id,readiness,stage`,
  [caseId, itemId, pkg.id, locators.map(locator => stableUuid(`intake-target/1:${pkg.id}:${locator}`)),
    buildings.map(feature => feature.id), locators])).rows;
  if (inserted.length) await appendIntakeTargetsTx(client, caseId, inserted);
  const prepared = (await client.query(`SELECT id FROM jobs WHERE case_id=$1 AND operation='intake-run'
    AND payload->>'phase'='prepare' AND payload->>'packageId'=$2 LIMIT 1`, [caseId, pkg.id])).rows[0];
  if (!prepared) await queueIntakeRunTx(client, caseId, { phase: 'prepare', packageId: pkg.id }, sourceId);
  return inserted.length;
}

/** Decide every open target of a reviewed package in one statement. */
export async function prepareIntakeTargetsTx(client: PoolClient, pkg: ImportPackage) {
  const rows = (await client.query(`SELECT target_id,case_id,feature_id FROM usp_intake_targets
    WHERE package_id=$1 AND readiness=ANY($2) ORDER BY target_id FOR UPDATE`, [pkg.id, open])).rows;
  const decided = rows.map(row => ({ id: row.target_id as string,
    ...intakeTargetReadiness({ featureId: row.feature_id }, pkg, pkg.review) }));
  const changed = (await client.query(`UPDATE usp_intake_targets t SET readiness=d.readiness,reason=d.reason,
    blocked_by='{}',updated_at=now() FROM unnest($1::uuid[],$2::text[],$3::text[]) AS d(id,readiness,reason)
    WHERE t.target_id=d.id RETURNING t.target_id,t.readiness,t.stage`,
  [decided.map(row => row.id), decided.map(row => row.readiness), decided.map(row => row.reason)])).rows;
  if (changed.length) await appendIntakeTargetsTx(client, rows[0].case_id, changed);
  return decided;
}

/** A review the product refused holds every open target of the package, with the product's code and words. */
export async function holdPackageTargetsTx(client: PoolClient, caseId: string, packageId: string,
  code: string, message: string) {
  const rows = (await client.query(`UPDATE usp_intake_targets SET readiness='held',reason=$3,blocked_by=ARRAY[$2],
    updated_at=now() WHERE package_id=$1 AND readiness=ANY($4) RETURNING target_id,readiness,stage`,
  [packageId, code, message.slice(0, 2000), open])).rows;
  await appendIntakeTargetsTx(client, caseId, rows);
}

/** After the commit every recorded exterior of the package is recorded once, listed or not. */
export async function recordPackageTargetsTx(client: PoolClient, caseId: string, packageId: string) {
  const rows = (await client.query(`UPDATE usp_intake_targets t SET readiness='recorded',stage=GREATEST(t.stage,3),
    blocked_by='{}',reason=CASE WHEN t.confirmation_id IS NULL
      THEN 'Recorded with its package; not listed for a card.' ELSE 'Recorded; its card is made in turn.' END,
    artefacts=t.artefacts||jsonb_build_object('record',jsonb_build_object('id',r.id,'revision',r.revision)),
    updated_at=now()
    FROM physical_features f JOIN registry_records r ON r.id=f.record_id
    WHERE t.package_id=$1 AND f.id=t.feature_id AND r.revision>0 AND NOT (t.artefacts ? 'record')
    AND t.readiness NOT IN ('carded','stopped') RETURNING t.target_id,t.readiness,t.stage`, [packageId])).rows;
  await appendIntakeTargetsTx(client, caseId, rows);
  return rows.length;
}

async function targetEventTx(client: PoolClient, row: Pick<IntakeTargetRow, 'case_id' | 'target_id'
  | 'readiness' | 'stage'>) {
  await appendCaseIngestionTx(client, row.case_id,
    { kind: 'intake.target', targetId: row.target_id, readiness: row.readiness, stage: row.stage });
}

/** One step done: its stage, its artefacts and the words, with the event in the same transaction. */
export async function advanceIntakeTargetTx(client: PoolClient, targetId: string, change: {
  stage: number; readiness: IntakeTargetReadiness; reason: string; artefacts: Partial<IntakeTargetArtefacts>;
}) {
  const row = (await client.query(`UPDATE usp_intake_targets SET stage=$2,readiness=$3,reason=$4,
    artefacts=artefacts||$5,blocked_by='{}',updated_at=now() WHERE target_id=$1
    RETURNING case_id,target_id,readiness,stage`,
  [targetId, change.stage, change.readiness, change.reason, change.artefacts])).rows[0];
  await targetEventTx(client, row);
}

/** A refused step stops this listed target only; what is done stays done. */
export async function stopIntakeTargetTx(client: PoolClient, targetId: string, confirmationId: string,
  code: string, message: string) {
  const row = (await client.query(`UPDATE usp_intake_targets SET readiness='stopped',blocked_by=ARRAY[$3],
    reason=$4,updated_at=now() WHERE target_id=$1 AND confirmation_id=$2 AND readiness<>'carded'
    RETURNING case_id,target_id,readiness,stage`, [targetId, confirmationId, code, message.slice(0, 2000)])).rows[0];
  if (row) await targetEventTx(client, row);
}

export function intakeTargetView(row: IntakeTargetRow): IntakeTarget {
  return IntakeTargetSchema.parse({ targetId: row.target_id, caseId: row.case_id, anchorItemId: row.anchor_item_id,
    packageId: row.package_id, featureId: row.feature_id, locator: row.locator, kind: row.kind, stage: row.stage,
    readiness: row.readiness, blockedBy: row.blocked_by, reason: row.reason, confirmationId: row.confirmation_id,
    priorityAt: row.priority_at?.toISOString() ?? null, artefacts: row.artefacts,
    updatedAt: row.updated_at.toISOString() });
}

type TargetCounts = z.infer<typeof IntakeTargetCountsSchema>;
type PackageCounts = { anchorItemId: string; counts: TargetCounts };

function emptyCounts(): TargetCounts {
  return Object.fromEntries(IntakeTargetReadinessSchema.options.map(name => [name, 0])) as TargetCounts;
}

async function countsTx(client: PoolClient, caseId: string) {
  const counts = emptyCounts();
  const packages = new Map<string, PackageCounts>();
  const drafted = (await client.query(`SELECT p.id AS package_id,min(i.item_id::text) AS anchor_item_id
    FROM usp_intake_items i JOIN import_packages p ON p.id::text=i.plan_ref->>'packageId'
    WHERE i.case_id=$1 GROUP BY p.id ORDER BY p.id`, [caseId])).rows;
  for (const row of drafted) packages.set(row.package_id,
    { anchorItemId: row.anchor_item_id, counts: emptyCounts() });
  const rows = (await client.query(`SELECT package_id,min(anchor_item_id::text) AS anchor_item_id,
    readiness,count(*)::int AS count FROM usp_intake_targets WHERE case_id=$1
    GROUP BY package_id,readiness ORDER BY package_id,readiness`, [caseId])).rows;
  for (const row of rows) {
    const readiness = IntakeTargetReadinessSchema.parse(row.readiness);
    // A package with targets is always listed, whether or not an item still points to it.
    const pkg = packages.get(row.package_id) ?? { anchorItemId: row.anchor_item_id, counts: emptyCounts() };
    pkg.counts[readiness] = row.count;
    counts[readiness] += row.count;
    packages.set(row.package_id, pkg);
  }
  return { counts, packages };
}

/** Project review metadata in SQL: never return the body or any package features. */
async function packageFactsTx(client: PoolClient, packages: Map<string, PackageCounts>) {
  const ids = [...packages.keys()].slice(0, 101);
  const rows = (await client.query(`WITH packages AS (
    SELECT p.id,p.body->>'areaId' AS area_id,(p.body->>'revision')::int AS revision,
      p.body->>'state' AS state,CASE WHEN p.body->'review'->'packageRevision'=p.body->'revision'
        THEN p.body->'review' ELSE NULL END AS review
    FROM import_packages p WHERE p.id=ANY($1::uuid[]) ORDER BY p.id LIMIT 101
  ) SELECT id,area_id,revision,state,review->>'inputFingerprint' AS review_fingerprint,
    CASE WHEN review IS NULL THEN NULL ELSE COALESCE((
      SELECT jsonb_object_agg(code,count) FROM (
        SELECT finding->>'code' AS code,count(*)::int AS count
        FROM jsonb_array_elements(review->'findings') AS finding GROUP BY finding->>'code'
      ) AS findings
    ),'{}'::jsonb) END AS finding_counts FROM packages ORDER BY id`, [ids])).rows;
  return { packages: rows.slice(0, 100).map(row => ({ packageId: row.id, areaId: row.area_id,
    anchorItemId: packages.get(row.id)!.anchorItemId, revision: row.revision, state: row.state,
    reviewFingerprint: row.review_fingerprint, findingCounts: row.finding_counts,
    counts: packages.get(row.id)!.counts })), packagesTruncated: packages.size > 100 };
}

/** A page of a case's targets in id order, and its counts by readiness. */
export async function listIntakeTargets(caseIdValue: string, readiness: string | undefined,
  cursorValue: string | undefined) {
  const caseId = uuid.parse(caseIdValue);
  const filter = readiness === undefined ? null : IntakeTargetReadinessSchema.parse(readiness);
  const cursor = cursorValue === undefined ? null : uuid.parse(cursorValue);
  return transaction(async client => {
    await intakeCaseTx(client, caseId);
    const rows = (await client.query(`SELECT * FROM usp_intake_targets WHERE case_id=$1
      AND ($2::text IS NULL OR readiness=$2) AND ($3::uuid IS NULL OR target_id>$3)
      ORDER BY target_id LIMIT $4`, [caseId, filter, cursor, INTAKE_TARGET_LIMITS.page + 1])).rows;
    const page = rows.slice(0, INTAKE_TARGET_LIMITS.page);
    const summary = await countsTx(client, caseId);
    const packages = await packageFactsTx(client, summary.packages);
    return IntakeTargetPageSchema.parse({ caseId, items: page.map(intakeTargetView), counts: summary.counts,
      ...packages, nextCursor: rows.length > page.length ? page.at(-1).target_id : null });
  });
}

/** A waiting target an officer opened is taken first by the run; nothing else about it changes. */
export async function prioritizeIntakeTarget(caseIdValue: string, targetIdValue: string): Promise<IntakeTarget> {
  const caseId = uuid.parse(caseIdValue);
  const targetId = uuid.parse(targetIdValue);
  return transaction(async client => {
    await intakeCaseTx(client, caseId, true);
    const current = (await client.query(`SELECT readiness,confirmation_id FROM usp_intake_targets
      WHERE target_id=$1 AND case_id=$2 FOR UPDATE`, [targetId, caseId])).rows[0]
      ?? notFound('Intake target not found.');
    if (!current.confirmation_id || !['confirmed', 'recorded'].includes(current.readiness)) {
      throw new AppError(409, 'INTAKE_TARGET_NOT_WAITING',
        `This target is ${current.readiness}; only a waiting one is moved up.`);
    }
    const row = (await client.query(`UPDATE usp_intake_targets SET priority_at=now(),updated_at=now()
      WHERE target_id=$1 RETURNING *`, [targetId])).rows[0] as IntakeTargetRow;
    await targetEventTx(client, row);
    return intakeTargetView(row);
  });
}
