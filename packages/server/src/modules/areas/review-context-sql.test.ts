import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./areas.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function sql(name: string): string {
  const value = source.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'))![1];
  return value.replace(/\$\{(\w+)\}/g, (_, nested) => sql(nested));
}

test('context rows and counts share one materialized spatial selector', () => {
  assert.equal(source.split('${packageSpatialContextSql}').length - 1, 1);
  assert.match(sql('packageContextSql'), /scoped AS MATERIALIZED/);
  assert.match(sql('packageContextSql'), /LEFT JOIN context c ON true/);
  const migration = readFileSync('database/sql/20-area/review-context-indexes.sql', 'utf8');
  assert.equal(migration.match(/USING gist\((?:geographic_)?geometry\) WHERE revision > 0/g)?.length, 2);
});

// Optional real PostGIS execution: CTE controls only, no DDL or row changes, never the demo database.
test('shared selector equals the separate context rows and count, including empty context', {
  skip: !process.env.S13AL_POSTGIS_CONTAINER,
}, () => {
  assert.equal(process.env.S13AL_POSTGIS_CONTAINER, 'ulpin-reh-03-postgres-1');
  const pkg = JSON.parse(readFileSync('docs/evidence/gf-backend/k1/nyc-import.json', 'utf8'));
  const literal = (value: unknown): string => {
    if (value === null) return 'NULL';
    if (Array.isArray(value)) return `ARRAY[${value.map(literal).join(',')}]::uuid[]`;
    return typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` : String(value);
  };
  const controls = `physical_features AS (
    SELECT (body->>'id')::uuid id, CASE WHEN n%2=0 THEN '${pkg.id}' ELSE '${pkg.areaId}' END::uuid area_id,
      CASE WHEN n=6 THEN 0 ELSE 1 END revision, body,
      ST_SetSRID(ST_GeomFromGeoJSON((body->'geometry')::text),0) geometry,
      ST_SetSRID(ST_GeomFromGeoJSON((body->'geographicGeometry')::text),4326) geographic_geometry
    FROM jsonb_array_elements(${literal(JSON.stringify(pkg.features.slice(0, 6)))}::jsonb)
      WITH ORDINALITY f(body,n)),
    usp_analytic_geometry AS (SELECT 'area_feature'::text namespace,id,revision,1 qualification_revision,
      '{}'::jsonb metadata FROM physical_features WHERE id IN ('${pkg.features[1].id}','${pkg.features[2].id}')),
    property_associations AS (SELECT '${pkg.features[0].id}'::uuid from_id,'${pkg.features[2].id}'::uuid to_id,
      'occupies_parcel'::text relationship,'confirmed'::text status),
    block_groups AS (SELECT '${pkg.id}'::uuid id,'${pkg.areaId}'::uuid area_id),
    block_group_memberships AS (SELECT '${pkg.id}'::uuid group_id,'${pkg.features[1].id}'::uuid feature_id)`;
  const combined = sql('packageContextSql');
  const [selectors, context] = combined.split('), context AS (');
  const selected = selectors.slice(selectors.indexOf('), selected AS MATERIALIZED (') + 3)
    .replace('SELECT id FROM scoped', sql('packageSpatialContextSql'));
  const legacy = `${sql('packageReviewBoundsSql')}, ${selected})`
    + context.slice(0, context.indexOf('\n)\nSELECT c.body')).replace('SELECT f.id,f.body', 'SELECT f.body');
  const count = `${sql('packageReviewBoundsSql')}, scoped AS (${sql('packageSpatialContextSql')}) `
    + sql('unqualifiedContextCountSql').replace(' OFFSET 0', '');
  const reference = pkg.features[0].sourceReference;
  for (const qualified of [true, false]) for (const geographic of [true, false]) for (const empty of [true, false]) {
    const parameters = [pkg.areaId, ...pkg.extent.map((v: number, i: number) => v + (i < 2 ? -255 : 255)),
      ...pkg.geographicExtent, geographic ? 32618 : null,
      ...(geographic ? reference.origin : [null, null]), [pkg.features[0].id], geographic];
    const bind = (query: string) => query.replace(/\$(\d+)\b/g, (_, index) => literal(parameters[Number(index) - 1]));
    const scoped = (query: string) => bind(query.replace('WITH bounds', `WITH ${controls}, bounds`))
      .replaceAll("id IN ('", qualified ? "id IN ('" : "false AND id IN ('")
      .replaceAll('FROM selected s', empty ? 'FROM selected s JOIN (SELECT 1 WHERE false) none ON true'
        : 'FROM selected s');
    const aggregate = (query: string) => `SELECT coalesce(jsonb_agg(to_jsonb(r)-'unqualified_count'
      ORDER BY r.body->>'id') FILTER (WHERE r.body IS NOT NULL),'[]'::jsonb) FROM (${scoped(query)}) r`;
    const statement = `SELECT json_build_array((${aggregate(legacy)}),(${aggregate(combined)}),
      (SELECT unqualified_count FROM (${scoped(count)}) n),
      (SELECT max(unqualified_count) FROM (${scoped(combined)}) n));`;
    const result = JSON.parse(execFileSync('docker', ['exec', '-i', '-e',
      'PGOPTIONS=-c default_transaction_read_only=on', 'ulpin-reh-03-postgres-1', 'sh', '-c',
      'psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
    { input: statement, encoding: 'utf8' }).trim());
    assert.deepEqual(result[0], result[1]);
    assert.equal(result[2], result[3]);
    if (qualified && !empty) assert(result[0].length > 0, 'equality includes nonempty qualified context');
    if (!qualified) assert(result[2] > 0, 'equality includes nonzero unqualified counts');
  }
});
