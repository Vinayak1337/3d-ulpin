import { readFileSync } from 'node:fs';

// Read the dispatcher bound without importing its production TS dependency tree into the plain-Node doctor.
const lanes = readFileSync(new URL('../../packages/server/src/modules/cases/dispatch-lanes.ts', import.meta.url),
  'utf8');
const streamingBounds = { perCase: 16, queued: 64,
  running: Number(lanes.match(/stream: \{ concurrency: (\d+)/)[1]) };
const streamingQueue = `usp_streaming_vector_imports i JOIN jobs j ON j.id=i.job_id`;
const waiting = "i.state='queued' AND j.status='queued'";
// Aggregate counts only. Parity tests guard the per-case profile and mapping admission predicates.
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
const profile = `SELECT count(*)::int n FROM usp_streamed_profile_imports p
  LEFT JOIN jobs j ON j.id=p.job_id
  WHERE p.state IN ('queued','running') OR (
    p.state='sealed' AND NOT EXISTS (
      SELECT 1 FROM usp_streamed_profile_imports newer JOIN jobs nj ON nj.id=newer.job_id
      WHERE newer.source_id=p.source_id AND (newer.created_at,newer.job_id)>(p.created_at,p.job_id)
        AND (newer.raw_job_id<>p.raw_job_id
          OR nj.payload->>'readerSha256' IS DISTINCT FROM j.payload->>'readerSha256'
          OR nj.payload->>'profilerSha256' IS DISTINCT FROM j.payload->>'profilerSha256')
    )
  )`;
const busiestHistory = (sql, alias) => `SELECT COALESCE(max(n),0) FROM
  (${sql} GROUP BY ${alias}.case_id) scoped`;
const count = (table, where) => `SELECT count(*) FROM ${table}${where ? ` WHERE ${where}` : ''}`;
const busiest = (table, where, scope) => `SELECT COALESCE(max(n),0) FROM
  (SELECT count(*) n FROM ${table} WHERE ${where} GROUP BY ${scope}) scoped`;
const held = `u.state IN('receiving','finalizing','aborting') AND (u.expires_at>now() OR u.lease_expires_at>now()
  OR u.state<>'receiving' AND u.body->'input'->>'profile'='large-original/2')
  AND (u.state<>'receiving'
    OR GREATEST(u.created_at,(u.body->>'partActivityAt')::timestamptz)>now()-interval '10 minutes')`;
const upload = version => `${held} AND
  COALESCE(u.body->'input'->>'profile','large-original/1')='large-original/${version}'`;
const active = "state IN ('queued','running')";
export const ingestionQuotas = [
  ['mapping busiest case', 128, busiestHistory(mapping, 'm')],
  ['mapping active', 4, count('usp_chunk_mapping_imports', active)],
  ['streaming busiest case', 128, busiest('operations', "kind='streaming-vector'", 'case_id')],
  ['streaming queued', streamingBounds.queued, count(streamingQueue, waiting)],
  ['profile busiest case', 128, busiestHistory(profile, 'p')],
  ['profile active', 4, count('usp_streamed_profile_imports', active)],
  ['upload v1 open', 4, count('usp_source_uploads u', upload(1))],
  ['upload v1 busiest case', 2, busiest('usp_source_uploads u', upload(1), 'u.case_id')],
  ['upload v1 busiest operator', 2, busiest('usp_source_uploads u', upload(1), 'u.operator_subject')],
  ['upload v2 open', 1, count('usp_source_uploads u', upload(2))],
  ['raster active', 2, count('jobs', "operation='raster-window' AND status IN ('queued','running')")],
  ['point active', 2, count('jobs', "operation='point-batch' AND status IN ('queued','running')")],
];
// Copied from retention-budget.ts and contract limits; parity is checked without a production TS import.
export const retentionQuotas = [
  ['geotiff-raster-v1', 'raster', 64, 256],
  ['laz-point-v1', 'point', 64, 256],
  ['kml-native-v1', 'KML', 64, 256],
  ['citygml-native-v1', 'CityGML', 64, 256],
  ['cityjson-native-v1', 'CityJSON', 64, 128],
  ['dxf-native-v1', 'DXF', 64, 256],
  ['geoparquet-native-v1', 'GeoParquet', 64, 256],
  ['gltf-native-v1', 'glTF', 64, 256],
  ['ifc-native-v1', 'IFC', 64, 256],
  ['obj-native-v1', 'OBJ', 64, 256],
];
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const retentionQuery = ([profile, , sources, mib]) => `SELECT json_build_array(n,b::text) FROM
  (SELECT count(*) n,coalesce(sum(bytes),0) b FROM sources WHERE profile='${profile}' GROUP BY case_id) scoped
  ORDER BY greatest(n::numeric/${sources},b::numeric/${mib * MiB}) DESC,n DESC,b DESC LIMIT 1`;
export function ingestionQuotaQuery() {
  const fields = ingestionQuotas.map(([, , sql], index) => `'q${index}',(${sql})`);
  fields.push(...retentionQuotas.map((quota, i) => `'r${i}',coalesce((${retentionQuery(quota)}),'[0,"0"]'::json)`));
  fields.push(`'streamCase',(${busiest(streamingQueue, waiting, 'i.case_id')})`,
    `'streamRunning',(${count('jobs', "operation='streaming-vector' AND status='running'")})`);
  fields.push("'kept',(SELECT coalesce(sum(bytes),0)::text FROM sources)");
  return "BEGIN READ ONLY; SET LOCAL statement_timeout='3000ms'; "
    + `SELECT json_build_object(${fields.join(',')}); ROLLBACK;`;
}
function bytes(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Invalid bytes.');
  return BigInt(value);
}
const gib = value => (Number(value) / GiB).toFixed(1);
async function storageLine(kept, freeBytesReader) {
  try {
    const free = bytes(String(await freeBytesReader()));
    const warn = free < 20n * BigInt(GiB) || free < kept;
    return `${warn ? 'WARN' : 'PASS'} Storage originals: ${gib(kept)} GiB kept, ${gib(free)} GiB free`;
  } catch {
    return 'SKIP Storage originals (object-storage free bytes unavailable)';
  }
}
export async function ingestionQuotaLines(reader, freeBytesReader) {
  let lines, kept;
  try {
    const counts = JSON.parse(await reader(ingestionQuotaQuery()));
    lines = ingestionQuotas.map(([name, limit], index) => {
      const counted = counts[`q${index}`];
      if (!Number.isSafeInteger(counted) || counted < 0) throw new Error('Invalid count.');
      if (name === 'streaming queued') {
        const { streamCase, streamRunning } = counts;
        if (![streamCase, streamRunning].every(n => Number.isSafeInteger(n) && n >= 0))
          throw new Error('Invalid streaming count.');
        const warn = counted >= limit * 0.75 || streamCase >= streamingBounds.perCase * 0.75
          || streamRunning >= streamingBounds.running * 0.75;
        return `${warn ? 'WARN' : 'PASS'} Ingestion streaming: ${counted} of ${limit} queued, `
          + `${streamCase} of ${streamingBounds.perCase} queued in busiest case, `
          + `${streamRunning} of ${streamingBounds.running} running`;
      }
      return `${counted >= limit * 0.75 ? 'WARN' : 'PASS'} Ingestion ${name}: ${counted} of ${limit} counted`;
    });
    lines.push(...retentionQuotas.map(([, name, limit, mib], i) => {
      const [n, rawBytes] = counts[`r${i}`];
      const kept = bytes(rawBytes);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid count.');
      const warn = n >= limit * 0.75 || kept * 4n >= BigInt(mib * MiB) * 3n;
      return `${warn ? 'WARN' : 'PASS'} Ingestion ${name} busiest case: ${n} of ${limit} sources, `
        + `${(Number(kept) / MiB).toFixed(1)} of ${mib} MiB`;
    }));
    kept = bytes(counts.kept);
  } catch {
    return ['SKIP Ingestion quotas (aggregate reader unavailable)',
      'SKIP Storage originals (aggregate reader unavailable)'];
  }
  return [...lines, await storageLine(kept, freeBytesReader)];
}
