import { sql } from "../../infrastructure/sql-loader";
import { query } from "../../infrastructure/db";
export async function migrateOfficer() {
  await query(sql('officer.schema'));
}
