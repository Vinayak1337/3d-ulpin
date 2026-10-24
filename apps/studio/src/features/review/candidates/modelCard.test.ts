import { describe, expect, it } from 'vitest';
import { modelCardSummary } from './modelCard';

describe('modelCardSummary', () => {
  it('reads the claim, development split and licence from a receipt', () => {
    const receipt = {
      model: { license: 'fixture licence' },
      quality: { claim: 'fixture claim', dev: { chips: 1434, recall: 0.6624, precision: 0.8544 } },
    };
    expect(modelCardSummary(receipt)).toEqual({
      claim: 'fixture claim',
      development: 'recall 0.66, precision 0.85 on 1,434 chips',
      licence: 'fixture licence',
    });
  });

  it('leaves unknown parts null instead of guessing', () => {
    expect(modelCardSummary(null)).toEqual({ claim: null, development: null, licence: null });
    expect(modelCardSummary({ quality: { dev: { recall: 'x' } } }).development).toBeNull();
  });
});
