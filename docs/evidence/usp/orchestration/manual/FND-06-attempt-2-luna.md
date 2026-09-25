# FND-06 attempt 2 — persistent-preview manual check

## Result

**Partial manual check.** The live saved-map route, Local workspace status, and keyboard close/focus return were observed. The native-preparation page showed a runtime 404, and an enlarged desktop layout could not be established in the available in-app browser. This is not a GF-PRIVACY gate pass.

- Served candidate pin: `9c6c578b73bb71ca06342840943ff199ac4e84c2`, based on corrected FND-06 result `55d6c864` (pending review).
- URL: [http://127.0.0.1:3187/studio/work](http://127.0.0.1:3187/studio/work); Map route opened: `/studio/areas/9e77c608-bac7-4d56-9ac7-3032cc49074d`.
- Browser viewport observed in CUA screenshot: 842 × 811 px. Light appearance was visible.
- Requested lane: GPT-6 Luna / xhigh. Per-turn runtime model/effort metadata was not exposed here, so the applied setting is unverified.
- Report-only worktree: `/Users/vinayak/.codex/worktrees/manual-fnd06-attempt-1-luna`, branch `manual/FND-06-attempt-1-luna`, based at `612aee820bc6047cbe2486fbfe88a0681e89ec7c`.

## Findings

### P1 — visible legacy fictional/sample content on Batches (UI-08)

On `/studio/work`, a page-level CTA appears outside the Saved work list: **“Try the Lake View sample”** and **“Download the fictional source files, import the package and explore the resulting draft map.”** It includes an **“Open import demo”** link. In the Saved work list, separate rows display labels such as **“Fictional service kiosk · details,” “Lake View · demonstration,” “Fictional demonstration,”** and **“Lake View · supplied plan revisions (fictional).”** The CTA is structurally separate from saved rows and appears to be a static sample panel; the row names/statuses are saved-work content. No source code was inspected to confirm the CTA's implementation. I did not click the demo, download files, or relabel any row.

This is a concrete H29/UI-08 replacement issue for the Batches surface, not a broader site audit. A CUA screenshot of this page was captured in-session; it is visible in the task thread but was not saved as a separate file in this report worktree.

### P2 — native-preparation route exposes a 404 runtime error

From the saved Bronx map's selected property, **Prepare an update** opened `/studio/properties/11aa9ad8-2640-48a4-9808-f2a3526b40b2/workspace?area=9e77c608-bac7-4d56-9ac7-3032cc49074d`. The page displayed **“The recorded property remains unchanged”** and a **Create workspace** button, but the Next.js dev overlay reported **“Runtime Error — Request has failed. Status Code: 404.”** The plan panel also said **“No drawable plan was found in this document”** for `nyc-building-footprints.geojson`. I did not activate Create workspace or open the original-document link, so no draft was created; the request causing the 404 remains unidentified. The native-preparation workflow is reachable but unqualified by this check.

## Checks and observations

| Journey | Expected | Observed |
| --- | --- | --- |
| Load Batches / saved work | Saved records load without a lasting loading state | Initially showed “Loading saved work …”; then showed `1–20 of 38`. Selecting the read-only **Recorded history** filter showed `1–12 of 12`. Pass for this saved-work load check. |
| Open Map for an existing recorded row | Saved scope and source state appear without editing data | Opened **Bronx building context around OTI 353927**. Map showed “Recorded source,” revision 1, 62 buildings, source world **Observed**, area CRS **EPSG:32618 · metres**. Evidence class and record status remained explicitly **unknown**; levels were not supplied and the UI stated there is no scene ground tie. No map/export/edit action was taken. |
| Open Local workspace status | Honest service/provider/residency copy; light-only UI | Light appearance. Copy stated loopback addresses, physical hosting location unverified, non-India AI blocked, native preparation available, full data residency unverified, and image egress blocked pending visual redaction qualification. Database and storage were **Available**; processor, redis and worker were **Unavailable**. Copy fit the observed viewport without clipping. |
| Keyboard close and focus return | Escape closes status and returns focus to opener | Pressed Escape; dialog closed and the accessibility state reported focus on the **Local workspace status** button. Pass at the observed viewport. |
| Enlarged desktop layout | Check status copy and close control after enlargement | Tried `super+plus` and `super+shift+equal` four times each; screenshots showed no zoom change. CUA exposed only the Codex in-app browser and no viewport override. Enlarged/200% layout remains unverified; no clipping claim is made for it. |
| AI-unavailable/native-preparation path | Native route is available without provider call or data mutation | Status copy says native preparation remains available. The saved property's preparation page exposed Create workspace, but the 404 dev runtime error above prevented a clean route result. Button was not activated; zero provider calls were initiated. |

The Batches, status-dialog and 404-overlay screenshots were viewed through CUA during this check; no screenshot files were written to the repository. Design-fidelity comparison against the user visual pack or repository Officer Studio reference mockups was not performed in this bounded privacy/UI check.

## Scope and cleanup

All interaction used the existing `http://127.0.0.1:3187` preview at the served pin. The persistent preview and its services were intentionally left running as requested. No runner was started, checkout was refreshed, dependency installed, or process/service stopped. No imports, downloads, workspace creation, record edits, provider calls, database operations, or tests were performed. No resources owned by this check require cleanup.
