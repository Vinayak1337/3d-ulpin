# Registry verification evidence

Executed locally on 13 September 2026 against the actual PostGIS, object storage, Redis/Celery, private Python processor and production Next.js application.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript `pnpm typecheck` | Passed |
| Production `pnpm build` | Passed; registry, site, record and legacy workbench routes generated |
| Python geometry/inspection suite | **53 passed**, including seven registry geometry checks |
| `pnpm test:registry` | Six integration scenario groups passed against persisted records |
| `pnpm test:registry-allocation` | Three concurrent new-record requests reused one draft/ID; next allocation advanced to P002; missing request key rejected |
| `pnpm test:api` | **17/17** legacy adversarial API checks passed |
| `pnpm test:demo` | C-001: seven spaces, **6.4 → 0 m³**; C-002: five spaces, **14.4 → 0 m³**; original bytes and revisions preserved |
| `pnpm test:scene` | **7/7** existing scene tests passed |
| Record export | HTTP 200; correct schema/classification and three referenced originals with 64-character SHA-256 hashes |
| Malformed registry request JSON | Typed HTTP 400 |
| Local health | Database, storage, processor, Redis and worker all healthy |

The registry integration test verifies fourteen spaces, distinct floor records, one basement and one corridor; ordered point stacks and shared-wall contacts; invalid polygon/frame rejection; a real 8 m³ blocking overlap; draft rights/geometry isolation; mandatory warning acknowledgement; idempotent commit retries; stale review rejection after another record changes; fresh re-review; stable IDs; party search; and an idempotent seed that preserves operator revisions.

The private Python suite independently derives the 12 m³ and 4 m³ excavation quantities from rectangles and vertical intervals. It also verifies zero-volume contact between adjoining units, context containment without a competing ownership volume, the 8 m³ correction and a context-only site's review.

Generated reports remain in ignored `test-results/registry-report.json` and `test-results/demo-verification.json`. The four legacy rehearsal cases created during this pass were explicitly archived after testing, preserving their source bytes, models and histories. The isolated allocation test removed only its own unpublished, source-free temporary records.

## Browser rehearsal

Verified through the actual application UI:

1. Two adjoining buildings, their shared basement and corridor displayed together in the plan/Cesium view, with property volumes selected by default.
2. Search by **Household A-201** returned its recorded apartment. **Copy link** resolved to the same identifier and persisted record after restarting the web application. A double-encoded colon found during this check was corrected.
3. Proposed A-201 lower elevation **2.8 m**, saved and built checks. The UI reported **8 m³** overlap while the current record remained **3–6 m / 120 m³**. The overlap finding was selectable.
4. Restored **3 m**, saved and rebuilt. Recording was disabled until the warning acknowledgement was written. The recorded revision retained the same permanent identifier.
5. Loaded the excavation proposal and calculated exactly **12 m³ BASE** and **4 m³ UTIL**. Ground-apartment contact rows displayed **0 m³**, separate from the two positive-volume intersections. Selecting a result highlighted its intersection. Drawing four corners on the plan also produced a queryable proposal.
6. Above/below at **[4,6]** returned **BASE −3–0**, **A-101 0–3**, **A-201 3–6**, with permanent IDs, related buildings, rights and evidence links.
7. The **Source files** view listed all five original revisions, and `plan.png` visibly rendered its synthetic plan label. Opened the stored `rights.pdf` from a result. Its page visibly labels the fictional schedule and parties; the preview preserves original-download access.
8. Inspected the loaded record page at a **390 × 844** viewport and the desktop viewport. Controls and columns adapted without horizontal clipping. The temporary viewport override was reset.

The production correction and excavation rehearsal ran with browser HTTPS resources blocked and the HTTP cache disabled. All **39 observed requests** in that sequence were to `http://127.0.0.1:3000`; no external asset request was observed. The PDF preview also rendered under that configuration. Blocking and cache overrides were removed after verification. This checks the prepared runtime's local asset dependency, not an internet-free first installation.

## Deliberate limits

The fixture is synthetic and has no real-world basemap placement. Geometry is bounded to single-ring constant-height prisms, with 100 current volumetric spaces per site. Rights are source-linked fictional assertions. Technical recording does not confer ownership, and intersection results do not certify excavation clearance. Authentication, official issuance, AI extraction, new GIS/BIM/LiDAR importers and formal legal acceptance remain outside this release.

For presentation steps, use the root [REGISTRY_DEMO_GUIDE.md](../REGISTRY_DEMO_GUIDE.md).

The subsequent [deep review](../DEEP_REVIEW.md) records adversarial findings, corrections and remaining scope gaps beyond this initial acceptance run.
