import { sql } from "../../infrastructure/sql-loader";
import { query } from "../../infrastructure/db";

/** Application-owned receipts; the private inference worker has no database access. */
export async function migrateSpatialMl() {
  await query(sql('spatial-ml.schema'));
  await query(sql('spatial-ml.source-batches'));
  await query(sql('spatial-ml.reject-only-footprints'));
}
