# REH6 - the rehearsal rolled to 2ddefbbb; Niagara register, map and line; a ZIP's layers by the dispatcher job

Rehearsal `ulpin-reh-02` at staging `2ddefbbb`, API `http://127.0.0.1:21026`. Index: [result.json](result.json).
The first attempt stopped at Docker's start ([result-first-stop.json](result-first-stop.json)). Before Part A,
`git diff --name-only 2acba69a 2ddefbbb -- services/ database/ scripts/platform/ pnpm-lock.yaml` was empty.

## Part 0 - Docker recovered
No Docker process was running. `run` and `docker-secrets-engine` were renamed aside in one command
(`run-stale-20261017-2350`, `docker-secrets-engine.saved-reh6-20261017`); Docker Desktop started once and answered
in 6.7 s. All 23 volumes are listed, the demo's and both rehearsals' included; the demo's containers came back by
their restart policy with the same ids ([docker-recovery.json](docker-recovery.json)).

## Part A - done
Checkout 0.10 s, install 1.0 s, `services/geo` is the pinned tree. Document runtime build 48.4 s. The roll printed
"nothing recreated" (3.6 s). Start 32.8 s. The doctor gave 28 PASS and 0 FAIL, with **PASS Document runtimes** and
**PASS Processors run the pinned image**; the gateway stays disabled.

## Part B - done
- `display-summary` 200 in 2.1 s, 41,809 features; the 500 m centre window 200 in 1.5 s, 3 features (REH5: 3).
- **Register:** the three proposals answer `GET /api/v1/buildings/{id}/canonical` 200 in about 1.6 s, `recordState`
  `candidate`, first gap "Unrecorded source proposal; candidate geometry is not registry truth or analytically
  eligible." (REH5: 422 `AREA_LIMIT`). The area's own id answers 404 "Physical feature not found."
- **Map at open** ([map-1.png](map-1.png)): the ground, no sky; the buildings are drawn but small at the 2 km
  scale. The Key shows, open, with Recorded and Proposed, not yet confirmed.
- **8 ticks** ([map-2.png](map-2.png), 1 km scale): "Showing 15,000 buildings in view (15,000 proposed, not yet
  confirmed), the most drawn at once; move closer to see the rest." The reads were cut: the window was still the
  whole extent, and its 15,000 came in 4 pages.
- **Pick** ([map-3.png](map-3.png), 20 m scale): the inspector shows `...:B10638`, "A reviewed proposal, not yet
  confirmed by an officer." and Open register. No flat background patch anywhere.
- **Register page** ([map-4.png](map-4.png)): "Building 10742", "No register is recorded for this building" and
  the candidate sentence; no code.
- **Settled line** ([map-6.png](map-6.png)): waiting for each view's reads to end, the line is true. At a 100 m
  scale the window was 3.1 by 3.2 km with 4,354 buildings, not cut; at 200 m and above every window held more than
  15,000 and the cut sentence showed.

## Part C - done
A new case took the NYC pack (14,621,643 bytes, SHA-256 checked) by the ZIP route. The enrolment returned in
0.16 s with one `intake-zip-layers` job queued; the job succeeded 1.6 s after it was queued, and six layer items
followed: five `probed/needs_answer`, and the buildings layer `read/undecided` with the already-in-area sentence (its
draft job ended `SOURCE_ALREADY_IN_AREA`). Enrolling again returned the same item and queued no second job.
The dispatcher log was not read: it lies under the runtime folder this task may not open.

## Left as found
The rehearsal is stopped at `2ddefbbb`, with six exited containers and three volumes, everything kept. The
demo's doctor matched its baseline after A, after B and at the end: commit `9d6acc6b`, the same container ids, and
no native process. Its API and dispatcher have not run since the reboot, and this task did not start them. Only
`/api/v1/health` was requested of the demo, and `ulpin-reh-01` was not touched.

## For the lead
Two items for code, listed in result.json. While a view is paging, the line shows a partial count as complete
(`areaWindow.ts:114`). The read window reaches four camera distances, so "move closer" shows down to about a 100 m
scale (`engine.ts:462`); that one is a decision. Two window pages took 31 s and 35 s, cause unknown. Rolling the demo
to `2ddefbbb` needs no schema step and no image roll; its steps and seconds are in result.json `forDemoRoll`.
