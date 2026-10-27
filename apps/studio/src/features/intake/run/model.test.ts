import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Confirm } from './Confirm';
import { PackageDetails } from './Packages';
import captured from '../../../../../../docs/evidence/gf1/e3b/targets.json';
import saved from '../../../../../../docs/evidence/gf1/e3b/confirmation.json';
import { chooseReady, confirmBody, confirmationFacts, confirmationIds, confirmablePackages, confirmationWords,
  confirmingPackageWords, countsLine, readinessWords,
  stageWords, shouldRefetch, waitingReason, type TargetPage, type Readiness, type Confirmation } from './model';

const { choiceIds, ...sample } = captured;
const page = sample as TargetPage;
const key = saved.requestKey;
const zeroCounts = () => Object.fromEntries(Object.keys(page.counts).map(key => [key, 0])) as TargetPage['counts'];
const choices = choiceIds.map(targetId => ({ targetId, packageId: page.packages[0]!.packageId,
  readiness: 'ready' as const }));

it('makes exactly the confirmation body the HTTP journey sends for the same three targets and page', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../../../../../../docs/evidence/gf1/e1b/steps.ts'), 'utf8');
  const start = source.indexOf('function selectThree(');
  const end = source.indexOf('async function assertRefusals(', start);
  const script = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
  const select = new Function('assert', 'randomUUID', `${script}; return selectThree;`)(assert, () => key);
  const expected = select(page.packages[0], page.items).input;
  expect(confirmBody(page, page.items, expected.acknowledgement, key)).toEqual(expected);
});

it('preserves the officer words verbatim and never names a package without its review fingerprint', () => {
  const words = `  ${saved.acknowledgement}\n`;
  expect(confirmBody(page, page.items, words, key).acknowledgement).toBe(words);
  const unreviewed = { ...page, packages: page.packages.map(pkg => ({ ...pkg, reviewFingerprint: null })) };
  expect(confirmBody(unreviewed, page.items, words, key)).toMatchObject({ packages: [], targets: [] });
});

it('takes at most 100 distinct ready targets of the packages the page can confirm', () => {
  expect(chooseReady(choices, page.packages)).toHaveLength(100);
  expect(chooseReady([...choices, ...choices], page.packages)).toHaveLength(100);
  for (const readiness of Object.keys(readinessWords) as Readiness[]) {
    const changed = choices.map(choice => ({ ...choice, readiness }));
    expect(chooseReady(changed, page.packages)).toHaveLength(readiness === 'ready' ? 100 : 0);
  }
  const committed = { ...page, packages: page.packages.map(pkg => ({ ...pkg, state: 'COMMITTED' as const })) };
  expect(confirmablePackages(committed)).toEqual([]);
  expect(confirmBody(committed, choices, saved.acknowledgement, key).targets).toEqual([]);
});

it('finds distinct confirmations only from targets that actually name them', () => {
  expect(confirmationIds(page.items)).toEqual([]);
  expect(confirmationIds([...saved.progress, ...saved.progress, ...page.items])).toEqual([saved.confirmationId]);
});

it('shows counted zero, and stored waiting reasons without translating them', () => {
  expect(countsLine(page.counts)).toContain('0 stopped');
  for (const readiness of ['preparing', 'needs_answer', 'held', 'confirmed', 'stopped'] as Readiness[]) {
    expect(waitingReason({ ...page.items[0]!, readiness })).toBe(page.items[0]!.reason);
  }
});

it('has one plain sentence for every readiness and words for each stage', () => {
  expect(readinessWords).toEqual({
    preparing: 'The package is being prepared for review.', ready: 'Ready to record and make a card.',
    needs_answer: 'An answer is needed before this building can continue.',
    held: 'This building cannot continue with the current evidence.',
    confirmed: 'The officer has confirmed this building for a card.', recorded: 'This building is in the register.',
    carded: 'Its property card is made and verified.', stopped: 'Work stopped; the completed steps are kept.',
  });
  expect(Object.values(stageWords)).toEqual(['Read the source', 'Draft the package', 'Record in the register',
    'Link supporting records', 'Keep a snapshot of the record', 'Check whether an identity applies',
    'Make the evidence plan and packet', 'Make and verify the property card']);
});

