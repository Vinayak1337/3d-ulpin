import { migrate, pool } from "../apps/web/lib/server/db";
import { ensureBucket } from "../apps/web/lib/server/storage";
try {
  await migrate();
  await ensureBucket();
  console.log("Database schema and private source bucket are ready.");
} finally {
  await pool().end();
}
