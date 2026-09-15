# Reference interface delivery

This branch replaces the previous presentation with fixed navigation and three connected page families: Block Map, Property Register and Plan Workspace. The detailed fictional Lake View neighborhood is stored through the real ingestion, processing and review services. Existing evidence, identifiers, history and real datasets remain intact.

## Start locally

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm platform:start
pnpm db:migrate
pnpm build
pnpm start
```

Keep that terminal open. `pnpm start` runs both the web app and the job dispatcher. In another terminal:

```sh
pnpm demo:seed
```

Open <http://127.0.0.1:3000/blocks>, choose **Lake View · demonstration**, and select **12 Lake View Road**. Open its register, select a floor or space, open its workspace, and use **Build details → Build proposed 3D details → Review proposed records**. Returning to the block retains the same property and camera. Main navigation always returns to the respective directory.

The seed writes local canonical IDs to the ignored `fixtures/reference-neighborhood/installed.json`. Rerunning the command preserves existing edits and history. Stop/restart services without removing their volumes; `pnpm platform:start` recovers the existing local services. Live AI requires the existing free-route Nous configuration and verified availability; there is no paid fallback.

## Regenerate authored inputs

The generated demonstration PDFs, PNGs, specification and GLBs are committed; generation is optional. To reproduce them:

```sh
python3 -m venv .venv-reference
.venv-reference/bin/pip install -r scripts/reference/requirements.txt
.venv-reference/bin/python scripts/reference/generate.py
```

Generated files are fictional input documents and display assets, never real survey evidence. Review generated changes before importing. The seed checks hashes and refuses to overwrite changed existing bindings.

## Verification

Verified locally on 15 September 2026 against the production build and actual PostgreSQL/PostGIS, object storage, Redis/Celery and private processing services.

| Check                                                                    | Result                               | Evidence                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production build and TypeScript                                          | Passed                               | [Build](evidence/reference/production-build.txt), [types](evidence/reference/typecheck.txt)                                                                     |
| Navigation, stale state, geometry and measurement unit tests             | 20 passed                            | [UI tests](evidence/reference/ui-tests.txt)                                                                                                                     |
| Python processing                                                        | 163 passed                           | [Processing](evidence/reference/processing-tests.txt)                                                                                                           |
| Officer workflow, native ingestion, registry and investigation           | Passed                               | [Integration](evidence/reference/officer-integration.txt)                                                                                                       |
| Original copy, revision lineage and ownership guards                     | Passed                               | [Document copy](evidence/reference/document-copy.txt)                                                                                                           |
| Explicit block membership, geometry projection and area limit            | Passed                               | [Membership](evidence/reference/block-membership.txt)                                                                                                           |
| Bounded assistance validation                                            | 22 passed; no live inference claimed | [Validation](evidence/reference/ai-validation.txt)                                                                                                              |
| Actual UI at 1440×900, 1920×1080, 800×844 and 390×844                    | 12 checks passed; no page errors     | [Assertions](evidence/reference/browser-report.json), [transcript](evidence/reference/browser-tests.txt)                                                        |
| Investigation creation, evidence request, pending-review gate and reopen | Passed through actual UI             | [Report](evidence/reference/investigation-browser-report.json), [transcript](evidence/reference/investigation-browser-tests.txt)                                |
| Seed replay and service restart                                          | Exact retained snapshot comparison   | [Persistence](evidence/reference/persistence.txt), [seed replay](evidence/reference/seed-replay.txt), [service restart](evidence/reference/service-restart.txt) |

See `evidence/reference/browser-report.json` for actual browser assertions and `evidence/reference/visual-comparison.html` for reference/capture pairs. Test and build transcripts are retained beside the images. The baseline and implementation structure are documented in [REFERENCE_REBUILD_ARCHITECTURE.md](REFERENCE_REBUILD_ARCHITECTURE.md).

```sh
pnpm typecheck
pnpm build
pnpm test:ui
pnpm test:officer
pnpm test:case-document-copy
pnpm test:block-membership
pnpm test:ai
pnpm test:reference
pnpm test:reference:browser
pnpm test:reference:investigation
# From services/geo, in the development environment:
.venv/bin/pytest -o addopts='' -q --tb=short
```

To check a seed replay or restart against the current retained snapshot, run `pnpm test:reference`, then `pnpm demo:seed`, then `pnpm exec tsx scripts/reference/verify.ts --compare`. Restart services with `pnpm platform:stop` and `pnpm platform:start`, and run the comparison again while the local web process is running.

The browser harness uses real services and the persisted seed. It may create another retained original in the fictional incomplete property's workspace and prepare a review snapshot; it never commits a registry review automatically. The investigation harness creates a labeled fictional verification case, records a local evidence request and checks that pending evidence prevents review completion. No message is sent. Install the test browser with `pnpm exec playwright install chromium` if needed. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Chromium is installed elsewhere. `ULPIN_TEST_BASE_URL` can select another local port.

Software verification covers the supported local workflows listed above. The connected officer UI sequence is verified with explicitly fictional data. Real Indian block coverage and live AI extraction remain separate, unmet external acceptance gates.

## Visual verification

[Open the side-by-side reference comparison](evidence/reference/visual-comparison.html). All images on the application side are actual local browser captures. The comparison covers the three anchors and secondary directory, layer, utility, history, floor, investigation, upload and measurement states.

The final iteration adjusts the reference header, three-column panel proportions, expandable floor/space rows, document thumbnails, concise labels, and viewport-sized floor stack. The scene contains selectable meshes and recorded floor polygons; the plan canvas displays retained PDF/image bytes. Scene captures wait for the dynamic viewer and renderer. Small screens expose the same global destinations and move secondary tools into reachable panels.

The authored neighborhood is intentionally different from the illustrated reference buildings. Reference ownership, occupancy, survey photos and discrepancy values are not copied into records. Its eight buildings have authored facades, roofs and entrances; three have recorded detailed spaces. The reference's photorealistic rendering is represented by local articulated meshes rather than an image-backed scene. Captures make this visual difference explicit.

## External acceptance dependencies

- Verified Indian parcel/building/interior/utility evidence and the required georeferencing/vertical controls remain unavailable for the real Indian end-to-end acceptance case. Existing observed Bronx data remains intact. The fictional demonstration does not satisfy this real-evidence requirement. Supply permitted same-area originals and their CRS, placement controls and vertical benchmark to complete that acceptance case.
- Live Nous extraction cannot be accepted without configured credentials and a verified available free route. Status, unavailable behavior, citation validation and review gates are testable independently; no mocked inference is presented as live evidence. Configure `NOUS_API_KEY` privately, verify the authenticated free entitlement and supply ten permitted representative pilot document groups for the live accuracy/correction evaluation; see [OFFICER_AI.md](OFFICER_AI.md).

No merge or public deployment is performed.
