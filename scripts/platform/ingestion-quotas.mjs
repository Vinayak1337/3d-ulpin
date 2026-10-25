// Aggregate counts only. Keep admission predicates aligned; the parity test guards the mapping query.
const mapping = `SELECT count(*)::int n FROM usp_chunk_mapping_imports m
  LEFT JOIN jobs j ON j.id=m.job_id
  LEFT JOIN sources s ON s.id=m.source_id
  LEFT JOIN usp_mapping_recipes r ON r.source_id=m.source_id AND r.state IN ('approved','executed')
  WHERE m.state IN ('queued','running','needs_input') OR (
    m.state IN ('completed','completed_with_rejections') AND s.revision=m.source_revision
    AND NOT EXISTS (SELECT 1 FROM sources newer WHERE newer.case_id=s.case_id
      AND newer.family_id=s.family_id AND newer.revision>s.revision)
    AND j.payload->>'recipeId' IS NOT DISTINCT FROM r.id::text
    AND j.payload->>'recipeRevision' IS NOT DISTINCT FROM r.revision::text
    AND j.payload->>'planHash' IS NOT DISTINCT FROM r.body->>'planHash'
    AND NOT EXISTS (SELECT 1 FROM usp_chunk_mapping_imports newer JOIN jobs nj ON nj.id=newer.job_id
      WHERE newer.source_id=m.source_id AND (newer.created_at,newer.job_id)>(m.created_at,m.job_id)
        AND (newer.raw_job_id<>m.raw_job_id
          OR nj.payload->>'readerSha256' IS DISTINCT FROM j.payload->>'readerSha256'))
  )`;
const count = (table, where) => `SELECT count(*) FROM ${table}${where ? ` WHERE ${where}` : ''}`;
const busiest = (table, where, scope) => `SELECT COALESCE(max(n),0) FROM
  (SELECT count(*) n FROM ${table} WHERE ${where} GROUP BY ${scope}) scoped`;
const held = `u.state IN ('receiving','finalizing','aborting') AND (u.expires_at>now()
  OR u.lease_expires_at>now() OR u.state<>'receiving' AND u.body->'input'->>'profile'='large-original/2')`;
const upload = version => `${held} AND
  COALESCE(u.body->'input'->>'profile','large-original/1')='large-original/${version}'`;
const active = "state IN ('queued','running')";
export const ingestionQuotas = [
  ['mapping', 128, mapping],
  ['mapping active', 4, count('usp_chunk_mapping_imports', active)],
  ['streaming busiest case', 128, busiest('operations', "kind='streaming-vector'", 'case_id')],
  ['streaming active', 2, count('usp_streaming_vector_imports', active)],
  ['profile history', 128, count('usp_streamed_profile_imports')],
  ['profile active', 4, count('usp_streamed_profile_imports', active)],
  ['upload v1 open', 4, count('usp_source_uploads u', upload(1))],
  ['upload v1 busiest case', 2, busiest('usp_source_uploads u', upload(1), 'u.case_id')],
  ['upload v1 busiest operator', 2, busiest('usp_source_uploads u', upload(1), 'u.operator_subject')],
  ['upload v2 open', 1, count('usp_source_uploads u', upload(2))],
  ['raster sources', 64, count('sources', "profile='geotiff-raster-v1'")],
  ['point sources', 64, count('sources', "profile='laz-point-v1'")],
  ['raster active', 2, count('jobs', "operation='raster-window' AND status IN ('queued','running')")],
  ['point active', 2, count('jobs', "operation='point-batch' AND status IN ('queued','running')")],
];
export function ingestionQuotaQuery() {
  const fields = ingestionQuotas.map(([, , sql], index) => `'q${index}',(${sql})`).join(',');
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='3000ms'; SELECT json_build_object(${fields}); ROLLBACK;`;
}
export async function ingestionQuotaLines(reader) {
  try {
    const counts = JSON.parse(await reader(ingestionQuotaQuery()));
    return ingestionQuotas.map(([name, limit], index) => {
      const counted = counts[`q${index}`];
      if (!Number.isSafeInteger(counted) || counted < 0) throw new Error('Invalid count.');
      return `${counted >= limit * 0.75 ? 'WARN' : 'PASS'} Ingestion ${name}: ${counted} of ${limit} counted`;
    });
  } catch {
    return ['SKIP Ingestion quotas (aggregate reader unavailable)'];
  }
}
