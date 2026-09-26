import { sql } from "../../infrastructure/sql-loader";
import { query } from "../../infrastructure/db";

/** Application-owned receipts; the private inference worker has no database access. */
export async function migrateSpatialMl() {
  await query(sql('spatial-ml.schema'));
}
