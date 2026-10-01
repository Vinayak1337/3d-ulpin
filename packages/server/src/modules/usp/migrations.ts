import { sql } from '../../infrastructure/sql-loader';
import { transaction } from '../../infrastructure/db';
import { migrateUspGeometryTx } from './geometry-migration';
import { migrateManualIngestionTx, migrateLargeOriginalTx, migrateIngestionEventsTx, migrateProjectedVectorTx, migratePrivateMvtTx, migrateSemanticChunksTx, migrateSufficiencyTx, migrateStreamingVectorTx, migrateChunkMappingTx, migrateStreamedProfileTx } from './ingestion/migration';

/** Additive metadata beside the existing registry/source/job authorities. */
export async function migrateUsp() {
  await transaction(async client => {
    await client.query(sql('usp.lock'));
    await client.query(sql('usp.ledger'));
    const name = 'usp_f1_min_001';
    if (!(await client.query(sql('usp.f1.check'), [name])).rowCount) {
      await client.query(sql('usp.f1.schema'));
      await client.query(sql('usp.f1.mark'), [name]);
    }
    const identityName = 'usp_identity_001';
    if (!(await client.query(sql('usp.identity.check'), [identityName])).rowCount) {
      await client.query(sql('usp.identity.schema'));
      await client.query(sql('usp.identity.mark'), [identityName]);
    }
    await migrateUspGeometryTx(client);
    const declarationsName = 'usp_declarations_001';
    if (!(await client.query(sql('usp.declarations.check'), [declarationsName])).rowCount) {
      await client.query(sql('usp.declarations.schema'));
      await client.query(sql('usp.declarations.mark'), [declarationsName]);
    }
    await migrateManualIngestionTx(client);
    await migrateLargeOriginalTx(client);
    await migrateIngestionEventsTx(client);
    await migrateProjectedVectorTx(client);
    await migratePrivateMvtTx(client);
    await migrateSemanticChunksTx(client);
    await migrateSufficiencyTx(client);
    await migrateStreamingVectorTx(client);
    await migrateChunkMappingTx(client);
    await migrateStreamedProfileTx(client);
    const packetPlansName = 'usp_packet_plans_001';
    if (!(await client.query(sql('usp.packet-plans.check'), [packetPlansName])).rowCount) {
      await client.query(sql('usp.packet-plans.schema'));
      await client.query(sql('usp.packet-plans.mark'), [packetPlansName]);
    }
  });
}
