import { describe, expect, it } from 'vitest';
import { registryHtml, registryTables, type RegistryDetail } from './registry';

type Report = Parameters<typeof registryHtml>[0];
const unknown = { value: null, state: 'unknown', sources: [] };
// Shape-only export input; no fixture is displayed as a product record.
const report = {
  building: { id: 'id', applicationId: 'application-id', name: unknown, areaName: unknown, revision: 1 },
  records: [], groups: [], sources: [], parcels: [], omissions: [],
  generatedAt: '2026-10-01T00:00:00Z', schemaVersion: 'building-registry-summary/1', recordState: 'recorded',
} as unknown as Report;
const detail: RegistryDetail = {
  buildingCode: null, address: null, datum: null, shareBasis: null, shareTotalPct: null,
  asOf: null, registers: null, floors: new Map(), units: new Map(),
};

describe('the building project code in register exports', () => {
  it('omits the fact from the PDF document and workbook when the building carries none', () => {
    expect(registryHtml(report, detail)).not.toContain('Project code');
    expect(registryTables(report, detail).building.map(([field]) => field)).not.toContain('Project code');
  });

  it('uses the screen label and the stated value in the PDF document and workbook', () => {
    const coded = { ...detail, buildingCode: 'test-project-code' };
    expect(registryHtml(report, coded)).toContain('<span>Project code</span>');
    expect(registryHtml(report, coded)).toContain('test-project-code');
    expect(registryHtml(report, coded)).not.toContain('3D ULPIN (proposed)');
    expect(registryTables(report, coded).building).toContainEqual(['Project code', 'test-project-code']);
  });
});
