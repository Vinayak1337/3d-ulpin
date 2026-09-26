import { sql } from "./sql-loader";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { migrateRegistry } from "../modules/registry/registry-db";
import { migrateAreas } from "../modules/areas/area-db";
import { migrateOfficer } from "../modules/officer/officer-db";
import { migrateOfficerAi } from "../modules/ai/officer-ai";
import { migrateSpatialMl } from "../modules/spatial/spatial-ml-db";
import { migrateUsp } from "../modules/usp/migrations";
import { settings } from "./config";
const globals = globalThis as unknown as { ulpinPool?: Pool };
export function pool(): Pool {
  if (!globals.ulpinPool) {
    const connectionPool = new Pool({
      connectionString: settings.databaseUrl,
      max: 8,
      connectionTimeoutMillis: 5000,
    });
    // pg removes a failed idle connection. Handle its event so a database
    // restart does not terminate the web server or the durable job dispatcher.
    connectionPool.on("error", () => {
      console.warn(
        "An idle database connection closed; the pool will reconnect on the next request.",
      );
    });
    globals.ulpinPool = connectionPool;
  }
  return globals.ulpinPool;
}
/** Closes only a pool created by this process; shutdown never opens a connection. */
export async function closePool(): Promise<void> {
  const connectionPool = globals.ulpinPool;
  globals.ulpinPool = undefined;
  if (connectionPool) await connectionPool.end();
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return pool().query<T>(text, values);
}
export async function transaction<T>(
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate() {
  await query(sql('core.schema'));
  await migrateRegistry();
  await migrateAreas();
  await migrateOfficer();
  await migrateOfficerAi();
  await migrateSpatialMl();
  await migrateUsp();
}
