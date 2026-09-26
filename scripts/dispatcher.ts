import { dispatchTick } from "@ulpin/server/modules/cases/processing";
import { closePool } from "@ulpin/server/infrastructure/db";
import { closeStorageClient } from "@ulpin/server/infrastructure/storage";
import { localOperatorSubject } from "@ulpin/server/modules/usp/principal";

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
async function run() {
  try { localOperatorSubject(); }
  catch {
    console.error("Set a valid ULPIN_LOCAL_OPERATOR_SUBJECT before starting the dispatcher; no jobs were dispatched.");
    process.exitCode = 1;
    return;
  }
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
