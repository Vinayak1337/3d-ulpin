import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { withFeaturePlan, uuid } from '../../../../packages/server/src/modules/usp/packets/feature-plan.test-fixture';
import { assessPlanTx } from '../../../../packages/server/src/modules/usp/packets/plan-authority';
import { projectCardFactsTx } from '../../../../packages/server/src/modules/usp/packets/card-projection';
import { renderPropertyCard } from '../../../../packages/server/src/modules/usp/packets/card-render';
import { renderPacket0 } from '../../../../packages/server/src/modules/usp/packet0';
import { canonical, fingerprint } from '../../../../packages/server/src/modules/cases/domain';
import { sha256 } from '../../../../packages/server/src/infrastructure/storage';
import { importedGeojsonRanges } from '../../../../packages/server/src/modules/areas/areas';
import { UspTextPacketPlanSchema } from '../../../../packages/contracts/src/usp/packets';

const path = 'docs/evidence/gf1/lp2/fixture-equivalence.json';
const results: unknown[] = [];

async function capture(index: number, useRange: boolean) {
  await withFeaturePlan(index, async store => {
    const input = { ...store.input(), expiresAt: '2026-10-11T12:00:00.000Z' };
    if (useRange) {
      const ranges = await importedGeojsonRanges(store.original, JSON.parse(store.original.toString()), []);
      store.features[0].body.sourceReference = { sourceRange: ranges.get(index) };
    }
    const assessment = await assessPlanTx(store.pool() as unknown as PoolClient, store.ctx, input, store.io.read,
      undefined, undefined, async (_key, start, end) => store.original.subarray(start, end));
    const body = { planId: uuid(6), version: 1, previousVersion: null, input, creator: store.ctx.principal,
      accessViewId: store.ctx.accessViewId, policyVersion: store.ctx.policyVersion,
      targetBodySha256: assessment.targetBodySha256, targetLabel: assessment.targetLabel,
      entries: assessment.entries, requiredContext: assessment.requiredContext, createdAt: '2026-10-11T10:00:00.000Z' };
    const plan = UspTextPacketPlanSchema.parse({ ...body, planSha256: fingerprint(body) });
    const projection = await projectCardFactsTx(store.pool() as unknown as PoolClient, store.ctx, plan);
    const packet = renderPacket0({ id: input.target.ref.id, label: plan.targetLabel }, assessment.lines, input.format);
    const card = { cardId: uuid(11), revision: 1, previousRevision: null, profile: 'property-card-summary-ascii/1',
      mode: 'local_operator', planId: plan.planId, planVersion: 1, planSha256: plan.planSha256,
      confirmationId: uuid(12), packetId: uuid(7), packetSha256: sha256(packet), target: input.target,
      scope: input.scope, targetBodySha256: plan.targetBodySha256, ...projection, creator: store.ctx.principal,
      accessViewId: store.ctx.accessViewId, policyVersion: store.ctx.policyVersion,
      evidenceEntrySha256: plan.entries.map(entry => entry.entrySha256), omissions: [],
      resolverUrl: `http://127.0.0.1:3188/api/v1/usp/property-cards/${uuid(11)}/revisions/1`,
      createdAt: body.createdAt, expiresAt: input.expiresAt } as const;
    // PDF file IDs are random by default; identical protocol entropy makes renderer bytes comparable.
    const random = Math.random;
    let pdf: Uint8Array;
    try {
      let seed = 12345;
      Math.random = () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      pdf = renderPropertyCard(card);
    } finally {
      Math.random = random;
    }
    results.push({ index, originalSha256: sha256(store.original), planBytes: canonical(plan),
      packetSha256: sha256(packet), cardBytes: canonical(card), cardPdfSha256: sha256(pdf!) });
  });
}

async function main() {
  await capture(0, false);
  await capture(1620, false);
  await capture(0, true);
  await capture(1620, true);
  assert.deepEqual(results.slice(0, 2), results.slice(2));
  const proof = { byteIdentical: ['plan and plan hash', 'packet', 'card content', 'card PDF'], records: 2,
    hashes: results.slice(0, 2).map((result: any) => ({ index: result.index,
      plan: sha256(result.planBytes), packet: result.packetSha256,
      card: sha256(result.cardBytes), pdf: result.cardPdfSha256 })),
    comparison: 'Real NYC fields; shared protocol IDs, timestamps and seeded PDF entropy; '
      + 'in-memory authority fixture, whole and range on the same captured source.' };
  writeFileSync(path, JSON.stringify(proof) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(proof));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
