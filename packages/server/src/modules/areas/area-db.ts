import { sql } from "../../infrastructure/sql-loader";
import { query } from "../../infrastructure/db";

/** Additive canonical v2 storage. Existing registry geometry/history is untouched. */
export async function migrateAreas() {
  await query(sql('area.schema'));
}
