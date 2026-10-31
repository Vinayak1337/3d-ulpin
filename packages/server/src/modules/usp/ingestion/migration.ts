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
  await migrateStreamingLinesLimitTx(client);
}
export async function migrateChunkMappingTx(client:PoolClient){
  await client.query(sql('ingestion.chunk-mapping.schema'));
}
export async function migrateStreamedProfileTx(client:PoolClient){
  await client.query(sql('ingestion.streamed-profile.schema'));
}
/** After the raw, mapping and profile tables exist: their part-count checks follow the reader's ceiling. */
export async function migrateStreamingCapacityTx(client:PoolClient){
  await client.query(sql('ingestion.streaming-vector.capacity'));
}

async function migrateStreamingLinesLimitTx(client:PoolClient){
  await client.query(sql('ingestion.streaming-vector.lines-limit'));
}
