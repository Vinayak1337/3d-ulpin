import { describe, expect, it } from 'vitest';
import { draftLead } from './draft';

describe('the line a draft verify page leads with', () => {
  it('names the draft revision in a neutral tone and claims no validity', () => {
    expect(draftLead(2, 2)).toEqual({ text: 'Draft revision r2 on this device', tone: 'neutral' });
    expect(draftLead(2, 2).text).not.toMatch(/valid/i);
  });

  it('names the newest revision when the address names none', () => {
    expect(draftLead(null, 3)).toEqual({ text: 'Draft revision r3 on this device', tone: 'neutral' });
  });

  it('keeps the superseded line for an older revision', () => {
    expect(draftLead(1, 3)).toEqual({ text: 'Superseded by revision r3', tone: 'warning' });
  });
});
