import { button, container, elements, propsOf } from './fake-dom';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import targets from '../../../../../docs/evidence/gf1/e3b/targets.json';
import type { IntakeItem } from './batch-model';
import type { EvidencePage } from './evidence/model';
import type { TargetPage } from './run/model';
import { stoppedReason } from './retry-command';
import { batchNeeds } from './needs-model';
import { NeedsYou } from './NeedsYou';
import { StepStrip } from './StepStrip';

const base = { ...captured.manifest.items[0], state: 'read', placement: 'needs_answer', plan: null,
  layoutQuestion: false } as unknown as IntakeItem;
const page = { ...targets, packages: [] } as TargetPage;
const evidence = { profiles: [{ profileId: 'key', input: { namespace: 'BIN', map: { anchorItemId: base.itemId } } }],
  sources: [], candidates: [], confirmations: [] } as unknown as EvidencePage;
// test_only answer states around the captured record; no new ingestion result is claimed.
const cases: [string, IntakeItem, TargetPage?, EvidencePage?][] = [
  ['layout', { ...base, state: 'planned', layoutQuestion: true }],
  ['layer-crs', { ...base, layerCrs: [{ layer: 'outlines', answer: null }] }],
  ['page-image', { ...base, family: 'image', pageImage: { label: null } } as IntakeItem],
  ['table', { ...base, family: 'table', card: { ...base.card!, family: 'table', format: 'csv', sheets: [] } }],
  ['retry', { ...base, placement: 'not_understood', limitReason: stoppedReason }],
  ['evidence', base, page, evidence],
  ['confirmation', base, { ...page, packages: [{ ...targets.packages[0]!, anchorItemId: base.itemId,
    state: 'REVIEWED', reviewFingerprint: 'review', reviewRefusal: null, recordingConfirmationId: null,
    counts: { ...page.counts, ready: 1 } }] } as TargetPage],
];
afterEach(() => vi.unstubAllGlobals());

function focusLookup(root: ReturnType<typeof container>) {
  vi.stubGlobal('document', Object.assign(Object.create(document), {
    getElementById: (id: string) => {
      const target = elements(root).find(node => node.getAttribute('id') === id);
      if (target) target.querySelectorAll = () => elements(target) as never;
      for (const node of [root.ownerDocument!.body, ...elements(root)]) Object.assign(node, {
        closest(selector: string) {
          for (let parent: typeof node | null = node; parent?.nodeType === 1;
            parent = parent.parentNode as typeof node | null) {
            if (selector === '#intake-answers button') {
              if (node.tagName === 'BUTTON' && parent.getAttribute('id') === 'intake-answers') return node;
            } else if (selector.split(', ').includes(parent.tagName.toLowerCase())
              || (selector.includes('[role="dialog"]') && parent.getAttribute('role') === 'dialog')
              || (selector.includes('[contenteditable]') && parent.hasAttribute('contenteditable'))) return parent;
          }
          return null;
        },
      });
      return target ?? null;
    },
  }));
}

it.each(cases)('%s has exactly one visible action; choosing its item mounts the answer before focus',
  async (_kind, item, run = page, keys) => {
    const needs = batchNeeds([item], run, keys);
    expect(needs.actions).toHaveLength(1);
    const action = needs.actions[0]!;
    const choose = vi.fn();
    function Host() {
      const [selected, setSelected] = useState<IntakeItem | null>(null);
      return <><NeedsYou {...needs} choose={next => {
        choose(next);
        setSelected(next);
      }} />
        {selected ? <section id={action.section}>
          {action.controlLabel ? <button aria-label={action.controlLabel}>Try again</button> : null}
        </section> : null}</>;
    }
    const root = container();
    focusLookup(root);
    const view = createRoot(root as never);
    await act(async () => view.render(<Host />));
    expect(elements(root).filter(node => node.tagName === 'BUTTON')).toHaveLength(1);
    expect(root.textContent).toContain(item.name);
    await act(async () => propsOf(button(root, action.label)).onClick?.({}));
    expect(choose).toHaveBeenCalledWith(item);
    const focused = document.activeElement;
    expect(focused?.getAttribute(action.controlLabel ? 'aria-label' : 'id'))
      .toBe(action.controlLabel ?? action.section);
    await act(async () => view.unmount());
  });

it.each(['first render', 'unchanged', 'next', 'body', 'none', 'other button', 'input', 'textarea', 'select', 'dialog'])
  ('focus after an answer: %s', async scenario => {
    const actions = cases.slice(0, 2).flatMap(([, item]) => batchNeeds([item], page).actions);
    const root = container();
    focusLookup(root);
    const view = createRoot(root as never);
    const render = (remaining = actions) => <><NeedsYou actions={remaining} status="Nothing needs you."
      choose={vi.fn()} />{actions.map(action => <section key={action.key} id={action.section} />)}
      <input /><textarea /><select />
      <div role="dialog"><button>Dialog action</button></div></>;
    root.focus();
    await act(async () => view.render(render()));
    expect(document.activeElement).toBe(root);
    if (scenario !== 'first render') {
      await act(async () => propsOf(button(root, actions[0]!.label)).onClick?.({}));
      if (scenario === 'other button') button(root, actions[1]!.label).focus();
      if (scenario === 'body') document.body.focus();
      const field = elements(root).find(node => node.tagName === scenario.toUpperCase());
      field?.focus();
      if (scenario === 'dialog') button(root, 'Dialog action').focus();
      const previous = document.activeElement;
      let remaining = actions.slice(1);
      if (scenario === 'unchanged') remaining = [...actions];
      if (scenario === 'none') remaining = [];
      await act(async () => view.render(render(remaining)));
      if (scenario === 'next' || scenario === 'body') {
        expect(document.activeElement).toBe(button(root, actions[1]!.label));
        await act(async () => propsOf(button(root, actions[1]!.label)).onClick?.({}));
        await act(async () => view.render(render([])));
        expect(document.activeElement?.getAttribute('id')).toBe('intake-answers');
      } else if (scenario === 'none') expect(document.activeElement?.getAttribute('id')).toBe('intake-answers');
      else expect(document.activeElement).toBe(previous);
    }
    await act(async () => view.unmount());
  });

it('nothing pending shows only the recorded progress line, without an action button', async () => {
  const reading = { ...base, state: 'reading', placement: 'undecided', partsDone: 198,
    partsPlanned: 211 } as IntakeItem;
  const needs = batchNeeds([reading], page);
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<NeedsYou {...needs} choose={vi.fn()} />));
  expect(root.textContent).toBe('Reading 1 file, 198 of 211 parts. Nothing needs you.');
  expect(elements(root).filter(node => node.tagName === 'BUTTON')).toHaveLength(0);
  await act(async () => view.unmount());
});

it('each strip button focuses its section, with one current step and counts from the fixture', async () => {
  const needs = batchNeeds([cases[0]![1]], page);
  const root = container();
  focusLookup(root);
  const view = createRoot(root as never);
  await act(async () => view.render(<><StepStrip {...needs} />
    {[...new Set(needs.steps.map(step => step.section))].map(id => <section key={id} id={id} />)}</>));
  const controls = elements(root).filter(node => node.tagName === 'BUTTON');
  expect(controls).toHaveLength(5);
  expect(controls.filter(node => node.getAttribute('aria-current') === 'step')).toHaveLength(1);
  expect(controls[2]?.textContent).toBe('Your answers 1 waiting');
  for (const [index, control] of controls.entries()) {
    await act(async () => propsOf(control).onClick?.({}));
    expect(document.activeElement?.getAttribute('id')).toBe(needs.steps[index]!.section);
  }
  await act(async () => view.unmount());
});
