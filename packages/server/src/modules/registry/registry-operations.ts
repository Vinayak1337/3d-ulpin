import { randomUUID } from 'node:crypto';
import type { RegistryRight } from '@ulpin/contracts';
import { query } from '../../infrastructure/db';
import { legacyUrl } from '../../shared/legacy-url';
import { caseFrom } from '../cases/domain';
import { listSites, resolveRecord, siteDetail } from './registry';

/** Case choices are scoped to the selected site and retain previously attached cases. */
export async function siteImportOptions(siteId: string) {
  await siteDetail(siteId);
  const rows = await query(
    'SELECT c.* FROM cases c WHERE NOT c.archived OR (c.site_id=$1 AND NOT EXISTS(SELECT 1 FROM registry_drafts d WHERE d.case_id=c.id) AND NOT EXISTS(SELECT 1 FROM registry_sites s WHERE s.seed_case_id=c.id)) ORDER BY c.updated_at DESC',
    [siteId],
  );
  return rows.rows.map(caseFrom);
}

export async function createSiteWorkspace(siteId: string) {
  const detail = await siteDetail(siteId);
  const id = randomUUID();
  await query(
    'INSERT INTO cases(id,name,description,frame,site_id,archived) VALUES($1,$2,$3,$4,$5,true)',
    [id, `Preparation · ${detail.site.name}`, 'Explicit site source preparation', detail.site.frame, siteId],
  );
  return { id };
}

/** Preserve saved application identifiers and legacy workspace URLs. */
export async function resolveRegistryIdentifier(identifier: string) {
  const sites = await listSites();
  const site = sites.find((candidate) => candidate.identifier === identifier || candidate.id === identifier);
  if (site) return { kind: 'site' as const, site };
  const legacy = (await query('SELECT * FROM registry_aliases WHERE alias=$1', [identifier])).rows[0];
  if (legacy && !legacy.record_id) {
    return {
      kind: 'legacy_workspace' as const,
      siteId: legacy.site_id as string,
      workspaceId: legacy.workspace_id as string,
      meaning: legacy.meaning as string,
      url: legacyUrl(`/?case=${legacy.workspace_id}`),
    };
  }
  return {
    kind: 'record' as const,
    ...await resolveRecord(identifier),
    ...(legacy ? { aliasMeaning: legacy.meaning as string } : {}),
  };
}

export async function searchRegistry(search: string, siteId?: string) {
  const rows = await query(
    `SELECT id,identifier,site_id,body->>'alias' AS alias,body->>'name' AS name FROM registry_records WHERE revision>0 AND ($1::uuid IS NULL OR site_id=$1) AND (identifier ILIKE $2 OR body->>'alias' ILIKE $2 OR body->>'name' ILIKE $2 OR (body->'rights')::text ILIKE $2) ORDER BY identifier LIMIT 100`,
    [siteId ?? null, `%${search.slice(0, 150)}%`],
  );
  return rows.rows as { id: string; identifier: string; site_id: string; alias: string; name: string }[];
}

export async function exportRegistryRecord(identifier: string): Promise<Response> {
  const result = await resolveRecord(identifier);
  const detail = await siteDetail(result.site.id);
  const referenced = new Set<string>();
  for (const record of [result.record, ...result.history.map((history) => history.body)]) {
    for (const binding of [
      ...record.evidence,
      ...record.rights.map((right: RegistryRight) => right.evidence),
      ...Object.values(record.geometry?.bindings ?? {}),
    ]) {
      if (binding && typeof binding === 'object' && 'sourceId' in binding) referenced.add(String(binding.sourceId));
    }
  }
  const provenance = {
    sources: detail.sources.filter((source) => referenced.has(source.id)),
    note: 'Original source revisions are immutable. Locators are recorded references; geometry does not establish rights.',
  };
  return new Response(JSON.stringify({
    schema: '3d-ulpin-registry-v1',
    ...result,
    record: legacyExportBody(result.record),
    history: result.history.map(history => ({ ...history, body: legacyExportBody(history.body) })),
    provenance,
    classification: result.record.synthetic ? 'synthetic' : 'unknown',
    classificationBasis: result.record.synthetic ? 'recorded' : 'unavailable',
    limitations: [
      'Prototype identity; technical review does not confer ownership.',
      'Coordinates are local metres in the declared frame.',
    ],
  }, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${result.record.identifier}.json"`,
    },
  });
}

function legacyExportBody<T extends { registryMetadata?: unknown }>(body: T): Omit<T, 'registryMetadata'> {
  const { registryMetadata: _privateFacts, ...legacy } = body;
  return legacy;
}
