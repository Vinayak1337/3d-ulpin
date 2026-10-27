import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { answerSummary, blankChoices, choicesFromReading, choicesFromRecipe, heightPaths, identifierPaths,
  identifierWords, kindRefusal,
  kindWords, namePaths, needsLayoutAnswer, questionBody } from './question-model';
import type { Choices, Kind, MapProfile } from './question-model';
import { layoutLines, type Recipe } from './layout-model';
import type { IntakeItem } from './batch-model';
import type { Reading } from './reading-model';

const profile = captured.profile as MapProfile;
const receipt = captured.authored as Recipe;
const choices: Choices = { ...blankChoices, kind: 'building', identifier: '/features/*/properties/doitt_id' };
const key = captured.authorBody.requestKey;

it('prefills eligible proposals with basis, never height facts or officer answers', () => {
  const field = (name: string) => `/features/*/properties/${name}`;
  const reading = (basis: Reading['what']['basis'] = 'rule'): Reading => ({
    version: 'intake-reading/1' as const, what: { words: 'NYC footprints.', basis }, holds: [], links: [],
    drawing: { as: 'building', words: 'Suggested kind: building.', basis }, question: 'How should it be read?',
    fields: ([['bin', 'building.sourceKey'], ['name', 'building.name'], ['height_roof', 'building.heightM']] as const)
      .map(([name, target]) => ({ field: field(name), target, words: 'Proposed meaning.', basis })),
  });
  // Test-only completeness envelope: the captured NYC profile has no complete name field.
  const named = { ...profile, paths: [...profile.paths,
    { ...profile.paths.find(path => path.path === field('bin'))!, path: field('name') }] };
  const expected = { kind: 'building', identifier: field('bin'), name: field('name'),
    height: field('height_roof') } satisfies Partial<Choices>;
  for (const basis of ['reader', 'memory', 'rule', 'sarvam'] as const) {
    const filled = choicesFromReading(reading(basis), named);
    expect(filled).toEqual({ ...expected, basis: { kind: basis, identifier: basis, name: basis, height: basis } });
    expect(filled).not.toHaveProperty('unit');
    expect(filled).not.toHaveProperty('meaning');
  }
  expect(choicesFromReading(reading('officer'), named)).toEqual({});
  expect(choicesFromReading({ ...reading(), fields: [], drawing: { ...reading().drawing, as: 'outlines' } }, named))
    .toEqual({});
  expect(choicesFromReading(reading(), profile)).not.toHaveProperty('name');
  const refused = { ...named, geometryTypes: ['LineString'], paths: [] };
  expect(choicesFromReading(reading(), refused)).toEqual({});
  const noHeight = { ...reading(), fields: reading().fields.filter(line => line.target !== 'building.heightM') };
  const { basis: _, ...filled } = choicesFromReading(noHeight, named);
  expect(questionBody(named, { ...blankChoices, ...filled }, 0, key))
    .toEqual(questionBody(named, { ...blankChoices, ...expected, height: '' }, 0, key));
  expect(questionBody(named, { ...blankChoices, ...choicesFromReading(reading(), named) }, 0, key)).toBeNull();
});

