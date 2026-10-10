import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@ulpin/api-client';
import recorded from '../../../../../docs/evidence/gf5/f3d/responses.json';
import {
  confirmPlan, createPlan, executePlan, generateCard, previewCard, readCard, readPlanEntries,
} from '../../api/queries';
import {
  confirmBody, entriesBody, executeBody, firstCard, generateBody, nextRevision, planBody, type PlanEntry,
} from './issue';
import { prepareRevision } from './prepare';
import * as queries from '../../api/queries';
import type { SnapshotScope } from './assignment';

interface Parser { parse: (body: unknown) => unknown }

// Runtime imports keep the Studio compiler out of unrelated backend schemas, without copying any schema.
const { UspGeneratePropertyCardSchema, UspPreviewPropertyCardSchema, UspReadPropertyCardSchema } =
  await vi.importActual<Record<
    'UspGeneratePropertyCardSchema' | 'UspPreviewPropertyCardSchema' | 'UspReadPropertyCardSchema', Parser
  >>('../../../../../packages/contracts/src/usp/property-card');
const { UspReadPacketPlanEntriesSchema } = await vi.importActual<Record<'UspReadPacketPlanEntriesSchema', Parser>>(
  '../../../../../packages/contracts/src/usp/packet-pdf',
);
const { UspConfirmPacketPlanSchema, UspCreatePacketPlanSchema, UspExecutePacketPlanSchema } =
  await vi.importActual<Record<
    'UspConfirmPacketPlanSchema' | 'UspCreatePacketPlanSchema' | 'UspExecutePacketPlanSchema', Parser
  >>('../../../../../packages/contracts/src/usp/packets');

const scope = recorded.snapshots.items[0]!.scope as SnapshotScope;
const card = {
  cardId: recorded.cardList.data.items[0]!.cardId, revision: 1,
  planId: '8f3ebb97-deab-4235-a377-819e5942bfd8', planVersion: 1, scope,
} as Parameters<typeof nextRevision>[0];
const expiry = '2026-10-11T06:30:00.000Z';
const plan = { planId: card.planId, version: card.planVersion, planSha256: scope.snapshotDigest };
const subject = {
  unitId: recorded.spaceId, areaId: scope.scopeId, revision: 2,
  evidence: { sourceId: '5293cd72-2377-4deb-a51c-c76d11ccb429', revision: 1, locator: 'page 1' },
};
const entry = { bindingId: scope.snapshotDigest } as PlanEntry;
const requestKey = 'f3i-contract-regression';
const preview = nextRevision(card, expiry);

// These are protocol controls, not registry facts. Production parsers validate every emitted request.
function accept(schema: Parser, data: unknown = {}) {
  return vi.spyOn(api, 'POST').mockImplementation(async (_route, options) => {
    schema.parse((options as { body: unknown }).body);
    return { data: { data }, response: new Response() } as never;
  });
}

afterEach(() => vi.restoreAllMocks());

describe('route boundaries select fields from structurally wider objects', () => {
  it('reads only cardId and revision from an issue target', async () => {
    const sent = accept(UspReadPropertyCardSchema);
    const target = { ...card, mode: 'update' as const, label: 'Issue new revision' as const };
    await readCard(target);
    expect(sent.mock.calls[0]![1]).toEqual({ body: { cardId: card.cardId, revision: 1 } });
  });

  it('builds the entry read without UI fields', async () => {
    accept(UspReadPacketPlanEntriesSchema);
    const wider = { ...entriesBody(scope, subject), label: 'Prepare' };
    await readPlanEntries(wider);
  });

  it('builds the plan creation without UI fields', async () => {
    accept(UspCreatePacketPlanSchema);
    const body = planBody(scope, subject, entry, { expiresAt: expiry, inclusionReason: 'The boxed label.' }, requestKey);
    const wider = { ...body, label: 'Prepare' };
    await createPlan(wider);
  });

  it('builds the plan confirmation without UI fields', async () => {
    accept(UspConfirmPacketPlanSchema);
    const wider = { ...confirmBody(plan, scope, requestKey), label: 'Prepare' };
    await confirmPlan(wider);
  });

  it('builds the packet execution without UI fields', async () => {
    accept(UspExecutePacketPlanSchema);
    const wider = { ...executeBody(plan, scope.manifestId, requestKey), label: 'Prepare' };
    await executePlan(wider);
  });

  it('builds the preview without UI fields', async () => {
    accept(UspPreviewPropertyCardSchema);
    const wider = { ...preview, label: 'Prepare' };
    await previewCard(wider);
  });

  it('builds the generation without UI fields', async () => {
    accept(UspGeneratePropertyCardSchema);
    const wider = { ...generateBody(preview, requestKey), label: 'Issue new revision' };
    await generateCard(wider);
  });
});

describe('the revision builders', () => {
  it('prepares a revision from the listed card with a strict read and a strict preview', async () => {
    const sent = vi.spyOn(queries, 'readCard').mockImplementation(async (body) => {
      UspReadPropertyCardSchema.parse(body);
      return { card } as never;
    });
    const rows = vi.spyOn(queries, 'previewCard').mockImplementation(async (body) => {
      UspPreviewPropertyCardSchema.parse(body);
      return { mode: 'update', revision: 2, facts: [] } as never;
    });
    const target = { mode: 'update' as const, label: 'Issue new revision' as const,
      cardId: card.cardId, revision: card.revision };
    const prepared = await prepareRevision(target, expiry);
    expect(prepared.request).toEqual(preview);
    expect(sent.mock.calls).toEqual([[{ cardId: card.cardId, revision: 1 }]]);
    expect(rows.mock.calls).toEqual([[preview]]);
  });

  it('generates only route fields even when the preview and guard carry UI fields', () => {
    const wider = { ...preview, label: 'Issue new revision', guard: { ...preview.guard, label: 'Confirm' } };
    expect(UspGeneratePropertyCardSchema.parse(generateBody(wider, requestKey))).toEqual({
      ...preview, guard: { ...preview.guard, requestKey },
    });
    expect(UspPreviewPropertyCardSchema.parse(firstCard(plan, expiry))).toEqual(firstCard(plan, expiry));
  });
});
