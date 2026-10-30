import { dispatchHeldOperations, dispatchTick, dispatchWakeVersion, waitForDispatch }
  from "@ulpin/server/modules/cases/processing";
import { startStallLog } from "@ulpin/server/modules/cases/dispatch-stall";
import { closePool, useDispatcherPool } from "@ulpin/server/infrastructure/db";
import { dispatchPoolSize } from "@ulpin/server/modules/cases/dispatch-lanes";
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
  useDispatcherPool(dispatchPoolSize());
  try { localOperatorSubject(); }
  catch {
    console.error("Set a valid ULPIN_LOCAL_OPERATOR_SUBJECT before starting the dispatcher; no jobs were dispatched.");
    process.exitCode = 1;
    return;
  }
  console.log("Application job dispatcher running.");
  const stopStallLog = startStallLog(dispatchHeldOperations);
  let reportedError = false;
  try {
    while (!stopping) {
      const wake = dispatchWakeVersion();
      try {
        await dispatchTick();
        reportedError = false;
      } catch (error) {
        if (!reportedError) {
          const own = typeof error === "object" && error !== null && Object.hasOwn(error, "code")
            ? Reflect.get(error, "code") : undefined;
          let code = error instanceof Error ? error.name : "unknown";
          if (typeof own === "string" && /^[A-Z0-9_]{1,40}$/.test(own)) code = own;
          console.error(`Dispatcher tick failed with error code ${code}.`);
        }
        reportedError = true;
      }
      await waitForDispatch(wake);
    }
  } finally {
    stopStallLog();
    try { await closePool(); }
    finally { closeStorageClient(); }
  }
}
run().catch(() => {
  console.error("Dispatcher stopped unexpectedly.");
  process.exitCode = 1;
});
