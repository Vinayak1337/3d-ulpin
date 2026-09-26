import { dispatchTick } from "@ulpin/server/modules/cases/processing";
import { closePool } from "@ulpin/server/infrastructure/db";
import { closeStorageClient } from "@ulpin/server/infrastructure/storage";

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
async function run() {
  console.log("Application job dispatcher running.");
  let reportedError = false;
  try {
    while (!stopping) {
      try {
        await dispatchTick();
        reportedError = false;
      } catch {
        if (!reportedError)
          console.error(
            "Dispatcher cannot reach the application database. Start the platform and run db:migrate.",
          );
        reportedError = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  } finally {
    try { await closePool(); }
    finally { closeStorageClient(); }
  }
}
run().catch(() => {
  console.error("Dispatcher stopped unexpectedly.");
  process.exitCode = 1;
});