it('starts without required choices and makes a kind layout for each officer-chosen kind, never a destination', () => {
  expect(questionBody(profile, blankChoices, 0, key)).toBeNull();
  for (const kind of Object.keys(kindWords) as Kind[]) {
    const body = questionBody(profile, { ...choices, kind }, 0, key)!;
    expect(body).not.toHaveProperty('destination');
    expect(body.plan).toMatchObject({ kind, source: profile.source, operations: [
      { target: 'feature.sourceKey', sourcePath: choices.identifier, conversionId: 'literal_identifier@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
    ] });
    expect(body.plan).not.toHaveProperty('heightField');
  }
});

it('includes chosen name and all three height facts, never a height without unit or meaning', () => {
  const selected = { ...choices, name: choices.identifier, height: '/features/*/properties/height_roof' };
  expect(heightPaths(profile).map(path => path.path)).toContain(selected.height);
  expect(questionBody(profile, selected, 0, key)).toBeNull();
  expect(questionBody(profile, { ...selected, unit: 'm' }, 0, key)).toBeNull();
  expect(questionBody(profile, { ...selected, meaning: 'Test control' }, 0, key)).toBeNull();
  for (const unit of ['m', 'ft'] as const) {
    const body = questionBody(profile, { ...selected, unit, meaning: 'Test control height above ground' }, 2, key)!;
    expect(body).toMatchObject({ expectedRecipeRevision: 2, plan: { heightField: 'height_roof', heightUnit: unit,
      heightMeaning: 'Test control height above ground' } });
    if (body.plan.version !== 'manual-geojson/1') throw new Error('Wrong test format');
    expect(body.plan.operations[2]).toEqual({ target: 'feature.name', sourcePath: selected.name,
      conversionId: 'literal_text@1' });
  }
  expect(questionBody(profile, { ...selected, unit: 'm', meaning: '  ' }, 0, key)).toBeNull();
  expect(questionBody(profile, { ...selected, unit: 'm', meaning: `a${' '.repeat(500)}` }, 0, key)).toBeNull();
});

it('disables outline kinds for lines, allows road/utility, and never coerces identifiers', () => {
  const line = { ...profile, geometryTypes: ['LineString'] };
  for (const kind of ['building', 'parcel', 'public_land'] as const) {
    expect(kindRefusal(kind, line.geometryTypes)).toBe(`This file holds lines; ${kindWords[kind]} must be an outline.`);
    expect(questionBody(line, { ...choices, kind }, 0, key)).toBeNull();
  }
  expect(kindRefusal('road', line.geometryTypes)).toBeNull();
  expect(kindRefusal('utility', ['Point'])).toBeNull();
  expect(kindRefusal('road', [])).not.toBeNull();
  const numeric = { ...profile, paths: profile.paths.map(path => path.path === choices.identifier
    ? { ...path, literalIdEligible: false, types: ['number'] as const } : path) };
  expect(questionBody(numeric as MapProfile, choices, 0, key)).toBeNull();
  const noIdentifier = { ...profile, paths: profile.paths.map(path => ({ ...path, literalIdEligible: false })) };
  expect(questionBody(noIdentifier, choices, 0, key)).toBeNull();
});

it('takes an outline kind over a file with outlines, pins and lines, and says the rest stays in the original', () => {
  const mixed = { ...profile, geometryTypes: ['Polygon', 'Point', 'LineString'] };
  for (const kind of ['building', 'parcel', 'public_land'] as const) {
    expect(kindRefusal(kind, mixed.geometryTypes)).toBeNull();
    expect(questionBody(mixed, { ...choices, kind }, 0, key)?.plan.kind).toBe(kind);
  }
  expect(answerSummary(choices, mixed.geometryTypes)).toBe(`${answerSummary(choices)} `
    + 'Pins and lines in this file are kept in the original but not drawn as buildings.');
  expect(answerSummary({ ...choices, kind: 'parcel' }, ['MultiPolygon', 'MultiPoint']))
    .toMatch(/ Pins in this file are kept in the original but not drawn as land parcels\.$/);
  expect(answerSummary({ ...choices, kind: 'road' }, mixed.geometryTypes)).toBe(answerSummary({ ...choices,
    kind: 'road' }));
  expect(answerSummary(choices, profile.geometryTypes)).toBe(answerSummary(choices));
  expect(kindRefusal('building', ['Point', 'LineString']))
    .toBe('This file does not hold outlines only; a building must be an outline.');
});

it('offers a key the outlines hold when the pins and lines carry none, and only for an outline kind', () => {
  const mixed = { ...profile, geometryTypes: ['LineString', 'Point', 'Polygon'], paths: profile.paths.map(path =>
    path.path === choices.identifier ? { ...path, literalIdEligible: false, outlineLiteralIdEligible: true } : path) };
  for (const kind of ['', 'building', 'parcel', 'public_land'] as const) {
    expect(identifierPaths(mixed, kind).map(path => path.path)).toContain(choices.identifier);
  }
  expect(identifierPaths(mixed, 'road').map(path => path.path)).not.toContain(choices.identifier);
  expect(questionBody(mixed, choices, 0, key)?.plan.operations[0]).toEqual({ target: 'feature.sourceKey',
    sourcePath: choices.identifier, conversionId: 'literal_identifier@1' });
  expect(answerSummary(choices, mixed.geometryTypes))
    .toMatch(/ Pins and lines in this file are kept in the original but not drawn as buildings\.$/);
  expect(questionBody(mixed, { ...choices, kind: 'road' }, 0, key)).toBeNull();
  const unkeyed = { ...mixed, paths: mixed.paths.map(path => path.path === choices.identifier
    ? { ...path, outlineLiteralIdEligible: false } : path) };
  expect(identifierPaths(unkeyed, 'building').map(path => path.path)).not.toContain(choices.identifier);
  expect(questionBody(unkeyed, choices, 0, key)).toBeNull();
  const numbered = { ...mixed, paths: mixed.paths.map(path => path.path === choices.identifier
    ? { ...path, outlineLiteralIdEligible: false, integerIdEligible: false, outlineIntegerIdEligible: true } : path) };
  expect(questionBody(numbered, choices, 0, key)?.plan.operations[0]?.conversionId)
    .toBe('literal_integer_identifier@1');
  expect(identifierWords(numbered.paths.find(path => path.path === choices.identifier)!, 'building'))
    .toMatch(/\(whole number\)$/);
});

it('offers complete outline names without requiring pins to have them, but refuses missing outline names', () => {
  // test_only profile facts: no operational labels.
  const name = choices.identifier;
  const mixed = { ...profile, geometryTypes: ['Polygon', 'Point'], paths: profile.paths.map(path =>
    path.path === name ? { ...path, literalTextEligible: false, outlineLiteralTextEligible: true } : path) };
  for (const kind of ['', 'building', 'parcel', 'public_land'] as const) {
    expect(namePaths(mixed, kind).map(path => path.path)).toContain(name);
  }
  expect(namePaths(mixed, 'road').map(path => path.path)).not.toContain(name);
  expect(questionBody(mixed, { ...choices, name }, 0, key)?.plan.operations[2]?.sourcePath).toBe(name);
  const missing = { ...mixed, paths: mixed.paths.map(path => path.path === name
    ? { ...path, outlineLiteralTextEligible: false } : path) };
  expect(questionBody(missing, { ...choices, name }, 0, key)).toBeNull();
});

it('offers the same layout question for a plain item and a ZIP member regardless of display words', () => {
  const item = { ...captured.manifest.items[0], archiveItemId: null, streamedProfileJobId: null,
    layoutQuestion: true, recordsSeen: 2100 } as IntakeItem;
  const member = { ...item, limitReason: `Taken out of layers.zip. ${item.limitReason}` };
  expect(needsLayoutAnswer(item)).toBe(true);
  expect(needsLayoutAnswer(member)).toBe(true);
  expect(needsLayoutAnswer({ ...item, limitReason: 'Read 2 Point features; they are not footprints.' })).toBe(true);
  expect(member.limitReason).toBe(`Taken out of layers.zip. ${item.limitReason}`);
});

it('uses the structured question, not a filename or reason, and never asks when no question is published', () => {
  const item = { ...captured.manifest.items[0], archiveItemId: null,
    streamedProfileJobId: null, layoutQuestion: true } as IntakeItem;
  expect(needsLayoutAnswer({ ...item, name: 'not-a-map.pdf', limitReason: null })).toBe(true);
  expect(needsLayoutAnswer({ ...item, layoutQuestion: false })).toBe(false);
  expect(needsLayoutAnswer({ ...item, layoutQuestion: undefined })).toBe(false);
  expect(needsLayoutAnswer({ ...item, placement: 'undecided' })).toBe(false);
});

it('states only chosen answers in the summary and reads feature targets in the review', () => {
  expect(answerSummary(choices)).toBe('Each feature is a building, identified by doitt_id. '
    + 'Name: not stated. Height: not stated.');
  const body = questionBody(profile, choices, 7, key)!;
  const stated = { ...receipt, plan: body.plan } as Recipe;
  expect(layoutLines(stated, 'teacher')).toContain('Each feature is: a building');
  expect(layoutLines(stated, 'teacher')).toContain('Identifier: doitt_id');
  expect(choicesFromRecipe(stated)).toEqual(choices);
  expect(questionBody(profile, choicesFromRecipe(stated), stated.revision, key)?.expectedRecipeRevision)
    .toBe(stated.revision);
  const named = questionBody(profile, { ...choices, name: choices.identifier }, 1, key)!;
  expect(layoutLines({ ...receipt, plan: named.plan } as Recipe, 'officer')).toContain('Name: doitt_id');
});

it('matches KN2 layout author body member for member for the same profile and building choice', async () => {
  const source = readFileSync(resolve(import.meta.dirname, '../../../../../docs/evidence/gf1/kn2/steps.ts'), 'utf8');
  const start = source.indexOf('async function layout(');
  const end = source.indexOf('async function legacyBytes(', start);
  const code = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
  let authored: unknown;
  const http = async (method: string, path: string, _route: string, _schema: unknown, body: unknown) => {
    if (method === 'GET') return profile;
    if (path.endsWith('/recipes')) {
      authored = body;
      return { ...receipt, plan: (body as { plan: unknown }).plan, planHash: 'test-control-hash' };
    }
    return receipt;
  };
  const layout = new Function('intakeHttp', 'AnySourceProfileSchema', 'AnyMappingReceiptSchema', 'fingerprint',
    'randomUUID', 'assert', `${code}; return layout;`)(http, {}, {}, () => 'test-control-hash', () => key, assert);
  await layout(profile.caseId, profile, {}, 'building', false);
  expect(questionBody(profile, choices, 0, key)).toEqual(authored);
});