it('names a reviewed zero-count package with no target, but never a package with buildings and none ready', () => {
  const empty = { ...page.packages[0]!, counts: zeroCounts() };
  const zeroPage = { ...page, packages: [empty], items: [] };
  expect(confirmablePackages(zeroPage)).toEqual([empty]);
  expect(confirmBody(zeroPage, [], saved.acknowledgement, key)).toEqual({ requestKey: key,
    acknowledgement: saved.acknowledgement, packages: [{ packageId: empty.packageId,
      revision: empty.revision, reviewFingerprint: empty.reviewFingerprint }], targets: [] });
  const held = { ...empty, counts: { ...empty.counts, held: 1 } };
  expect(confirmablePackages({ ...zeroPage, packages: [held] })).toEqual([]);
  expect(confirmablePackages({ ...zeroPage, packages: [{ ...empty, reviewFingerprint: null }] })).toEqual([]);
  expect(confirmablePackages({ ...zeroPage, packages: [{ ...empty, state: 'COMMITTED' }] })).toEqual([]);
});

it('enables zero-selection confirmation only with packages and nonblank acknowledgement, with exact sentences', () => {
  const facts = confirmationFacts([], 0);
  expect(confirmationWords(facts)).toBe('You will record 0 buildings from 0 files and make 0 cards');
  const empty = { ...page.packages[0]!, counts: zeroCounts() };
  expect(confirmingPackageWords(empty)).toBe('No building in this package; its features will be recorded.');
  const props = { page: { ...page, packages: [empty] }, choice: [], cards: null, closeCards: () => {},
    acknowledgement: saved.acknowledgement,
    setAcknowledgement: () => {}, press: () => {}, busy: false, uncertain: false, stale: false, error: '' };
  const enabled = renderToStaticMarkup(createElement(Confirm, props));
  expect(enabled).toContain(confirmationWords(confirmationFacts([empty], 0)));
  expect(enabled).not.toContain('disabled=""');
  expect(renderToStaticMarkup(createElement(Confirm, { ...props, acknowledgement: '   ' })))
    .toContain('disabled=""');
  const none = renderToStaticMarkup(createElement(Confirm, { ...props, page: { ...page, packages: [] } }));
  expect(none).toContain('disabled=""');
  const details = renderToStaticMarkup(createElement(PackageDetails, { pkg: empty, confirming: true }));
  expect(details).toContain(confirmingPackageWords(empty));
  expect(details).not.toContain('0 ready buildings will be recorded');
  const one = { ...empty, counts: { ...empty.counts, ready: 1 } };
  expect(confirmationWords(confirmationFacts([one], 1)))
    .toBe('You will record 1 building from 1 file and make 1 card');
});

describe('the quiet-stream refetch rule', () => {
  it('never polls a terminal or empty list', () => {
    expect(shouldRefetch((saved as Confirmation).progress, 0, 10000)).toBe(false);
    expect(shouldRefetch([{ readiness: 'stopped' }], 0, 10000)).toBe(false);
    expect(shouldRefetch([], 0, 10000)).toBe(false);
  });
  it('refetches a waiting listed building after five seconds, and resets after an event or refetch', () => {
    const waiting = [{ readiness: 'recorded' as const }];
    expect(shouldRefetch(waiting, 0, 4999)).toBe(false);
    expect(shouldRefetch(waiting, 0, 5000)).toBe(true);
    expect(shouldRefetch(waiting, 5000, 9999)).toBe(false);
    expect(shouldRefetch(waiting, 5000, 10000)).toBe(true);
  });
});
