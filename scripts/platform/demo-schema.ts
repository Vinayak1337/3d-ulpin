// Invoke existing additive schema producers normally initialized lazily.
// No fixtures, imports, gateway calls, proposals or registry writes.
import { ensureSpatialDatasets } from '@ulpin/server/modules/spatial/spatial-dataset-db';
import { ensureDatasetMl } from '@ulpin/server/modules/datasets/dataset-ml-db';
import { migrateModelGateway } from '@ulpin/server/modules/model-gateway/runtime';
import { closePool } from '@ulpin/server/infrastructure/db';
try {
  await ensureSpatialDatasets();
  await ensureDatasetMl();
  await migrateModelGateway();
  console.log('Additional dataset/model-gateway schemas ready; gateway remains disabled.');
} finally { await closePool(); }
