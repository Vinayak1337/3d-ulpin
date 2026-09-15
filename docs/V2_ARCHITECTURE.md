# V2 architecture

V2 is a new presentation layer on the existing officer workflow. Its base is `f0603349c3bc261efda8663289226b1a265f123f` on `feat/real-block-officer-workflow`. The redesign branch is `feat/v2-officer-redesign`. Next.js, Cesium, PostGIS, object storage, Redis/Celery and the private Python geometry service remain in place.

## Routes and ownership

| Route | Composition | State within the page |
| --- | --- | --- |
| `/v2` | Block home | Saved blocks, search, import dialog |
| `/v2/blocks/[areaId]` | `block/BlockPage` | Layers/properties rail, 3D/2D canvas, inspector, findings tray, data tools |
| `/v2/register` | `register/RegisterStart` | Search, recent properties, loaded-block context |
| `/v2/properties/[buildingId]/register` | `register/RegisterPage` | Overview, Floors & Units, Evidence, Issues, History, Investigation |
| `/v2/workspace` | `workspace/WorkspaceStart` or unassigned case | Existing preparations, property choice, draft creation |
| `/v2/properties/[buildingId]/workspace` | `workspace/WorkspacePage` | Measure, Calibrate, Compare, Build Details on one canvas |

The previous pages live under `/legacy`. Explicit compatibility pages preserve repeated query values and encoded identifiers. `/` redirects to `/v2`, except an existing `?case=` bookmark continues into the old workbench. API and source-file paths never move. `shared/routes.ts` is the V2 URL builder; `lib/legacy-url.ts` owns old presentation links.

Path IDs determine the active property. `area`/`areaId` is only retained after a real area-context response proves membership. A dossier establishes the canonical fallback block. `record` must belong to that dossier. Global search handles shared units by offering their actual physical parents; it never pairs one parent's property with another parent's block. An unknown selection fails visibly rather than fabricating a fallback property.

## State model

`shared/store.tsx` creates one vanilla Zustand store per V2 layout, provided through React context and consumed with selectors. There is no server-global mutable store. Session storage contains only a versioned, validated projection of recent property IDs and names (maximum 12), plus the coherent selection. It excludes source bytes, API responses, secrets and geometry. A route selection wins over late browser hydration. Map preferences are transient and scoped by area.

Shareable UI state belongs in the URL: selected map feature/finding, register tab/record and workspace mode/source context. Ephemeral controls, dialogs and mutation feedback stay local. Browser measurement notes are separately bound to the case, source ID, source hash and PDF page. They are local working notes, not recorded geometry or synchronized evidence. A change of browser origin, including port, changes that local storage scope.

`shared/hooks.ts` contains resource loading, mutation locking, query-enum state and debouncing. Resource requests use abort controllers and route identity guards. A late GET cannot replace a newer mutation response, a prior route callback cannot write to the next property, and unmounted callbacks cannot start requests. Refreshed snapshots retain their data while exposing loading/error states. Backend expected-revision checks remain authoritative.

## Reuse and rendering

- `shared/ui.tsx`: accessible buttons, badges, panels, loading/error/empty states, selective Phosphor icons and native focus-managed dialogs. Nested input `cancel` events cannot close their parent dialog.
- `shared/Shell.tsx`: floating three-family navigator, Command/Ctrl+K search and local service status. Validation is separated into pure navigation helpers and a data hook.
- `block`: API controller, geometry helpers, 2D SVG renderer, map composition, contextual rails, findings and import/export components.
- `register`: dossier presentation, recorded plan/section geometry, original evidence, issue inspection and persisted investigation forms.
- `workspace`: source rasterization, calibration/measurement math, source canvas, separate mode panels, assignment and native preparation/build integration.

Cesium is dynamically loaded. The geographic renderer and plan canvas retain view state during mode switches. The 2D renderer uses local coordinates with a display-only Y flip; polygon holes, multipart islands, lines and points keep their topology. Large bounds use a one-pass accumulator. Stale findings are readable as historical results but cannot highlight current geometry. The original low-level geographic viewer and worker-backed build/placement controls are reused; whole legacy pages are not embedded in V2.

V2 tokens and ordinary CSS selectors are rooted in `.ulpin-v2`; Register and Workspace use CSS modules. Old globals/navigation styles are isolated by `@scope (.legacy-app)`. The root document contains neutral sizing and Cesium widget CSS. This local Chromium target supports CSS scope; broader browser compatibility needs separate validation. Reference images are design inputs, never live page backgrounds.

## Source and preparation boundary

GIS imports use the existing mapping, inspection, revision review and acknowledgement endpoints. Export downloads contain actual recorded GeoJSON or check/source reports. A current-view SVG is available only from the visible 2D canvas.

The one new server seam is `POST /api/v1/import-packages/:id/copy-case-documents`. It copies selected original sources into that property's canonical preparation with explicit reason and immutable `copiedFrom` lineage. It validates destination ownership, revisions, profiles, original hashes and native parsing before saving the batch. Retries are stable; invalid batches cannot partially change the package. Originals and their case history remain intact. See [the integration verification](V2_LEGACY_AND_DOCUMENT_ASSIGNMENT_VERIFICATION.md).

PNG/PDF inspection, local calibration, extracted candidates, reviewed facts, placed draft geometry, worker validation and recording remain distinct. Visual comparison does not compute a survey discrepancy. No UI badge creates ownership, official ULPIN status, spatial authority or utility safety.

## Development and extension

```sh
pnpm install --frozen-lockfile
pnpm platform:start
pnpm db:migrate
pnpm dev
pnpm typecheck
pnpm test:v2
pnpm test:case-document-copy  # requires the local platform
pnpm build
```

Add a new family route through `shared/routes.ts` and validated navigation targets. Add same-family views as typed query modes or focused panels instead of duplicating pages. Extend existing contracts/APIs for new authoritative data; do not put domain calculations in Zustand or infer source fields from the reference boards. Keep requests parallel when independent, lazy-load expensive renderers, use primitive selector subscriptions, and expose missing/stale/blocked states where data is consumed.

The supplied build prompt, design rules, navigation matrix, tokens and image manifest are retained in [v2-design](v2-design/BUILD_PROMPT.md). All 35 reference images were inspected locally; the manifest identifies the supplied pack. UI evidence in `docs/evidence/v2` is captured from the running product, with synthetic evidence labeled explicitly.
