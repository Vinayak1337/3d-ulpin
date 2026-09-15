# Reference interface rebuild

Baseline: `fd029504c9b24b020a30449568092dfde174abf8` on `feat/v2-officer-redesign`. Replacement branch: `feat/reference-ui-rebuild`. The baseline type check and actual 1440 × 900 block capture are retained in `evidence/reference/`.

## Dependency and capability inventory

| Responsibility                                 | Retained implementation                                                     | New presentation boundary                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Geographic scene and picking                   | Cesium, physical features, explicit block membership, camera snapshots      | `features/officer/scene`, Block Map rail/inspector                                |
| Property identity, records, evidence, issues   | Existing dossier/resolver and registry APIs                                 | Register directory, Overview, Floors, Evidence, Investigation                     |
| Processing, placement, revision-guarded review | Private Python, Celery, PostGIS, `PreparationBuild`, `PreparationPlacement` | Workspace modes and review panel                                                  |
| Original document rasterization                | PDF.js and original-file endpoints                                          | `documents/DocumentThumbnail`, `useSourceRaster`, `SourceCanvas`                  |
| Vertex and source-level edits                  | `PlanView`, existing unit-edit/build APIs                                   | `GeometryWorkspace`                                                               |
| Local-frame records                            | Registry draft/review/query APIs                                            | Retained register, rights correction, revision history, spatial inquiry           |
| Bounded assistance                             | Existing Nous status, extraction, citation validation, cache and apply APIs | Collapsed assistance panel, selected source/crop and questions                    |
| Transient interface state                      | Existing Zustand dependency                                                 | One application provider; bounded explicit recents, panels, tools and preferences |

The old AreaWorkbench, Workbench, RegistryWorkbench, PropertyPage, DocumentPreparation and their presentation-only dependencies/styles were removed after the required operations moved. There is one maintained interface. Old `/v2`, `/legacy`, `/areas`, `/registry`, `/sites`, root `?case`, and `/workbench` bookmarks use lightweight resolution/redirects. They retain identifiers and relevant query parameters; source URLs and historical records are untouched.

## Identity and state

Global navigation uses a fixed typed constant: `/blocks`, `/register`, `/workspace`. Contextual links carry canonical building identity and the explicitly validated block. Search offers separate choices for records with multiple building parents. A saved case resolves its property from `building_preparations`; a directory never chooses one implicitly.

URLs own building/block/case identity, workspace mode, selected register record, source and PDF page. Zustand owns interface preferences and explicit recents. Original files, geometry, source revisions, review snapshots and investigations remain in backend storage. Per-source measurement notes remain local to the browser and are identified by original hash and page; they do not update registry geometry.

The register directory uses one bounded summary query, and a detailed dossier projects its floor geometry in one database operation. Cesium reports render readiness before a scene is captured.

`useResource` cancels obsolete requests, scopes responses to their requesting path, and invalidates in-flight snapshots after mutations. Property/case components remount by canonical identity. Cesium retains camera state per block and resets viewer resources correctly on disposal. An exploded floor stack adds a display offset to recorded levels and never rewrites a measurement.

## Persisted demonstration

`generate.py` authors the floor plans and presentation meshes from one specification. `seed.ts` imports exterior spatial inputs, preserves PDF/PNG/CSV originals, resolves native source facts explicitly, invokes the existing worker, then reviews and records supported interiors. It uses a namespace and an advisory lock, retains existing records, checks asset hashes and refuses to overwrite a changed presentation binding. It does not rebind an original display asset to a later edited geometry revision. `scenarios.ts` adds the fictional utility, incomplete fourth property, two original plan revisions, and an investigation.

Eight buildings share one neighborhood. Properties A/B/C contain 4/3/5 floors and 20/15/25 recorded spaces. D has source plans and an intentionally incomplete native level input. E–H have exteriors only. Parcels, roads, public land and a fictional utility are independently typed inputs. The dataset is explicitly synthetic throughout ingestion and storage; the UI labels it fictional/demonstration. Existing observed datasets remain separately selectable.

`scene_asset_bindings` is additive. A binding stores feature identity/revision, asset URL/hash, named frame, geographic anchor/heading and provenance. Area context includes only bindings matching the current feature revision, including explicit cross-block members. Display GLBs contain roofs, facades, windows, entrances and landscaping; analytical geometry still comes exclusively from recorded spatial inputs. No reference image is used as a live scene.
