import type { PoolClient } from 'pg';
import { sql } from '../../../infrastructure/sql-loader';

/** Invoke only from the existing USP migration transaction, never from an intake request. */
export async function migrateIntakeLedgerTx(client: PoolClient) {
  await client.query(sql('ingestion.intake.schema'));
  await client.query(sql('ingestion.intake.targets'));
  await client.query(sql('ingestion.table.windows'));
}
