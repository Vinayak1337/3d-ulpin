import { migrate, closePool } from "@ulpin/server/infrastructure/db";
import { ensureBucket, closeStorageClient } from "@ulpin/server/infrastructure/storage";
try {
  await migrate();
  await ensureBucket();
  console.log("Database schema and private source bucket are ready.");
} finally {
  try { await closePool(); }
  finally { closeStorageClient(); }
}
