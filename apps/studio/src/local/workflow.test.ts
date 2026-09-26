import { describe, expect, it } from 'vitest';
import { normalizeProjectCode, projectCodeForPayload } from '@ulpin/contracts/usp';
import { randomPayload } from './workflow';

describe('proposed code generation', () => {
  it('uses the P3/1 alphabet and a valid check pair', () => {
    for (let i = 0; i < 50; i++) {
      const code = projectCodeForPayload(randomPayload());
      expect(code).toMatch(/^P3-[0-9A-HJKMNP-TV-Z]{20}-[0-9A-HJKMNP-TV-Z]{2}$/);
      expect(normalizeProjectCode(code)).toBe(code);
    }
  });
});
