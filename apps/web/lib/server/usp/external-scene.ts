import { z } from 'zod';
import { query } from '../db';
import { readObject, sha256 } from '../storage';
import { localRequest } from '../spatial-core-http';
import { LegacySpatialReadError } from '../spatial-core-read';
import { decodeCityJsonRoof } from '@/features/usp/shared/external-scene';
import type { ExternalSceneResource } from '@/features/usp/shared/external-resource';

const selection = z.object({ areaId: z.uuid(), featureId: z.uuid(),
  revision: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const fail = (status: number, code: string, message: string): never => {
  throw new LegacySpatialReadError(status, code, message);
};

/** Uses existing feature, import and private source authorities, with no new store. */
export async function readExternalScene(input: z.infer<typeof selection>): Promise<ExternalSceneResource> {
  const feature = (await query('SELECT revision,body FROM physical_features WHERE id=$1 AND area_id=$2 AND revision>0',
    [input.featureId, input.areaId])).rows[0];
  if (!feature) fail(404, 'EXTERNAL_TARGET', 'The selected source exterior is unavailable.');
  if (feature.revision !== input.revision || feature.body.properties?.external_cityjson_sha256 !== input.sha256)
    fail(409, 'EXTERNAL_STALE', 'The selected source exterior changed. Reload its area.');
  const nativeId = feature.body.properties.external_cityjson_id;
  if (feature.body.kind !== 'building' || feature.body.worldStatus !== 'observed' ||
      typeof nativeId !== 'string' || nativeId !== feature.body.sourceKey)
    fail(422, 'EXTERNAL_PROFILE', 'This feature has no qualified source exterior binding.');

  const linkedSources = async () => (await query(
    `SELECT DISTINCT s.id,s.revision,s.sha256,s.bytes,s.object_key FROM sources s
      JOIN import_packages p ON p.area_id=$1 AND p.state='COMMITTED'
      JOIN LATERAL jsonb_array_elements(p.body->'parts') part ON part->>'sourceRevisionId'=s.id::text
      WHERE p.body->'features' @> $2::jsonb AND part->'entityIds' ? $3
        AND s.sha256=$4 AND s.profile='text-reference-v2'`,
    [input.areaId, JSON.stringify([{ id: input.featureId }]), input.featureId, input.sha256])).rows;
  const sources = await linkedSources();
  if (sources.length !== 1) fail(422, 'EXTERNAL_SOURCE', 'An exact, unambiguous retained source is required.');
  const source = sources[0];
  if (Number(source.bytes) < 1 || Number(source.bytes) > 1024 * 1024)
    fail(413, 'EXTERNAL_LIMIT', 'The source exceeds the bounded exterior display profile.');
  const bytes = await readObject(source.object_key);
  if (bytes.length !== Number(source.bytes) || sha256(bytes) !== input.sha256)
    fail(503, 'EXTERNAL_INTEGRITY', 'The retained source could not be verified.');
  let scene: ExternalSceneResource['scene'];
  try { scene = decodeCityJsonRoof(JSON.parse(Buffer.from(bytes).toString('utf8')), nativeId); }
  catch { return fail(422, 'EXTERNAL_GEOMETRY', 'This source has unsupported or invalid exterior surfaces. Its original is retained.'); }
  // Do not deliver a source after its target or association changes during storage IO.
  const current = (await query('SELECT revision,body FROM physical_features WHERE id=$1 AND area_id=$2',
    [input.featureId, input.areaId])).rows[0];
  const currentSources = await linkedSources();
  if (!current || current.revision !== feature.revision || JSON.stringify(current.body) !== JSON.stringify(feature.body) ||
      currentSources.length !== 1 || currentSources[0].id !== source.id || currentSources[0].revision !== source.revision)
    fail(409, 'EXTERNAL_STALE', 'The source association changed. Reload its area.');
  return { areaId: input.areaId, featureId: input.featureId, featureRevision: input.revision,
    source: { id: source.id, revision: source.revision, sha256: input.sha256, bytes: bytes.length }, scene };
}

export async function handleExternalScene(request: Request, areaId: string, featureId: string) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    localRequest(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['revision', 'sha256'].includes(key) || params.getAll(key).length !== 1))
      fail(400, 'EXTERNAL_SELECTION', 'Choose one exact source revision.');
    const input = selection.parse({ areaId, featureId, revision: params.get('revision'), sha256: params.get('sha256') });
    return Response.json(await readExternalScene(input), { headers });
  } catch (error) {
    const status = error instanceof LegacySpatialReadError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return Response.json({ error: { code: error instanceof LegacySpatialReadError ? error.code : 'EXTERNAL_UNAVAILABLE',
      message: error instanceof LegacySpatialReadError ? error.message : 'The retained source exterior is unavailable.' } }, { status, headers });
  }
}
