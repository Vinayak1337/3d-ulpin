# Docker guard

After a reboot, a crash or an unclean shutdown, Docker Desktop's backend can die at start with
`rename ...\<name>.sock ... .sock.stale: The file cannot be accessed by the system`, and the dialog offers only
Quit or Reset to factory defaults. **Never press Reset: it deletes every volume, including the demo database.**
The fix is to stop Docker's processes, rename `%LOCALAPPDATA%\Docker\run` and `%LOCALAPPDATA%\docker-secrets-engine`
aside together (one alone fails again) and start Docker Desktop once. `scripts/platform/docker-guard.ps1` does that.

Run it with Windows PowerShell 5.1:
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/platform/docker-guard.ps1 -<Mode>`

| Mode | What it does | Exit |
| --- | --- | --- |
| `-SelfTest` | Read-only Git Bash probe using the demo child's environment. Runs only `bash -c 'echo $BASH_VERSION; uname -s'`; no Docker, pnpm, health requests or ops writes. | 0 MINGW/MSYS, 2 missing or failed shell |
| `-Check` | Read only. One JSON object: engine answer, Docker processes (name, id, age), socket entries in both folders (`*.sock` and reparse points; stale only while no Docker process runs), the last 20 backend-log lines naming `.sock.stale` or `cannot be accessed`, and each `ulpin-demo-*` container's state and health. | 0 engine answers, 3 not |
| `-Recover` | Acts only if the engine stays silent over three checks 5 s apart. Stops `Docker Desktop`, `com.docker.*` and `docker` processes, renames both folders to `run.stale-guard-<stamp>` and `docker-secrets-engine.stale-guard-<stamp>` (if the second rename fails, the first is put back), starts Docker Desktop once, waits up to 180 s for the engine and up to 180 s for every `ulpin-demo-*` container that the last watch saw running. | 0 fine, 3 engine not back, 4 rename failed and put back, 5 rename failed and not put back, 6 containers not back |
| `-Prestart` | At logon. If no Docker process runs and either folder holds a socket entry, moves both aside as above; then starts Docker Desktop if it is not running and waits for the engine. | as `-Recover` |
| `-Watch` | Every 5 minutes. Remembers the running demo containers while the engine answers. When the engine is silent on two runs in a row it runs `-Recover`, unless a Docker Desktop process is younger than 120 s (starting). At most three recoveries in six hours. | as `-Recover`; 3 while waiting |

Each `-Recover`, `-Prestart` and `-Watch` run appends one JSON line to
`E:/BhuAayam-data/ops/docker-guard/<yyyy-MM-dd>.jsonl`; `state.json` there holds the watch count and the last running
containers. Output names root folders as `{root}\...`. Test switches: `-Root`, `-DockerExe`,
`-DesktopExe`, `-OpsDir`, `-RecheckSeconds`, `-WaitSeconds`, `-Stamp`, and `-DryRun`, which never stops or starts a
process and renames folders only under a `-Root` other than the real one. Under such a root no Docker process is
ever stopped or started, and the run is refused without `-DryRun` or a stand-in `-PnpmExe`.
Tests: `node --test scripts/platform/docker-guard.test.mjs`.

## Demo start

The demo's containers come back with the engine, but its two native processes (the API on port 3194 and the
dispatcher) do not. So when `-Recover` ends `recovered`, or `-Prestart` ends `engine_back` or `engine_answers`, the
guard asks `GET http://127.0.0.1:3194/api/v1/health` (5 s). If that does not answer 200, it runs
`pnpm platform:start --profile demo` (300 s) and then `pnpm platform:doctor --profile demo` (180 s) in the demo's
serving checkout `E:/Projects/ulpin-wt/demo`. Start resumes the existing project only. `-Watch` does the same while
the engine answers but the health check has failed on two runs in a row, at most twice in six hours (`apiFailures`
and `demoStarts` in `state.json`). Only an invoked start counts; a refusal or dry run does not. Attempts expire
at six hours or the next local calendar day, whichever comes first. A guard-run doctor with exit 0, at least one
PASS and no FAIL clears `demoStarts` and `apiFailures`, including after a hand-run `-Prestart`/`-Recover`. An API
200 alone clears only `apiFailures`, not the doctor's qualification requirement. `demo.startLimitCleared` records
`doctor_pass`, `new_day` or `six_hour_window` when a budget is cleared/pruned. A `-Recover` run inside `-Watch`
leaves the demo to those two watch runs.

The guard never adds `--create` or `--runtime`, never stops, downs, resets or prunes anything, and never reads `.env`
or a runtime folder; a test checks the script's text for these and for the two commands above.

- Opt out: create the empty file `E:/BhuAayam-data/ops/docker-guard/no-demo-start`. The guard still checks health
  but starts nothing. `paused` stops this too, also for a hand-run `-Recover`. `-DryRun` records `planned` and never
  runs pnpm. Test switches: `-PnpmExe`, `-DemoCheckout`, `-HealthUrl`.
