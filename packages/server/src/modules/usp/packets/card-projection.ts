import type { PoolClient } from 'pg';
import { UspDeclarationInputSchema, UspReviewDeclarationSchema, type RequestContext, type TargetPin } from '@ulpin/contracts/usp';
import { normalizeProjectCode, ProjectLocationSchema, verticalLocator } from '../../../../../contracts/src/usp/project-identity';
import { UspPropertyCardFactSchema, type PropertyCardFact } from '../../../../../contracts/src/usp/property-card';
import type { PacketPlan } from '../../../../../contracts/src/usp/packets';
import { canonical, fingerprint } from '../../cases/domain';
import { conflict } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { scopedManifestTx } from '../commands';
import { selectExactPart } from '../packet0';

/** Called only under the existing plan disclosure protection. No current body is
 * substituted for a captured body, and no dependency outside the plan is read. */
export async function projectCardFactsTx(client: PoolClient, ctx: RequestContext, plan: PacketPlan) {
  const manifest = await scopedManifestTx(client, ctx, plan.input.scope);
  async function captured(pin: TargetPin) {
    const member = manifest.members.find(m => canonical(m.pin) === canonical(pin));
    const row = (await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies WHERE manifest_id=$1
      AND namespace=$2 AND object_id=$3 AND revision=$4`,
    [plan.input.scope.manifestId, pin.ref.namespace, pin.ref.id, pin.revision])).rows[0];
    if (!member || !row || fingerprint(row.body) !== row.body_sha256 || member.bodySha256 !== row.body_sha256
      || member.bodyRef !== fingerprint([pin.ref.namespace, pin.ref.id, pin.revision, row.body]))
      conflict('The exact card snapshot body does not match its manifest.');
    return row as { body: Record<string, any>; body_sha256: string };
  }
  const target = await captured(plan.input.target), body = target.body;
  if (target.body_sha256 !== plan.targetBodySha256 || body.id !== plan.input.target.ref.id
    || Number(body.revision) !== plan.input.target.revision || !['building', 'floor', 'space'].includes(body.kind))
    conflict('The exact card target does not match its executed plan.');
  const facts: PropertyCardFact[] = [];
  const available = (key: string, label: string, value: string) => facts.push(UspPropertyCardFactSchema.parse({ key, label, state: 'available', value, reasonCode: null }));
  const missing = (key: string, label: string, value: string, reasonCode: string, state: 'unavailable' | 'not_assessed' = 'unavailable') =>
    facts.push(UspPropertyCardFactSchema.parse({ key, label, state, value, reasonCode }));
  available('target', 'Selected record', `${plan.targetLabel} (${body.kind}); revision ${plan.input.target.revision}`);
  if (typeof body.identifier === 'string' && body.identifier.length) available('identifier', 'Registry identifier', body.identifier);
  else missing('identifier', 'Registry identifier', 'No captured identifier', 'identifier_not_recorded');
  const identity = body.projectIdentity;
  if (identity?.code) {
    if (normalizeProjectCode(identity.code) !== identity.code || !['assigned', 'retired', 'cancelled_error'].includes(identity.status))
      conflict('The captured application identity is invalid.');
    available('project_identity', 'Application identity', `${identity.code}; ${identity.status} (P3/1)`);
    const location = ProjectLocationSchema.parse(identity.location);
    // Print the vertical parts without importing unselected parcel assertions.
    available('vertical_locator', 'Recorded location', verticalLocator({ ...location, anchorState: 'not_supplied', parcels: [] }));
    const represented = [];
    for (const parcel of location.parcels) {
      const entry = plan.entries.find(e => e.state === 'included' && e.selection.pointer.sourceRevision.ref.id === parcel.source.sourceId
        && e.selection.pointer.sourceRevision.revision === parcel.source.revision && e.selection.pointer.locator.kind === 'verbatim'
        && e.selection.pointer.locator.locator === parcel.source.locator);
      if (!entry) continue;
      const source = await captured(entry.selection.pointer.sourceRevision);
      const excerpt = selectExactPart(source.body.inspection?.referenceParts, entry.selection.pointer.locator);
      if (source.body_sha256 !== entry.sourceBodySha256 || source.body.sha256 !== entry.sourceSha256
        || excerpt === null || sha256(excerpt) !== entry.excerptSha256) conflict('The selected parcel assertion source changed.');
      if (!excerpt.includes(parcel.literalValue)) continue;
      represented.push(`${parcel.literalValue} (${parcel.reviewState}; issuer ${parcel.issuer.state})`);
    }
    if (represented.length) available('parcel_assertions', 'Parent parcel assertions', `${represented.join('; ')}. These are recorded assertions, not issuance verification.`);
    else missing('parcel_assertions', 'Parent parcel assertions', `Selected evidence does not support a parent parcel assertion; anchor ${location.anchorState}`, 'selected_parcel_evidence_unavailable');
  } else {
    missing('project_identity', 'Application identity', 'No captured P3/1 identity', 'project_identity_not_recorded');
    missing('vertical_locator', 'Recorded location', 'No captured structured location', 'location_not_recorded');
    missing('parcel_assertions', 'Parent parcel assertions', 'No selected source-backed parcel assertion', 'selected_parcel_evidence_unavailable');
  }
  const shares: string[] = [], visited = new Set<string>();
  for (const entry of plan.entries) if (entry.state === 'included' && entry.applicabilitySha256 && entry.selection.review.kind === 'shared') {
    const pin = entry.selection.review.declaration, key = canonical(pin);
    if (visited.has(key)) continue;
    visited.add(key);
    const declaration = (await captured(pin)).body;
    const input = UspDeclarationInputSchema.parse(declaration.input), review = UspReviewDeclarationSchema.parse(declaration.review);
    const selected = input.entries.filter(e => canonical(e.target) === canonical(plan.input.target));
    if (selected.length !== 1 || declaration.technicalStatus !== 'technically_accepted'
      || !review.applicability.some(a => canonical(a.target) === canonical(plan.input.target) && a.state === 'applicable'
        && a.purpose === plan.input.purpose)) conflict('The selected declaration context is unavailable.');
    shares.push(`${selected[0].literalShare}; ${input.allocationSubject}; ${input.basis}; technically_accepted; legal not_assessed`);
  }
  if (shares.length) available('declared_share', 'Recorded declared share', shares.join('; '));
  else missing('declared_share', 'Recorded declared share', 'No included accepted applicability for this exact target and purpose', 'selected_declared_share_unavailable');
  missing('geometry', 'Geometry / frame / datum', 'Not supplied by the executed text/CSV profile', 'geometry_profile_unavailable');
  missing('measurements', 'Measurements / quantities', 'No qualified measured quantities in this profile', 'measurements_profile_unavailable');
  missing('render', 'Selected-space render', 'Rendering is unavailable in this profile', 'selected_space_render_unavailable');
  missing('rights', 'Rights / title / issuance', 'No ownership, title, legality or official issuance determination', 'rights_not_assessed', 'not_assessed');
  return { facts, snapshotCapturedAt: manifest.capturedAt };
}
