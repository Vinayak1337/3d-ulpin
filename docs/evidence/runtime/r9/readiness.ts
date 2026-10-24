// R9: the API's structural admission check of the serving checkout given as the argument, in one READ ONLY
// transaction (databaseReadiness()). Prints names and counts only: no connection, target token or row value.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const infrastructure = join(root, 'packages/server/src/infrastructure');
const { databaseReadiness } = await import(pathToFileURL(join(infrastructure, 'database-readiness.ts')).href);
const { closePool } = await import(pathToFileURL(join(infrastructure, 'db.ts')).href);
try {
  const result = await databaseReadiness();
  const { ready, missingRelations, missingColumns, missingMigrations, invalidIndexes } = result.schema;
  console.log(JSON.stringify({ status: result.status, ready, missingRelations, missingColumns, missingMigrations,
    invalidIndexes, unvalidatedConstraints: result.schema.unvalidatedConstraints.length, data: result.data }));
} finally { await closePool(); }
