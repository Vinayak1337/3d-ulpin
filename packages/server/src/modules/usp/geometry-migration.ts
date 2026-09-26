import { sql } from '../../infrastructure/sql-loader';
import type { PoolClient } from 'pg';

/** Additive annotations reference the canonical authority; no geometry is copied here. */
export async function migrateUspGeometryTx(client: PoolClient) {
  const name = 'usp_geometry_separation_001';
  if ((await client.query(sql('usp.geometry.check'), [name])).rowCount) return;
  await client.query(sql('usp.geometry.schema'));
  await client.query(sql('usp.geometry.mark'), [name]);
}
