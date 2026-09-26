import { sql } from '../../infrastructure/sql-loader';
import { transaction } from '../../infrastructure/db';
import { migrateUspGeometryTx } from './geometry-migration';
import { migrateManualIngestionTx } from './ingestion/migration';

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
    await migrateManualIngestionTx(client);
  });
}
