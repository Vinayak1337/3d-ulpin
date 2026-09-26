import type { PoolClient } from 'pg';
import { sql } from '../../../infrastructure/sql-loader';

export async function migrateManualIngestionTx(client: PoolClient) {
  await client.query(sql('ingestion.manual.schema'));
}
