# RUN-RECOVER-01 — bounded Docker recovery stopped at runtime-path blocker

**Engine remains unavailable.** One documented reversible directory-preservation attempt partially completed; no Docker Desktop startup was attempted after its empty-directory precondition failed. Worktree `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, branch `task/desktop-docker-recovery`, base `3b2523fcb9bb41ac2769526eb59fdb77c860bab6`. Staging remained read-only; the completed image-ZIP branch/checkpoint is preserved.

Read [the documented recovery](../../DESKTOP_SETUP.md#docker-desktop-stale-windows-socket-recovery), the September30 recovery receipts and the October1 reference-review blocker. Corrected read-only probes at **15:42 UTC, 3 October** found client29.8.0, missing `dockerDesktopLinuxEngine` pipe, `docker-desktop` WSL stopped and zero Docker/backend processes. Both exact runtime directories were ordinary directories owned by the current operator. Contents were only zero-byte Archive/ReparsePoint entries: the four known Docker sockets, two corresponding `.stale` names, and the separate `engine.sock`. Paths and timestamped sibling destinations were checked before native PowerShell moves.

## Preserved state and exact failure

At **15:44:36 UTC**, `Move-Item` preserved:

- `C:/Users/kvina/AppData/Local/Docker/run.saved-run-recover01-20261003-154436`: all six prior socket entries, with matching recorded metadata. Original `Docker/run` was recreated and remains empty.
- `C:/Users/kvina/AppData/Local/docker-secrets-engine.saved-run-recover01-20261003-154436`: the prior September30 zero-byte `engine.sock`.

The second `New-Item -ItemType Directory` failed, exit1: **“An item with the specified name C:\Users\kvina\AppData\Local\docker-secrets-engine already exists.”** Post-action inspection finds that original path still present with an `engine.sock` dated **2 October**, while the preserved directory contains the **30 September** socket. No Docker process was present. The cause of this directory transition remains unexplained. The documented empty-path condition therefore failed; no second move, deletion, alternate API, reset or startup followed.

Final bounded `docker --context desktop-linux` version/info/ps/volume queries each exited1 because the Linux engine pipe is absent. WSL list exited0, `docker-desktop` stopped; Docker process count0. Current container/volume identities and contents are **unobserved**. Seven older backup directories retain their recorded creation/last-write metadata; September30 receipts still record12 volumes including prefix PostgreSQL/MinIO/Redis, solely as historical observations.

An initial probe helper used PowerShell's automatic `args` variable and dropped its arguments. Bare `docker` printed usage; bare `wsl` timed out after12 seconds. Only that identity-checked owned WSL client, PID34412, was terminated. The corrected explicit-argument probes above completed; both failed-probe receipts remain. No WSL shutdown/reset was performed. October1's automatic approval rejection concerned individual socket deletion, with only “blocked by policy”; that action was never retried here.

## Receipt and handoff

Private `E:/BhuAayam-data/task-data/docker-recovery-20261003-run01/verification.json`: **21,320 bytes**, SHA **`97a2e4d457917c2ce5c9ee3338093512cfafafaeb8f591adeae7a32f81bc0b66`**. It pins actual commands/exits, both new backups, pre/post metadata, preserved older backups and unchanged historical receipts. Fresh proof ACL is limited to the operator, Administrators and SYSTEM. `git diff --cached --check` passes; only this handoff is committed.

All owned probe clients have exited; no backend was launched or stopped. No project services, application tests, migrations/ingestion, disk/volume operations, credentials/config changes, learner/GPU/model/provider work, broad ACL changes, push or deployment. Engine recovery and application/runtime/GF qualification remain open. Requested Sol6.1/high/default-standard; actual model/effort/tier unexposed, supplied `never`/`danger-full-access`. Runtime ownership returns to the lead by the authorized callback; stop without polling or schedules.
