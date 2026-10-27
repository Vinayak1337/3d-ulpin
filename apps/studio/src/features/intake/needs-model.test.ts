import { expect, it } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import targets from '../../../../../docs/evidence/gf1/e3b/targets.json';
import type { IntakeItem } from './batch-model';
import type { EvidencePage } from './evidence/model';
import type { TargetPage } from './run/model';
import { stoppedReason } from './retry-command';
import { batchNeeds } from './needs-model';

const item = { ...captured.manifest.items[0], state: 'read', placement: 'on_map', plan: null,
  layoutQuestion: false } as unknown as IntakeItem;
const page = { ...targets, packages: [], counts: { ...targets.counts, carded: 3 } } as TargetPage;
const layout = { ...item, state: 'planned', placement: 'needs_answer', layoutQuestion: true } as IntakeItem;

it('S1.2: planned, needs_answer and no plan still offers its layout, counted once', () => {
  const needs = batchNeeds([layout], page);
  expect(needs.actions).toHaveLength(1);
  expect(needs.actions[0]).toMatchObject({ item: layout, label: `Answer the layout of ${layout.name}`,
    section: `intake-layout-${layout.itemId}` });
  expect(needs.steps.map(step => step.count)).toEqual([1, 0, 1, 0, 3]);
  expect(needs.current).toBe(2);
  expect(batchNeeds([{ ...layout, layoutQuestion: false }], page).actions).toEqual([]);
});

it('counts each unanswered layer, not answered layers, and only retries the supported stopped reason', () => {
  const layers = { ...item, layerCrs: [{ layer: 'outlines', answer: null },
    { layer: 'roads', answer: { crs: 'EPSG:4326' } }] } as IntakeItem;
  expect(batchNeeds([layers], page).actions.map(action => action.label))
    .toEqual([`State the coordinate system of outlines in ${item.name}`]);
  const stopped = { ...item, placement: 'not_understood', limitReason: stoppedReason } as IntakeItem;
  expect(batchNeeds([stopped], page).actions[0]?.controlLabel).toBe(`Try again: ${item.name}`);
  expect(batchNeeds([{ ...stopped, limitReason: 'Another refusal.' }], page).actions).toEqual([]);
});

it('the first unfinished step wins; known part counts sum and unknown parts never become zero', () => {
  const reading = { ...item, state: 'reading', partsDone: 198, partsPlanned: 211 } as IntakeItem;
  const needs = batchNeeds([reading, layout], page);
  expect(needs.current).toBe(1);
  expect(needs.steps.map(step => step.count)).toEqual([2, 1, 1, 0, 3]);
  expect(batchNeeds([reading], page).status).toBe('Reading 1 file, 198 of 211 parts. Nothing needs you.');
  expect(batchNeeds([{ ...reading, partsPlanned: null }], page).status).toBe('Reading 1 file. Nothing needs you.');
  expect(batchNeeds([], page).current).toBe(0);
  expect(batchNeeds([item], page).current).toBe(4);
  expect(batchNeeds([item]).steps[4]?.count).toBeNull();
});

it('only packages the existing confirmation model permits count, with one action for the officer confirmation', () => {
  const pkg = { ...targets.packages[0]!, anchorItemId: item.itemId, state: 'REVIEWED', reviewFingerprint: 'review',
    recordingConfirmationId: null, reviewRefusal: null, counts: { ...page.counts, ready: 1 }
  } as TargetPage['packages'][0];
  const needs = batchNeeds([item], { ...page, packages: [pkg, { ...pkg, packageId: 'recorded', state: 'COMMITTED' }] });
  expect(needs.current).toBe(3);
  expect(needs.steps[3]?.count).toBe(1);
  expect(needs.actions).toHaveLength(1);
  expect(needs.actions[0]?.section).toBe('intake-run-panel');
  expect(needs.actions[0]?.label).toContain(item.name);
});

it('an evidence key stops waiting after its current confirmation, and waits again when superseded', () => {
  const evidence = { profiles: [{ profileId: 'key', input: { namespace: 'BIN',
    map: { anchorItemId: item.itemId } } }], sources: [], candidates: [], confirmations: []
  } as unknown as EvidencePage;
  expect(batchNeeds([item], page, evidence).actions[0]?.label).toBe(`Confirm the evidence for key BIN in ${item.name}`);
  const confirmed: EvidencePage = { ...evidence, confirmations: [{ profileId: 'key', confirmationId: 'confirmed',
    additions: 'citations', createdAt: item.updatedAt, expiresAt: item.updatedAt, newerSources: [], accepted: [],
    superseded: false }] };
  expect(batchNeeds([item], page, confirmed).actions).toEqual([]);
  const superseded = { ...confirmed, confirmations: [{ ...confirmed.confirmations[0]!, superseded: true }] };
  expect(batchNeeds([item], page, superseded).actions).toHaveLength(1);
});
