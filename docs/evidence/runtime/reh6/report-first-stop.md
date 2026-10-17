# REH6 - stopped at the Docker start; the rehearsal was not rolled

Rehearsal `ulpin-reh-02`, meant for staging `2ddefbbb`. Index: [result.json](result.json).
Before Part A, `git diff --name-only 2acba69a 2ddefbbb -- services/ database/ scripts/platform/ pnpm-lock.yaml`
was empty: no schema step and no image roll.

## What happened
- The machine had been rebooted. The demo was already down: no API or dispatcher process, `/api/v1/health` gave
  no answer (000), and its doctor failed only "Docker local Linux engine and context/socket"
  ([before-docker-down.json](before-docker-down.json), commit `9d6acc6b`).
- Docker Desktop was started once at 23:40:44 IST. Its backend stopped at 18:10:46Z with "initializing Ingest
  server: rename run/sailor-ingest.sock to sailor-ingest.sock.stale: The file cannot be accessed by the system", and
  showed "An unexpected error occurred" with **Quit** and **Reset to factory defaults**. The engine pipe never
  appeared ([docker-start.json](docker-start.json)).
- By the task's stop rule nothing was clicked and nothing was recovered. The log shows Quit was chosen at 23:44:45
  IST, not by this run; Reset was not chosen. Docker Desktop then exited.

## Not run
Parts A (checkout, install, document runtime, roll, start, rehearsal doctor), B (Niagara summary, windows,
register, map) and C (ZIP layers by the dispatcher job). The serving checkout is still at `2acba69a`, clean.

## Left as found
The closing demo doctor matched the first in commit and process ids (`9d6acc6b`, none running, exit 1 on the
Docker line only) ([demo-final.json](demo-final.json)). `ulpin-reh-01` was not touched. No rehearsal command ran.

## For the lead or the owner
Docker must be brought up first. The earlier recovery after a reboot was: stop the Docker processes, rename
`%LOCALAPPDATA%/Docker/run` and `docker-secrets-engine` aside together, start once, never Reset. Then rerun REH6
from Part A step 1 on this branch. The demo is down too, so starting it is a separate step for the owner.
