import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import controls from '../../../../../docs/evidence/gf1/e3a/controls-qualified.json';
import targets from '../../../../../docs/evidence/gf1/e3b/targets.json';
import walkCapture from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { packagePath } from './batch-model';
import type { IntakeItem } from './batch-model';
import { approvalBody, latestRecipe, layoutLines, recipeStateWords, type Recipe } from './layout-model';
import type { Package } from './run/model';

type MapRecipe = Extract<Recipe, { plan: { version: 'manual-geojson/1' } }>;
const profile = controls.profiles[0]!;
const plan = { version: 'manual-geojson/1', mode: 'manual_mapping', source: profile.source,
  caseId: profile.caseId, workspaceRevision: profile.workspaceRevision,
  workspaceFingerprint: profile.workspaceFingerprint, operations: [
    { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
      conversionId: 'literal_identifier@1' },
    { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
  ] };
const receipt = { id: targets.packages[0]!.packageId, revision: 1, state: 'proposed', plan,
  destination: { kind: 'new_area', name: 'Test destination', namespace: 'test_only' },
  planHash: profile.source.sourceSha256, authoredBy: 'test', authoredAt: controls.manifest.items[0]!.createdAt,
  approval: null, execution: null } as MapRecipe;

it('shows each proposal origin from the item, never infers one from an author', () => {
  for (const [origin, words] of Object.entries({ memory: 'Remembered from an approved layout of the same columns',
    teacher: 'Proposed by the model', officer: 'Written by an officer',
    parent_file: 'Approved on the file this cell was cut from' })) {
    expect(layoutLines(receipt, origin as NonNullable<IntakeItem['plan']>['origin'])).toContain(words);
  }
  expect(layoutLines(receipt, null)).toContain('The record does not say who proposed this layout.');
  expect(recipeStateWords('approved')).toBe('Approved.');
  expect(recipeStateWords('executed')).toBe("This layout has prepared the file's package and can no longer be changed.");
  expect(recipeStateWords('proposed')).toBe('Proposed.');
});

it('states literal fields and absent name/height; plan members it does not show are not listed as codes', () => {
  const lines = layoutLines(receipt, 'officer');
  expect(lines).toContain('Identifier: doitt_id');
  expect(lines).toContain('Name: not stated');
  expect(lines).toContain('Height: not stated');
  expect(lines).toContain('Area: Test destination · new area');
  expect(lines).toContain('Each feature is: a building (the older layout form states nothing else)');
  expect(lines.join('\n')).not.toMatch(/Operation:|namespace|sha256|literal_identifier|geojson_polygon/);
  const extended = { ...receipt, plan: { ...receipt.plan, futureMember: 'test control' } };
  expect(layoutLines(extended, 'officer')).toEqual(lines);
});

it('a streamed receipt says the origin plainly and lists no plan members by their codes', () => {
  // test_only: a streamed plan's own members (version, mode, scope and the rest) beside one the Studio does not show.
  const streamed = { ...receipt, plan: { version: 'streamed-mapping/1', mode: 'manual_mapping',
    scope: 'accepted_source_features', kind: 'building', futureMember: 'test control', operations: [
      { target: 'feature.sourceKey', sourcePath: '/features/*/properties/OBJECTID',
        conversionId: 'literal_identifier@1' }] },
  } as unknown as Recipe;
  const lines = layoutLines(streamed, null);
  expect(lines.join('\n')).not.toContain('This layout also states');
  expect(lines.join('\n')).not.toMatch(/version|mode|scope|futureMember/);
  expect(lines).toContain('Identifier: OBJECTID');
  expect(lines.at(-1)).toBe('The record does not say who proposed this layout.');
});

it('shows escaped property names, Feature.id, height units/meaning and an existing destination exactly', () => {
  const named = { ...receipt, plan: { ...plan, heightField: 'height', heightUnit: 'ft',
    heightMeaning: 'Test meaning, not a statement about NYC', operations: [...plan.operations,
      { target: 'building.name', sourcePath: '/features/*/properties/name~1label~0', conversionId: 'literal_text@1' }],
  }, destination: { ...receipt.destination, kind: 'existing_area', areaId: targets.packages[0]!.areaId,
    expectedAreaRevision: 0, referenceFingerprint: profile.source.sourceSha256 } } as MapRecipe;
  expect(layoutLines(named, 'officer')).toContain('Name: name/label~');
  expect(layoutLines(named, 'officer')).toContain('Height: height, in feet: Test meaning, not a statement about NYC');
  expect(layoutLines(named, 'officer')).toContain('Area: Test destination · existing area');
  expect(layoutLines(named, 'officer').join('\n')).not.toMatch(/referenceFingerprint|areaId|namespace/);
  if (named.plan.version !== 'manual-geojson/1') throw new Error('Wrong test format');
  const metres = { ...named, plan: { ...named.plan, heightUnit: 'm' as const } };
  expect(layoutLines(metres, 'officer').join('\n')).toContain('in metres:');
  const featureId = { ...receipt, plan: { ...plan, operations: [
    { ...plan.operations[0], sourcePath: '/features/*/id' }, plan.operations[1],
  ] } } as MapRecipe;
  expect(layoutLines(featureId, 'officer')).toContain('Identifier: id');
});

it('selects greatest receipt revision, pins approval to it, and leaves input history unchanged', () => {
  const history = [{ ...receipt, revision: 3 }, receipt, { ...receipt, revision: 2 }];
  expect(latestRecipe(history)?.revision).toBe(3);
  expect(latestRecipe([])).toBeUndefined();
  expect(approvalBody(latestRecipe(history)!, receipt.id)).toEqual({
    requestKey: receipt.id, expectedRecipeRevision: 3,
  });
  expect(history.map(row => row.revision)).toEqual([3, 1, 2]);
});

it('only links a stored item package through a targets-page area reference', () => {
  const pkg = targets.packages[0] as Package;
  const item = { plan: { recipeId: receipt.id, recipeRevision: 3, recipeState: 'executed',
    origin: 'officer', packageId: pkg.packageId } } as Pick<IntakeItem, 'plan'>;
  expect(packagePath(item, [pkg])).toBe(`/studio/areas/${pkg.areaId}?package=${pkg.packageId}`);
  expect(packagePath(item, [])).toBeNull();
  expect(packagePath({ plan: null }, [pkg])).toBeNull();
});

it('pins the unchanged E1b author body and approve call, with no height', async () => {
  const source = readFileSync(resolve(import.meta.dirname, '../../../../../docs/evidence/gf1/e1b/steps.ts'), 'utf8');
  const start = source.indexOf('async function chooseLayout(');
  const end = source.indexOf('async function buildings(', start);
  const code = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
  let authored: unknown;
  let decision: unknown;
  let inspected = profile;
  let requestKey = receipt.id;
  const manual = { inspect: async () => inspected, author: async (_case: string, _source: string, body: unknown) => {
    authored = body;
    return receipt;
  }, decide: async (...args: unknown[]) => { decision = args; } };
  const gis = { suggestedTitle: 'Test destination', suggestedNamespace: 'test_only' };
  const choose = new Function('manual', 'query', 'randomUUID', `${code}; return chooseLayout;`)(
    manual, async () => ({ rows: [{ inspection: { gis } }] }), () => requestKey);
  await choose(profile.caseId, profile);
  expect(authored).toEqual({ requestKey: receipt.id, expectedRecipeRevision: 0,
    plan, destination: receipt.destination });
  expect(decision).toEqual([profile.caseId, receipt.id, approvalBody(receipt, receipt.id), 'approve']);
  // The HTTP helper's captured live request is exactly the existing harness body, not merely an equivalent recipe.
  inspected = walkCapture.profile;
  requestKey = walkCapture.authorBody.requestKey;
  gis.suggestedTitle = walkCapture.authorBody.destination.name;
  gis.suggestedNamespace = walkCapture.authorBody.destination.namespace;
  await choose(inspected.caseId, inspected);
  expect(authored).toEqual(walkCapture.authorBody);
});
