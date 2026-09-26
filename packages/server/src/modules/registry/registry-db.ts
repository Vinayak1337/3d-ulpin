import { sql } from "../../infrastructure/sql-loader";
import { query } from "../../infrastructure/db";
export async function migrateRegistry() {
  await query(sql('registry.schema'));
}
