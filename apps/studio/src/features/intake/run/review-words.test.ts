import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PackageDetails } from './Packages';
import capture from '../../../../../../docs/evidence/gf1/e3b/targets.json';
import { chooseReady, confirmablePackages, reviewWords, type Package, type TargetPage } from './model';

it('shows only the exact refusal message and excludes that package even if a stale review fingerprint remains', () => {
  const pkg: Package = { ...(capture.packages[0] as Package), reviewRefusal: {
    code: 'AREA_LIMIT', message: 'Exact stored review refusal; no invented remedy.',
  } };
  expect(reviewWords(pkg)).toBe(pkg.reviewRefusal!.message);
  expect(confirmablePackages({ ...capture, packages: [pkg] } as TargetPage)).toEqual([]);
  expect(chooseReady(capture.items as TargetPage['items'], [pkg])).toEqual([]);
});

it('preserves stored target reasons for an unreviewed package, but a published refusal says only its message', () => {
  const pkg = { ...(capture.packages[0] as Package), reviewFingerprint: null, reviewRefusal: null };
  const reasons = ['Controlled stored target reason.'];
  const pending = renderToStaticMarkup(createElement(PackageDetails, { pkg, reasons }));
  expect(pending).toContain('Its review has not run yet.');
  expect(pending).toContain(reasons[0]);
  const refused = { ...pkg, reviewRefusal: { code: 'CONTROL_ONLY', message: 'Controlled review refusal.' } };
  const refusedHtml = renderToStaticMarkup(createElement(PackageDetails, { pkg: refused, reasons }));
  expect(refusedHtml).toContain(refused.reviewRefusal.message);
  expect(refusedHtml).not.toContain(reasons[0]);
  expect(refusedHtml).not.toContain('Revision');
});

it('unreviewed and refused are different; a committed package is never described as waiting for review', () => {
  const pkg = capture.packages[0] as Package;
  expect(reviewWords({ ...pkg, reviewFingerprint: null, reviewRefusal: null })).toBe('Its review has not run yet.');
  expect(reviewWords({ ...pkg, state: 'COMMITTED', reviewFingerprint: null })).toBeNull();
  expect(reviewWords({ ...pkg, reviewRefusal: null })).toBeNull();
});
