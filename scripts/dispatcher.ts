import { dispatchTick } from "../apps/web/lib/server/processing";
import { pool } from "../apps/web/lib/server/db";

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
  await pool().end();
}
run().catch(() => {
  console.error("Dispatcher stopped unexpectedly.");
  process.exitCode = 1;
});
