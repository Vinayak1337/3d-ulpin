import { expect, it } from 'vitest';
import capture from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { blankChoices, choicesFromRecipe, identifierPaths, identifierWords, questionBody } from './question-model';
import type { MapProfile } from './question-model';
import type { Recipe } from './layout-model';

const profile = capture.profile as MapProfile;
const text = profile.paths.find(path => path.literalIdEligible)!;
const integer: MapProfile['paths'][number] = { ...text, path: '/features/*/properties/OBJECTID',
  literalIdEligible: false, integerIdEligible: true, types: ['number'] };
const mixed = { ...profile, paths: [integer, text, { ...integer, path: '/bad', integerIdEligible: false },
  ...profile.paths.filter(path => path.path === '/features/*/geometry')] } as MapProfile;

it('offers text and explicitly eligible whole numbers once in file order, with a qualified suffix', () => {
  expect(identifierPaths(mixed).map(path => path.path)).toEqual([integer.path, text.path]);
  expect(identifierWords(integer)).toBe('OBJECTID (whole number)');
  expect(identifierWords(text)).not.toContain('(whole number)');
  expect(identifierPaths({ ...mixed, paths: mixed.paths.map(path => ({ ...path,
    literalIdEligible: false, integerIdEligible: false })) })).toEqual([]);
});

it('copies the same pins/geometry and chooses only the identifier conversion; Change preserves whole-number identity', () => {
  const choices = { ...blankChoices, kind: 'parcel' as const, identifier: integer.path };
  const body = questionBody(mixed, choices, 7, capture.authorBody.requestKey)!;
  expect(body.plan.operations[0]).toEqual({ target: 'feature.sourceKey', sourcePath: integer.path,
    conversionId: 'literal_integer_identifier@1' });
  expect(body).not.toHaveProperty('destination');
  const receipt = { ...capture.authored, plan: body.plan, revision: 8 } as Recipe;
  expect(choicesFromRecipe(receipt)).toEqual(choices);
  expect(questionBody(mixed, choicesFromRecipe(receipt), receipt.revision, body.requestKey))
    .toMatchObject({ expectedRecipeRevision: 8, plan: body.plan });
  const textBody = questionBody(mixed, { ...choices, identifier: text.path }, 7, body.requestKey)!;
  expect(textBody.plan.operations[0]?.conversionId).toBe('literal_identifier@1');
});
