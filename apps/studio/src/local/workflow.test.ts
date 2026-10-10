import { describe, expect, it, vi } from 'vitest';
import { normalizeProjectCode, projectCodeForPayload } from '@ulpin/contracts/usp';
import { assignProposedCode, randomPayload } from './workflow';

const database = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('idb', () => ({ openDB: vi.fn(async () => database) }));

describe('the draft assignment title', () => {
  it('holds no worked-out revision while the event retains its revision and previous hash', async () => {
    database.get.mockResolvedValue({
      spaceId: 'test-space', buildingId: 'test-building', spaceName: 'test-name',
      status: 'Reviewed', code: null, assignedAt: null, events: [{ revision: 6, hash: 'test-hash' }],
    });
    const result = await assignProposedCode('test-space');
    expect(result.events[0]).toMatchObject({
      title: 'Proposed code assigned', revision: 7, previousHash: 'test-hash', kind: 'recorded',
    });
    expect(database.put).toHaveBeenCalledWith('spaces', result);
  });
});

describe('proposed code generation', () => {
  it('uses the P3/1 alphabet and a valid check pair', () => {
    for (let i = 0; i < 50; i++) {
      const code = projectCodeForPayload(randomPayload());
      expect(code).toMatch(/^P3-[0-9A-HJKMNP-TV-Z]{20}-[0-9A-HJKMNP-TV-Z]{2}$/);
      expect(normalizeProjectCode(code)).toBe(code);
    }
  });
});
