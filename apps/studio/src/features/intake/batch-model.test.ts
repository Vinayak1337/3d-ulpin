import { expect, it } from 'vitest';
import controls from '../../../../../docs/evidence/gf1/e3a/controls-qualified.json';
import { countWords, crsWords, fieldWords, isSettled, placementWords, stateWords } from './batch-model';
import { fileRoute } from './file-route';
import { intakeRefreshFrame, silenceDelay } from './batch-events';
import type { IntakeItem } from './batch-model';

it('routes map originals to intake, binary maps to direct import and tables to their dialog', () => {
  expect(fileRoute('buildings-original.geojson')).toBe('intake');
  expect(fileRoute('sidewalk.JSON')).toBe('intake');
  expect(fileRoute('boundary.gpkg')).toBe('direct');
  expect(fileRoute('boundary.zip')).toBe('direct');
  expect(fileRoute('register.csv')).toBe('table');
  expect(fileRoute('register.xlsx')).toBe('table');
  expect(fileRoute('plan.pdf')).toBe('unsupported');
});

it('keeps a question distinct from state and renders unknown counts without zero', () => {
  const item = controls.manifest.items[0] as IntakeItem;
  expect(stateWords(item.state)).toBe('File checked');
  expect(placementWords(item.placement)).toBe('Needs an answer');
  expect(isSettled(item)).toBe(true);
  expect(isSettled({ ...item, state: 'reading', placement: 'undecided' })).toBe(false);
  expect(stateWords('read_to_limit')).toBe('Read to the limit');
  expect(stateWords('probe_failed')).toBe('File could not be checked');
  expect(countWords(null)).toBe('Not known');
  expect(countWords(undefined)).toBe('Not known');
  expect(countWords(0)).toBe('0');
  expect(crsWords(null)).toBe('Not known');
  expect(fieldWords('/features/*/properties/doitt_id')).toBe('doitt_id');
  expect(fieldWords('/features/*/properties/a~1b~0c')).toBe('a/b~c');
});

it('refreshes on case intake notifications and waits five quiet seconds', () => {
  expect(intakeRefreshFrame({ kind: 'ready' })).toBe(true);
  expect(intakeRefreshFrame({ kind: 'resync' })).toBe(true);
  expect(intakeRefreshFrame({ change: { kind: 'intake.item' } })).toBe(true);
  expect(intakeRefreshFrame({ change: { kind: 'intake.target' } })).toBe(true);
  expect(intakeRefreshFrame({ change: { kind: 'recipe.changed' } })).toBe(true);
  expect(intakeRefreshFrame({ change: { kind: 'mapping.chunk' } })).toBe(false);
  expect(intakeRefreshFrame(null)).toBe(false);
  expect(silenceDelay(1000, 1000)).toBe(5000);
  expect(silenceDelay(1000, 5999)).toBe(1);
  expect(silenceDelay(1000, 6000)).toBe(0);
});
