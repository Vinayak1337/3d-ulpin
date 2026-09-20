# T071 — Proposed bulk interface and data contract

Delivered under `design/bulk-studio-v4/`, served locally on port 3012. Live application on port 3000 remains empty (areas=[], work queue total=0). No backend changes, seed, snapshot overwrite or real records were created.

## Reference audit

Three bounded workers covered original/V3 image audit, Drive source/schema research, and interactive map implementation. Parent integrated and reviewed. Nineteen source/V3 images were inspected. Prior references retain useful restrained green spatial canvases but are individual-property-first, duplicate information, hide vertical tools, and omit batch dependencies, recording scope, rights and explicit source gaps. Detailed findings and rechecked fixes are in REFERENCE_AUDIT.md.

## Source findings and proposed model

Google Drive folder was accessible. Sixteen content files were inspected plus metadata/folder inventories. Source explicitly synthetic; normalized data includes 31 parcels, 32 buildings, 26 floor-space rows. The latter explicitly lack individual unit polygons; DSM datum is unknown; native source ID naming differs in two layers. LAS/raster binaries were not independently parsed or survey-validated. SOURCE_INVENTORY.md gives exact files, producer assertions and limitations.

Proposed v1 schema: stable objects, geometry revisions, local/CRS/vertical reference, immutable source descriptors/record locators, observations and lineage, many-to-many relationships, independently reviewed rights, batches and issues. DATA_MODEL.md additionally defines concrete proposed native solid/surface/multipart payloads and identity-transition contracts. Those v1.1 extensions are not implemented schema/renderer support. A real source floor-space mapping keeps geometry null and preserves the stated area as an assertion.

New isolated demo: 44 objects/geometries, 12 buildings, 12 parcels, 4 floors, 12 spaces, 3 roads, 1 utility, 33 relations, 7 source descriptors (3 embedded, 4 metadata-only), 3 batches and 1 unknown-height exception. No original bytes or official IDs fabricated. This is a separate authored specimen, not an asserted conversion of the Drive geometry.

## UI set

Batches, import, source matching, missing-evidence review, floor-layout review, scoped recording and searchable property register, plus interactive map states. Map supports orbit/pan/zoom, 2D/3D, layers, search that focuses results, closable inspector, exact floor/space selection, separation, section plane and underground alignment. Returning from register retains map context. Native solid cut-face construction is not implemented. Scene decoration is explicitly non-authoritative.

Prototype recording preserves parent/child scope, resets acknowledgement after changes, shows linked relations/revisions, retains unresolved objects and displays partial progress. Source evidence opens readable fields with optional technical detail. Rights show scope/evidence and remain unverified. All actions are local prototype state.

## Verification

JSON Schema Draft2020-12 and semantic fixture checks passed; five invalid fixture mutation checks passed. Sixteen end-to-end browser checks passed, including dependency scope, partial recording, geometry review, register/evidence/rights/export, 2D/3D/floors/section/underground, context return, inspector visibility and tablet overflow. Zero page errors or live-app requests. Additional bounded worker checks verified mouse orbit/pan, viewport expansion/camera preservation, search focusing and 390px overflow. Eleven fresh final screenshots in `design/bulk-studio-v4/screens/` were captured without page errors; map, plan, record, batch and register captures visually inspected.

`gallery.html` presents captured proposed screens. `index.html#map` opens the interactive map. Reference user acceptance and actual application implementation remain future work. Appllama tools were unavailable; relevant taste/frontend-design guidance and supplied references were used.
