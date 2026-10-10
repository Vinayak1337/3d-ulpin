import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { NormalizedBuildingSchema, SourceSpaceRequestSchema } from '@ulpin/contracts';
import { transaction } from '../../infrastructure/db';
import { fingerprint } from '../cases/domain';
import type { commandSourceSpace } from './source-spaces';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
export const retainedTower = NormalizedBuildingSchema.parse(read('docs/evidence/gf-t16/k3b/tower-after-current.json'));
const importReceipt = read('docs/evidence/gf-backend/k2/tower3-source-import.json');
export const unitSource = importReceipt.documentPins[1];
export const towerRequest = SourceSpaceRequestSchema.parse({ requestKey: 'ac2542c8-fd15-4bdf-85a4-fbc87f59a6ee',
  expectedCanonicalRevision: retainedTower.revisionId,
  level: { label: '2ND FLOOR PLAN', evidence: { sourceId: unitSource.sourceId, sourceRevision: 1, page: 1,
    region: [850, 875, 1020, 910], literal: '2ND FLOOR PLAN' } },
  space: { label: 'UNIT-3B', evidence: { sourceId: unitSource.sourceId, sourceRevision: 1, page: 1,
    region: [206.88, 254.25, 1241.28, 559.35], literal: 'UNIT-3B' } },
  reason: 'Protocol control of source-stated labels only; no live record, geometry or unit boundary assertion',
});

/** SQL protocol double of the existing registry histories; never connects to a database. */
export class SourceSpaceControl {
  rows: any[] = [];
  histories: any[] = [];
  links: any[] = [];
  queries: string[] = [];
  siteRevision = 4;
  areaRevision = 4;
  pageCount = 1;
  sourceRevision = 1;
  sourceAttached = true;
  building = structuredClone(retainedTower);
  feature = { id: retainedTower.buildingId, area_id: retainedTower.areaId, revision: 4,
    body: importReceipt.features[0] };
  constructor() {
    this.rows.push({ id: retainedTower.buildingId, site_id: retainedTower.areaId, kind: 'building',
      identifier: importReceipt.features[0].identifier, revision: 4, body: {
        id: retainedTower.buildingId, siteId: retainedTower.areaId, identifier: importReceipt.features[0].identifier,
        alias: 'TOWER 3', name: 'TOWER 3', kind: 'building', footprint: [], links: [], rights: [],
        evidence: [], synthetic: false, placement: 'unknown', classification: 'test_only',
        canonicalLevelSchedules: [structuredClone(retainedTower.levelSchedule)],
      } });
  }
  private result(rows: any[] = []) { return { rows, rowCount: rows.length }; }
  private reads(q: string, values: any[]) {
    if (q.startsWith('SELECT * FROM registry_records')) return this.result(this.rows.filter(row => row.id === values[0]));
    if (q.startsWith('SELECT pin FROM import_packages')) return this.result(this.sourceAttached ? [{ pin: unitSource }] : []);
    if (q.startsWith('SELECT body FROM registry_records')) return this.result(this.rows.filter(row => row.kind === 'floor'
      && row.body.name === values[2] && row.body.sourceOnly.evidence.sourceId === values[3]));
    if (q.startsWith('SELECT id FROM registry_records')) return this.result(this.rows.filter(row => row.kind === 'space'
      && row.body.name === values[1] && row.body.links[0].targetId === JSON.parse(values[2])[0].targetId));
    if (q.includes('MAX(ordinal)')) return this.result([{ ordinal: this.rows.filter(row => row.kind === values[1]).length + 1 }]);
    if (q.startsWith('SELECT count(*)')) return this.result([{ count: this.rows.filter(row => row.kind === values[1]
      && row.body.links[0]?.targetId === JSON.parse(values[2])[0].targetId).length }]);
    if (q.startsWith('SELECT revision FROM registry_sites')) return this.result([{ revision: this.siteRevision }]);
    if (q.startsWith('SELECT * FROM physical_features')) return this.result([structuredClone(this.feature)]);
    if (q.startsWith('SELECT package_id')) return this.result([{ package_id: importReceipt.id }]);
    if (q.startsWith('SELECT id FROM') || q.startsWith('SELECT pg_advisory')) return this.result();
    throw new Error(`Unimplemented protocol read: ${q}`);
  }
  private writes(q: string, v: any[]) {
    if (q.startsWith('INSERT INTO registry_records')) {
      this.rows.push({ id: v[0], site_id: v[1], kind: v[2], ordinal: v[3], identifier: v[4], revision: 1, body: v[5] });
    } else if (q.startsWith('INSERT INTO registry_links')) this.links.push(v);
    else if (q.startsWith('INSERT INTO registry_revisions')) {
      this.histories.push(q.includes('VALUES($1,1,') ? { id: v[0], revision: 1, body: v[1], site: v[2] }
        : { id: v[0], revision: v[1], body: v[2], site: v[3] });
    } else if (q.startsWith('UPDATE registry_sites')) return this.result([{ revision: ++this.siteRevision }]);
    else if (q.startsWith('UPDATE map_areas')) return this.result([{ revision: ++this.areaRevision }]);
    else if (q.startsWith('UPDATE registry_records')) {
      const row = this.rows.find(row => row.id === v[0]);
      row.revision = v[1];
      row.body = v[2];
      this.building.revisionId = fingerprint({ previous: this.building.revisionId, revision: v[1] });
    } else if (q.startsWith('UPDATE physical_features')) {
      this.feature.revision = v[1];
      this.feature.body = v[2];
    } else if (!q.startsWith('INSERT INTO physical_feature_revisions')) throw new Error(`Unimplemented write: ${q}`);
    return this.result();
  }
  async query(sql: string, values: any[] = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    this.queries.push(q);
    if (/^(INSERT|UPDATE)/.test(q)) return this.writes(q, values);
    return this.reads(q, values);
  }
  readonly deps: NonNullable<Parameters<typeof commandSourceSpace>[2]> = {
    transaction: (async (work: (client: PoolClient) => Promise<unknown>) => {
      const saved = structuredClone({ rows: this.rows, histories: this.histories, links: this.links,
        siteRevision: this.siteRevision, areaRevision: this.areaRevision, feature: this.feature, building: this.building });
      try { return await work({ query: this.query.bind(this) } as unknown as PoolClient); }
      catch (error) { Object.assign(this, saved); throw error; }
    }) as typeof transaction,
    building: async () => structuredClone(this.building),
    original: (async () => ({ revision: this.sourceRevision, sha256: unitSource.sourceSha256 })) as any,
    pages: async (sourceId, raw: any) => ({ version: 'document-pages/1', sourceId,
      caseId: '3585291b-eeb3-42e3-b6a0-29e847114e27', caseRevision: 1, sourceRevision: this.sourceRevision,
      sourceSha256: unitSource.sourceSha256, sourceBytes: 1655334, name: 'Retained Tower 3 plan1', revision: '1',
      pageCount: this.pageCount, offset: Number(raw.offset), limit: 1, hasMore: false, anchors: [],
      pages: this.pageCount > Number(raw.offset) ? [{ page: Number(raw.offset) + 1, label: 'Page 1', sourceLabel: null,
        frame: { kind: 'pdf_display_page_top_left_points', rotation: 0, width: 2586, height: 1695 },
        mediaBox: [0, 0, 2586, 1695], cropBox: [0, 0, 2586, 1695], boxConvention: 'pymupdf_page_rectangles/1',
        renderSupport: 'supported', url: null, locator: { kind: 'pdf_page', page: 1 }, calibration: null }] : [],
    }),
  };
}
