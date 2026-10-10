# Pinned demo runtime

The demo API and dispatcher run from `E:/Projects/ulpin-wt/demo`, a detached, unedited checkout.
Current reviewed staging commit: `4d03be3f` (10 October 2026).
Loopback API: `http://127.0.0.1:3194`; external demo configuration stays outside every checkout.
Only the runtime owner explicitly named in a task file may roll this checkout forward.
Worker worktrees must never serve the demo: lazy imports would mix unreviewed changes into running processes.

## Roll-out (no fetch)
1. Confirm exclusive runtime ownership; notify any worker reading the API and keep downtime short.
2. From the demo checkout, stop only the two recorded native processes:
   `node --input-type=module -e "import('./scripts/platform/processes.mjs').then(m=>m.stopProcesses())"`
3. Select an already-present, lead-reviewed staging commit:
   `git -C E:/Projects/ulpin-wt/demo checkout --detach <commit>`
4. If `pnpm-lock.yaml` changed, run `pnpm install --frozen-lockfile` from that checkout.
5. Start both native processes from that checkout:
   `pnpm platform:start --profile demo`
6. Run `pnpm platform:doctor --profile demo` there. Record both process entry paths, PIDs and the served commit.
7. Prove one existing job authority is dispatched automatically; retain API and SSE receipts outside Git.

Never edit application files in the demo checkout, copy/read credentials, use `--create`, reset/reseed,
stop or replace containers, remove volumes, fetch unreviewed code, or use `down -v`.
The platform start command resumes the existing project only; populated storage and external credentials remain intact.
If doctor fails, preserve the runtime and diagnose its specific failure; do not initialise replacement storage.
Code changes merge on staging first, then roll here in a separately authorised runtime task.
