import type { PoolClient } from 'pg';
import { SourceStatedRecordSchema } from '@ulpin/contracts';
import type { ProjectIdentityReviewSchema, ProjectLocation } from '@ulpin/contracts/usp';
import type { z } from 'zod';
import { fingerprint } from '../cases/domain';
import { AppError } from '../../infrastructure/errors';

type Review = z.infer<typeof ProjectIdentityReviewSchema>;
const denied = () => new AppError(422, 'USP_SOURCE_IDENTITY',
  'Keep source-only identity evidence and location unqualified.');

function assertUnknownLocation(location: ProjectLocation | undefined): void {
  if (location && (location.anchorState !== 'not_supplied' || location.parcels.length
    || location.locator.levels.length !== 1 || location.locator.levels[0] !== 'L?'
    || location.locator.spaceKind !== '?' || location.locator.structureKind !== '?')) throw denied();
}

/** The P3 protocol is unchanged; source-only participants add literal/original and unknown-location guards. */
export async function validateSourceStatedIdentityTx(client: PoolClient, rows: { id: string; body: any }[], review: Review) {
  for (const row of rows.filter(row => row.body?.sourceOnly)) {
    const result = SourceStatedRecordSchema.safeParse(row.body);
    if (!result.success || result.data.kind !== 'space'
      || !['assign', 'correct', 'cancel', 'retire'].includes(review.operation)) throw denied();
    const record = result.data;
    assertUnknownLocation(review.location);
    assertUnknownLocation(review.locations?.[row.id]);
    const evidence = record.sourceOnly.evidence;
    if (!review.evidence.some(item => item.sourceId === evidence.sourceId && item.revision === evidence.sourceRevision
      && item.locator === record.evidence[0].locator)) throw denied();
    const source = (await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies
      WHERE manifest_id=$1 AND namespace='source_revision' AND object_id=$2 AND revision=$3`,
    [review.scope.manifestId, evidence.sourceId, evidence.sourceRevision])).rows[0];
    if (!source || fingerprint(source.body) !== source.body_sha256 || source.body.id !== evidence.sourceId
      || source.body.sha256 !== evidence.sourceSha256
      || source.body.revision !== evidence.sourceRevision) throw denied();
  }
}