- Stopped on purpose: every stop of the demo's native processes (`stopProcesses()` in `processes.mjs`, used by
  `pnpm platform:stop --profile demo` and roll-out step 2; never a rehearsal) first writes
  `demo-stopped-on-purpose.json` (`{"stoppedAt": ...}`) in the ops folder, and a demo start removes it once the API
  answers. While it exists every mode records `stopped_on_purpose` and starts nothing; the engine is still recovered.
- Child output goes to `demo-start-<yyyy-MM-dd>.log` in the ops folder. On nonzero exit or timeout, the day's JSONL
  also carries `demo.start.failureTail` / `demo.doctor.failureTail`: the command's last five nonempty log lines,
  limited to 400 characters each, with root paths hidden and credential-labelled/Bearer values redacted. Start's
  tail is captured before doctor runs, so the original failure is not buried by doctor's output. A launch exception
  is recorded as exit -1 with its diagnostic. A command that outlives its timeout is left running and recorded as
  timed out; doctor is not run after a start that timed out.
- The run's JSON line carries a `demo` object: `apiStatus` (the health status code, `null` when nothing answered),
  `outcome`, `log`, `start.exitCode`, and `doctor.exitCode`, `doctor.lastLine` (the `Doctor: ...` summary),
  `doctor.pass` and `doctor.fail` (counts of PASS and FAIL lines), plus the bounded failure tails above. `outcome` is
  `api_answers` (nothing to do), `api_silent_waiting` (watch, first failure), `start_limit_reached`, `opted_out`,
  `paused`, `planned`, `pnpm_missing`, `checkout_missing`, `git_bash_missing` (with a refusal reason),
  `start_timed_out`, `start_failed`, `doctor_failed` or
  `started` (both exited 0). The run's exit code is the Docker outcome's; read `demo.outcome` for the demo.

## Scheduled-task shell failure (22 October) and safe self-test

At 10:31 and 10:41 the engine was healthy, but demo start failed with
`WSL (...) ERROR: CreateProcessCommon:798: execvpe(/bin/bash) failed: No such file or directory`, followed by
`ELIFECYCLE`. The start script invokes `bash`; the scheduled task's PATH selected Windows' WSL launcher instead
of Git Bash. Two failed invocations consumed the six-hour watch allowance (`start_limit_reached`), while the same
start from an interactive Git Bash shell worked. The old limit already expired after six hours; it was not a
permanent lockout. The doctor-PASS/local-day clearing above now releases the allowance sooner.

`Get-DemoEnvironment` locates Git using `git` applications on PATH (cmd/bin/mingw64/bin layouts), then
`HKLM:\SOFTWARE\GitForWindows` `InstallPath`, then `C:\Program Files\Git`. A usable installation must contain
both `bin\bash.exe` and `usr\bin\bash.exe`. The start and doctor children get Git's `bin` and `usr\bin` first on
PATH, and `npm_config_script_shell` explicitly points to Git's `bin\bash.exe`. The parent environment and installed
tasks are unchanged. Missing Git Bash refuses the start with `git_bash_missing` and a reason in the day's JSONL;
there is no WSL fallback.

From the repository root, reproduce the scheduled task's machine-only PATH without starting the demo:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command '
  $env:PATH = [Environment]::GetEnvironmentVariable("Path", "Machine")
  & ./scripts/platform/docker-guard.ps1 -SelfTest
'
```

Expect JSON with `ok: true`, `bash` and `scriptShell` naming Git's `bin\bash.exe`, and `output` containing the
Bash version and `MINGW...` or `MSYS...`. The self-test uses `New-DemoProcessInfo`, the same environment builder
as the real pnpm child. It returns before opening the guard lock or writing any ops file. The Node tests also run
a stand-in pnpm with System32-only PATH and verify its `bash -c` output, failure-tail ledger, missing-Git refusal,
midnight rollover and doctor-PASS clearing. No real demo start or scheduled-task change is needed for these checks.

## Install, pause, undo

- Install (per user, no administrator):
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/platform/docker-guard-install.ps1 -Install`.
  It registers "ULPIN Docker guard logon" (`-Prestart` at logon) and "ULPIN Docker guard watch" (`-Watch` every 5
  minutes), both running `E:/Projects/3d-ulpin/scripts/platform/docker-guard.ps1` hidden.
- `-Status` lists both tasks and reads Docker Desktop's own `AutoStart` value (that key only, never changed). The
  logon task starts Docker itself; with AutoStart on, Docker may start before the stale sockets are cleared.
- Pause: create the empty file `E:/BhuAayam-data/ops/docker-guard/paused`. `-Watch` and `-Prestart` then do nothing;
  a hand-run `-Recover` still acts, without the demo start. Delete the file to resume.
- Undo: `docker-guard-install.ps1 -Uninstall` removes both tasks. Renamed folders stay as they are: Docker Desktop
  makes fresh `run` and `docker-secrets-engine` folders, and the aside copies are only kept for reading.

## Never

The guard never resets Docker Desktop or offers to, never runs `wsl --unregister` or `wsl --shutdown`,
`docker system prune`, `docker volume rm`, `docker compose down` or `down -v`, never deletes a folder, a file or a
`.vhdx`, and never edits Docker's settings files. Nothing is ever deleted; aside copies are kept. A test checks the
script's text for these.
