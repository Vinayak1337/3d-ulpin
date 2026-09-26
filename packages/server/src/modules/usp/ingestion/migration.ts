import type { PoolClient } from 'pg';
import { sql } from '../../../infrastructure/sql-loader';

export async function migrateManualIngestionTx(client: PoolClient) {
  await client.query(sql('ingestion.manual.schema'));
}

export async function migrateLargeOriginalTx(client: PoolClient) {
  await client.query(sql('ingestion.large.schema'));
}

export async function migrateIngestionEventsTx(client: PoolClient) {
  await client.query(sql('ingestion.events.index'));
}

export async function migrateProjectedVectorTx(client:PoolClient){
  await client.query(sql('ingestion.projected.schema'));
}

export async function migratePrivateMvtTx(client:PoolClient){
  await client.query(sql('ingestion.mvt.schema'));
}
