import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('packages/server/src/modules/usp/ingestion/intake-targets.ts', 'utf8');
const queries = [...source.matchAll(/client\.query\(`([\s\S]*?)`/g)].map(match => match[1]);
const facts = queries.find(sql => sql.startsWith('WITH packages AS'))!;
const drafted = queries.find(sql => sql.startsWith('SELECT p.id AS package_id,min'))!;
const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const foreignItem = '10000000-0000-4000-8000-000000000003';

// Independent pre-optimization projection: keep JSON equality, committed revision and SQL null semantics.
const oldFacts = `WITH packages AS (
  SELECT p.id,p.body->>'areaId' AS area_id,(p.body->>'revision')::int AS revision,
    p.body->>'state' AS state,CASE WHEN p.body->'review'->'packageRevision'=p.body->'revision'
      OR p.body->>'state'='COMMITTED'
        AND (p.body->'review'->>'packageRevision')::int=(p.body->>'revision')::int-1
      THEN p.body->'review' ELSE NULL END AS review,
    CASE WHEN i.review_refusal_code IS NULL THEN NULL ELSE jsonb_build_object(
      'code',i.review_refusal_code,'message',i.review_refusal_message) END AS review_refusal
  FROM import_packages p LEFT JOIN usp_intake_items i ON i.item_id=ANY($2::uuid[])
    AND i.plan_ref->>'packageId'=p.id::text WHERE p.id=ANY($1::uuid[])
) SELECT id,area_id,revision,state,review_refusal,review->>'inputFingerprint' AS review_fingerprint,
  CASE WHEN review IS NULL THEN NULL ELSE COALESCE((
    SELECT jsonb_object_agg(code,count) FROM (
      SELECT finding->>'code' AS code,count(*)::int AS count
      FROM jsonb_array_elements(review->'findings') AS finding GROUP BY finding->>'code'
    ) AS findings
  ),'{}'::jsonb) END AS finding_counts FROM packages`;
const oldDrafted = `SELECT p.id AS package_id,min(i.item_id::text) AS anchor_item_id
  FROM usp_intake_items i JOIN import_packages p ON p.id::text=i.plan_ref->>'packageId'
    OR EXISTS (SELECT 1 FROM usp_intake_parts part WHERE part.item_id=i.item_id
      AND part.state='published' AND part.result_ref->>'packageId'=p.id::text)
  WHERE i.case_id=$1 GROUP BY p.id ORDER BY p.id`;

async function withDatabase(run: (db: any) => Promise<void>) {
  const { PGlite } = await import(process.env.S13X_PGLITE_MODULE!);
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE import_packages(id uuid PRIMARY KEY,body jsonb);
      CREATE TABLE usp_intake_items(item_id uuid,case_id uuid,plan_ref jsonb,
        review_refusal_code text,review_refusal_message text);
      CREATE TABLE usp_intake_parts(item_id uuid,state text,result_ref jsonb);`);
    await db.query('INSERT INTO import_packages VALUES($1,$2),($3,$2)', [id, {}, other]);
    await db.query(`INSERT INTO usp_intake_items VALUES
      ($1,$1,$3,'REFUSED','Review refused.'),($2,$1,$4,NULL,NULL)`,
    [id, other, { packageId: id }, { packageId: 'not-a-package-id' }]);
    await run(db);
  } finally {
    await db.close();
  }
}

test('target facts preserve the old rows through review, invalidation and commit', {
  skip: !process.env.S13X_PGLITE_MODULE,
}, () => withDatabase(async db => {
  const findings = [{ code: 'BOUNDARY_CONTACT' }, { code: 'BOUNDARY_CONTACT' }, { code: 'UNKNOWN_HEIGHT' }];
  const review = (packageRevision: number | string) => ({ packageRevision,
    inputFingerprint: 'a'.repeat(64), findings });
  for (const body of [
    { areaId: other, revision: 2, state: 'REVIEWED', review: review(2) },
    { areaId: other, revision: 2, state: 'REVIEWED', review: review('2') },
    { areaId: other, revision: 3, state: 'DRAFT', review: review(2) },
    { areaId: other, revision: 3, state: 'COMMITTED', review: review(2) },
    { areaId: other, revision: 3, state: 'COMMITTED', review: review(1) },
    { areaId: other, revision: 2, state: 'REVIEWED', review: { ...review(2), findings: [] } },
    { areaId: other, revision: 2, state: 'DRAFT' },
    { areaId: null, revision: null, state: 'DRAFT', review: null },
  ]) {
    await db.query('UPDATE import_packages SET body=$1', [body]);
    for (const anchors of [[id], [other], [], [id, other]]) {
      const values = [[id, other], anchors];
      const expected = (await db.query(oldFacts, values)).rows;
      const actual = (await db.query(facts, values)).rows;
      const ordered = (rows: any[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
      assert.equal(JSON.stringify(ordered(actual)), JSON.stringify(ordered(expected)));
    }
  }
}));

test('drafted packages preserve anchors, repeated parts, non-published states and case isolation', {
  skip: !process.env.S13X_PGLITE_MODULE,
}, () => withDatabase(async db => {
  // Both sources can name a package; non-published and foreign-case parts do not count.
  await db.query(`INSERT INTO usp_intake_items VALUES($1,$1,$2,NULL,NULL)`, [other, { packageId: other }]);
  await db.query('INSERT INTO usp_intake_items VALUES($1,$2,$3,NULL,NULL)', [foreignItem, other, {}]);
  await db.query("INSERT INTO usp_intake_parts VALUES($1,'published',$2),($3,'published',$4)",
    [foreignItem, { packageId: other }, id, { packageId: 'not-a-package-id' }]);
  for (const state of ['published', 'queued', 'running', 'failed']) {
    await db.query('INSERT INTO usp_intake_parts VALUES($1,$2,$3),($1,$2,$3)',
      [other, state, { packageId: id }]);
    await db.query('INSERT INTO usp_intake_parts VALUES($1,$2,$3)', [id, state, { packageId: other }]);
    for (const caseId of [id, other]) {
      assert.equal(JSON.stringify((await db.query(drafted, [caseId])).rows),
        JSON.stringify((await db.query(oldDrafted, [caseId])).rows));
    }
  }
}));
