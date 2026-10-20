import { afterEach, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api } from '@ulpin/api-client';
import { IntakeConfirmSchema } from '../../../../../../packages/contracts/src/usp/intake';
import captured from '../../../../../../docs/evidence/gf1/e3b/targets.json';
import { readTargets } from './api';
import { Confirm, PackagePages } from './Confirm';
import { PackageDetails } from './Packages';
import { TargetList } from './TargetList';
import { beingRecorded, chooseReady, confirmablePackages, confirmBody, remainingPackagesWords, type Package,
  type TargetPage } from './model';

const { choiceIds: _, ...sample } = captured;
const base = sample as TargetPage;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pkg = (n: number): Package => ({ ...base.packages[0]!, packageId: uuid(n) });
// test_only: 250 unrecorded packages, paged as the read pages them (100, 100, 50), cursors made by the "server".
const all = Array.from({ length: 250 }, (_row, index) => pkg(index + 1));
const read = (index: number): TargetPage => {
  const packages = all.slice(index * 100, index * 100 + 100);
  return { ...base, packages, packagesTruncated: true, packagesTotal: 250, packagesUnrecorded: 250,
    packagesUnrecordedAfter: Math.max(0, 150 - index * 100),
    packagesNextCursor: index < 2 ? `page-${index + 1}` : null };
};

afterEach(() => vi.restoreAllMocks());

/** The pressable element whose words are the label, in a rendered tree of elements. */
function findButton(node: ReactNode, label: string): { onClick: () => void } | null {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return null;
  const children = [node.props.children].flat();
  if (node.props.onClick && children.join('') === label) return node.props as { onClick: () => void };
  for (const child of children) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

it('pressing "Next 100 packages" reads the next page; three presses name all 250 packages once', async () => {
  const get = vi.spyOn(api, 'GET').mockImplementation(async (_route, options) => {
    const query = (options as { params: { query: { packageCursor?: string } } }).params.query;
    const index = query.packageCursor ? Number(query.packageCursor.slice(5)) : 0;
    return { data: read(index), response: new Response() } as never;
  });
  let page = await readTargets(base.caseId);
  const named: string[][] = [];
  for (const remaining of [150, 50, 0]) {
    const body = confirmBody(page, [], 'Record these.', uuid(900));
    expect(IntakeConfirmSchema.safeParse(body).success).toBe(true);
    named.push(body.packages.map(row => row.packageId));
    let pressed: Promise<TargetPage> | null = null;
    const next = () => { pressed = readTargets(base.caseId, undefined, undefined, page.packagesNextCursor!); };
    const tree = PackagePages({ page, next, locked: false });
    if (remaining === 0) {
      expect(tree).toBeNull();
      break;
    }
    expect(renderToStaticMarkup(tree!)).toContain(remainingPackagesWords(100, remaining));
    findButton(tree, 'Next 100 packages')!.onClick();
    page = await pressed!;
  }
  expect(named.map(rows => rows.length)).toEqual([100, 100, 50]);
  expect(named.flat()).toEqual(all.map(row => row.packageId));
  expect(get.mock.calls.map(call => (call[1] as { params: { query: object } }).params.query))
    .toEqual([{}, { packageCursor: 'page-1' }, { packageCursor: 'page-2' }]);
});

it('the confirmation offers the next packages only while unrecorded ones follow, and a way back', () => {
  const props = { page: read(0), choice: [], cards: null, closeCards: () => {}, acknowledgement: 'Yes.',
    setAcknowledgement: () => {}, press: () => {}, busy: false, uncertain: false, stale: false, error: '' };
  const first = renderToStaticMarkup(createElement(Confirm, { ...props, next: () => {} }));
  expect(first).toContain('After these 100 packages, 150 more packages of this batch are not yet recorded.');
  expect(first).toContain('Next 100 packages');
  expect(first).not.toContain('Back to the first packages');
  const last = renderToStaticMarkup(createElement(Confirm, { ...props, page: read(2), next: () => {},
    first: () => {} }));
  expect(last).not.toContain('Next 100 packages');
  expect(last).toContain('Back to the first packages');
  expect(renderToStaticMarkup(createElement(Confirm, { ...props, busy: true, next: () => {} })))
    .toMatch(/<button[^>]*disabled=""[^>]*>Next 100 packages/);
  expect(renderToStaticMarkup(createElement(Confirm, { ...props, page: base, next: () => {} })))
    .not.toContain('Next 100 packages');
});

it('a package a confirmation is recording is shown "Being recorded" and its buildings are not offered', () => {
  const recording = uuid(800);
  const page = { ...base, packages: [{ ...base.packages[0]!, recordingConfirmationId: recording }] };
  const details = renderToStaticMarkup(createElement(PackageDetails, { pkg: page.packages[0]! }));
  expect(details).toContain('Being recorded by confirmation');
  expect(details).toContain(recording);
  expect(confirmablePackages(page)).toEqual([]);
  expect(chooseReady(page.items, page.packages)).toEqual([]);
  expect(confirmBody(page, page.items, 'Record these.', uuid(900))).toMatchObject({ packages: [], targets: [] });
  const list = renderToStaticMarkup(createElement(TargetList, { targets: page.items, choice: [], filter: '',
    setFilter: () => {}, toggle: () => {}, selectable: target => chooseReady([target], page.packages).length === 1,
    recording: beingRecorded(page.packages), onOpen: () => {}, showMore: () => {}, hasMore: false, loading: false,
    locked: false }));
  expect(list.match(/<input type="checkbox"[^>]*disabled=""/g)).toHaveLength(page.items.length);
  expect(list.match(/Being recorded with its package; it cannot be chosen now\./g)).toHaveLength(page.items.length);
});

it('a recording package leaves the counts and "Next 100 packages" as they were, and is not named', () => {
  const page = read(0);
  page.packages = page.packages.map((row, index) => index === 4 ? { ...row, recordingConfirmationId: uuid(800) } : row);
  const props = { page, choice: [], cards: null, closeCards: () => {}, acknowledgement: 'Yes.',
    setAcknowledgement: () => {}, press: () => {}, busy: false, uncertain: false, stale: false, error: '' };
  const html = renderToStaticMarkup(createElement(Confirm, { ...props, next: () => {} }));
  expect(html).toContain(remainingPackagesWords(100, 150));
  expect(html).toContain('Next 100 packages');
  const named = confirmBody(page, [], 'Record these.', uuid(900)).packages.map(row => row.packageId);
  expect(named).toEqual(page.packages.filter((_row, index) => index !== 4).map(row => row.packageId));
  expect(page.packages[4]!.counts).toEqual(base.packages[0]!.counts);
});
