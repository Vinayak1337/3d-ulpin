import { pool, query } from "../apps/web/lib/server/db";

// Explicit IDs only: never infer that a similarly named user workspace is a test.
const args = process.argv.slice(2);
const restore = args[0] === "--restore";
const ids = restore ? args.slice(1) : args;
try {
  if (!ids.length || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    throw new Error("Usage: pnpm exec tsx scripts/archive-workspaces.ts [--restore] <case UUID> ...");
  const result = await query(
    "UPDATE cases SET archived=$1 WHERE id=ANY($2::uuid[]) RETURNING id",
    [!restore, ids],
  );
  console.log(`${restore ? "Restored" : "Archived"} ${result.rowCount} workspaces. Sources, geometry, identities and history are preserved.`);
} finally {
  await pool().end();
}
