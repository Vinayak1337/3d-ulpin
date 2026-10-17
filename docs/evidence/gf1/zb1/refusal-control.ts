import assert from 'node:assert/strict';
import { query, transaction } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { AppError } from '../../../../packages/server/src/infrastructure/errors';
import { intakeRunSteps } from '../../../../packages/server/src/modules/usp/ingestion/intake-run-worker';
import { queueIntakeRunTx } from '../../../../packages/server/src/modules/usp/ingestion/intake-run';
import { drop, layers, makeCase, manifest, targets } from './http-walk';
import { idle, prepareJobs } from './jobs';

const refusal = { code: 'USP_GEOMETRY_PAYLOAD_UNQUALIFIED', message:
  'Spatial analysis is not assessed: changed or unqualified geometry requires its own canonical qualification.' };

async function refused(caseId: string, item: Awaited<ReturnType<typeof drop>>) {
  await idle(caseId);
  await query(sql('ingestion.intake.targets')); // Reapply must preserve a stored refusal.
  const page = await targets(caseId);
  const entry = page.packages.find(row => row.packageId === item.packageId)!;
  const row = (await manifest(caseId)).items.find(row => row.itemId === item.itemId)!;
  const jobs = (await prepareJobs(caseId)).filter(job => job.packageId === item.packageId);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'succeeded');
  assert.equal(jobs[0].error, null);
  assert.deepEqual(entry.reviewRefusal, refusal);
  assert.equal(row.limitReason, refusal.message);
  assert.equal(row.state, 'read');
  assert.equal(row.placement, 'on_map');
  if (item.layer.kind === 'building') {
    assert.equal(page.counts.held, 1661);
    assert(page.items.every(target => target.reason === refusal.message && target.blockedBy[0] === refusal.code));
  } else assert(Object.values(entry.counts).every(count => count === 0));
  return { row, entry, jobs, survivingTerminalJob: true };
}

async function passed(caseId: string, item: Awaited<ReturnType<typeof drop>>) {
  // Explicitly labelled job-recovery control, not part of either officer walk; no review route is requested.
  await transaction(client => queueIntakeRunTx(client, caseId, { phase: 'prepare', packageId: item.packageId }));
  await idle(caseId);
  const page = await targets(caseId);
  const entry = page.packages.find(row => row.packageId === item.packageId)!;
  const row = (await manifest(caseId)).items.find(row => row.itemId === item.itemId)!;
  assert.equal(entry.reviewRefusal, null);
  assert.equal(entry.revision, 2);
  assert(entry.reviewFingerprint);
  assert.equal(row.limitReason, null);
  assert.equal(row.state, 'read');
  assert.equal(row.placement, 'on_map');
  return { row, entry, jobs: await prepareJobs(caseId) };
}

/** Inject the existing product refusal at the documented command seam; all storage/read-back/job work is real. */
export async function refusalControl() {
  const review = intakeRunSteps.review;
  intakeRunSteps.review = async () => { throw new AppError(422, refusal.code, refusal.message); };
  try {
    const caseId = await makeCase();
    const parks = await drop(caseId, layers[1]);
    const zero = await refused(caseId, parks);
    const buildings = await drop(caseId, layers[0]);
    const building = await refused(caseId, buildings);
    intakeRunSteps.review = review;
    return { labelledCommandControl: true, realReviewRefusalNotClaimed: true, noSourceFactsChanged: true,
      refusalSource: 'geometry.ts:197-198', zero, building,
      zeroCleared: await passed(caseId, parks), buildingCleared: await passed(caseId, buildings) };
  } finally { intakeRunSteps.review = review; }
}
