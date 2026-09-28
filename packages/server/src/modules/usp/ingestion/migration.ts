import type { PoolClient } from 'pg';
import { sql } from '../../../infrastructure/sql-loader';

export async function migrateManualIngestionTx(client: PoolClient) {
  await client.query(sql('ingestion.manual.schema'));
}

export async function migrateLargeOriginalTx(client: PoolClient) {
  await client.query(sql('ingestion.large.schema'));
  await client.query(sql('ingestion.large.capacity'));
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

export async function migrateSemanticChunksTx(client:PoolClient){
  await client.query(sql('ingestion.semantic.schema'));
}
export async function migrateSufficiencyTx(client:PoolClient){
  await client.query(sql('ingestion.sufficiency.schema'));
}
export async function migrateStreamingVectorTx(client:PoolClient){
  await client.query(sql('ingestion.streaming-vector.schema'));
}
