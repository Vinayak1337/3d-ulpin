# Shared neighbourhood upload and conflict demo

Status: proposed implementation plan. No new fixtures or product behaviour described below are implemented yet.

## Goal

An operator creates one synthetic area, uploads independent building/infrastructure packages, and sees them accumulate at their declared positions on one persistent map. Selecting a building reveals its floors, spaces, prototype IDs, recorded rights and source evidence. A single Conflicts action checks the area and highlights actual computed intersections.

The presentation uses a fictional **Pitampura Demo Neighbourhood**, 250 × 250 metres, with Block A, B and C as local planning groups inside that one site. It is inspired by block-based urban administration; it does not represent actual Pitampura parcels, surveys, parties or geography.

## 1. Spatial layout and limits

- One registry site and namespace, one frame `LOCAL-PITAMPURA-DEMO-250`, one benchmark `BM-PITAMPURA-DEMO-0`.
- Declared site extent `[0,0]–[250,250]`; the map extent remains fixed as more files are uploaded.
- Block A: `[10,10]–[110,110]`; Block B: `[140,10]–[240,110]`; Block C: `[10,140]–[110,240]`.
- A main road corridor runs `[115,0]–[135,250]`. Its synthetic reserved volume is explicitly declared `0–3 m`; it is not inferred by extruding a road drawing. Surface presentation and reserved volume are separately labelled.
- Eight buildings: three in A, three in B and two in C. Each has three floors (`0–3`, `3–6`, `6–9 m`), two apartments and a common strip per floor.
- A01 `[20,20]–[40,40]` and A02 `[40,20]–[60,40]` share a wall. A03 `[95,40]–[110,60]` lies beside the road. B01 `[150,20]–[170,40]`, B02 `[180,20]–[200,40]`, B03 `[210,60]–[230,80]`, C01 `[20,150]–[40,170]`, C02 `[55,190]–[75,210]`.
- Divide the normal 20 m-wide footprints into 8 m apartment / 4 m common / 8 m apartment strips. A03 uses 6 / 3 / 6 m strips.
- One shared basement below A01+A02, elevations `−3–0 m`; one utility corridor within the road footprint, elevations `−5–−4 m`.
- 72 apartment/common volumes plus road, basement and utility = **75 current spatial units**. Parcel/building/floor context is separate. Preserve the existing 100-space limit; rejected proposals do not consume current-space capacity.
- Block groups support navigation/filtering. Their planning footprints are context, not automatic ownership claims or duplicate property identities. Multi-block infrastructure remains one spatial record with multiple links.

## 2. Demo kit in the project root

Create `demo-data/pitampura-250/` with:

- `README.md`: upload order, map explanation, exact clicks, expected counts and calculations.
- `00-area/`: area/frame manifest, block context and road corridor inputs.
- `01-building-a01/` through `08-building-c02/`: independent packages with distinct footprints in the shared frame.
- `09-shared-infrastructure/`: basement and utility inputs, each with a single stable external key.
- `scenarios/road-widening/`: conflicting proposal and corrected revision.
- `scenarios/floor-correction/`: explicitly targeted boundary correction and corrected revision.
- `reference/`: labelled whole-area plan PDF and a file-to-feature index. Reference files are not required uploads.

Each building package contains `geometry.json`, `levels.csv`, and a labelled `plan.pdf`, plus an application manifest describing feature keys, block/building/floor links and source locators. A fictional rights schedule is included where rights are demonstrated. The schema for structured rights associations will be documented and validated; geometry must never invent a party or a right.

JSON/CSV are the computational inputs. PDF is evidence for inspection. All files display synthetic provenance. Do not claim these application JSON profiles are IFC, SHP, LAS, official cadastral exchange or downloaded Indian survey files.

Generate the kit reproducibly from a checked-in script. Include authored scenario coordinates and an independent expected-results table. The generator must not query production results to manufacture expected answers.

## 3. Upload and review experience

From the map: **Add to block → Upload package → Inspect/build → Review → Add to current map**.

- Multi-file drag/drop accepts the files from one package as one operation. Show package/building names, not a flat list of revisions and internal workspaces.
- The area package establishes the declared extent and common frame once. Subsequent packages join this area using their explicit metadata.
- Show the proposed building in position alongside existing records during review, with a clear Draft state. Recording adds it to the current layer.
- Keep the preparation workbench accessible for corrections, but ordinary uploads should not require hunting through workspace lists or manually typing frame names.
- Add **Back to block map** and **Review for block map** actions in the workbench, carrying the site and case IDs.
- Resolve package feature keys within the target site. Link floors/spaces to existing context rather than allocating duplicate parcels/buildings on every upload.
- Associate new package versions with the existing records and create a new correction draft. Do not return an already-recorded import when a later built revision is being submitted.
- Use an import operation key and package revision/fingerprint for retry protection. Same-operation retries reuse identities and draft; changed content requires an explicit new revision. Source originals and previous revisions stay preserved.
- Mismatched frames fail before submission with the existing separate-site option. No implicit translations, renamed frames or invented geographic placement.
- Blocking findings stop recording. Warnings require acknowledgement. Site/draft revisions and neighbour snapshots must still be current at commit.

## 4. Interactive area map

Maintain the minimalist map-first layout:

- Default whole-area plan at this scale; a prominent 3D switch and optional linked plan/3D view.
- Real pan/zoom, a scale bar, labelled block boundaries and streets, and Fit area.
- At area scale, show building labels/outlines; show room labels after focusing a building or choosing a floor.
- Click a building to focus it and open its floor/space navigation. Click a space to inspect its permanent ID, dimensions, rights and evidence.
- Filters: Block, Building, Floor, Underground, Drafts. A building filter must retain its surrounding context clearly.
- Recorded geometry and draft proposals have distinct visual treatment. Selection and conflict colours are distinct.
- Keep the shared basement/corridor as single records, accessible from each related building/block.
- Add an explicit road-use classification through contracts, persistence validation, imports, queries, exports and legend; do not disguise roads as apartments/common rooms.
- Retain local-metre geometry in Cesium, with no runtime basemap/imagery dependency or asserted real-world coordinates.

## 5. One-click conflicts

**Conflicts** runs a site-scoped audit and opens a compact results panel. Positive-volume intersections are red, warnings amber, zero-volume contacts neutral.

Report separately:
1. Current-record findings.
2. Each proposed change against its effective current neighbours, replacing its own target revisions for comparison.
3. Interactions between distinct pending proposals, labelled as proposal interactions rather than contradictions already recorded on the ground.

Alternative drafts targeting the same record are alternatives, not simultaneously existing geometry. Do not manufacture self-conflicts by stacking a current revision and its replacement.

Use PostGIS candidate filtering and the existing Python prism calculations. Return record/draft IDs, frame, source references, site revision, included draft revisions, intersection geometry and computed volume. Invalidate results when any included revision changes. Invalid/unsupported geometry must be reported as an incomplete audit rather than a green all-clear.

Selecting a finding fits both affected records and highlights the exact intersection. Expose related rights/evidence and the responsible draft from the same panel. Context containment and shared walls are not positive-volume conflicts. Geometric conflict is not a legal ownership decision.

The clean completed area should show zero blocking volume conflicts. The red presentation scenario is introduced as a draft; conflicts are not bypassed to seed illegal current records.

## 6. Fixed presentation scenarios

### Incremental uploads

Create the area, upload A01, then A02, then a B/C building. Show that they accumulate on the same map and share the same frame. Load remaining packages through the same path. Existing buildings retain their IDs and revisions.

### Road widening versus building

- Current A03 east apartment footprint: `[104,40]–[110,60]`, lower floor `0–3 m`.
- Proposed widening footprint: `[105,40]–[115,50]`, reserved elevations `0–3 m`.
- Intersection: `[105,40]–[110,50]`, hence **5 × 10 × 3 = 150 m³**.
- Corrected proposal: `[110,40]–[115,50]`, `0–3 m`. It only touches A03; **0 m³** interior intersection.
- Explain the reservation limits; a 2D road/building crossing alone is not proof of a 3D conflict.

### Vertical boundary correction

- A01 west apartment footprint `[20,20]–[28,40]`, area **160 m²**.
- Change upper-floor lower limit from `3` to `2.8 m`, retaining upper `6 m`.
- Against the ground apartment: **160 × 0.2 = 32 m³**.
- Restore `3 m`: zero positive-volume overlap. Permanent ID stays unchanged.

### Valid coexistence

- A01/A02 shared wall: contact, no interior overlap.
- Basement upper limit `0` meets apartments at `0`: contact only.
- Utility `−5–−4 m` below road reserve `0–3 m`: no volume conflict despite plan overlap.
- Above/below queries reveal the actual ordered stack at a chosen point.

## 7. Delivery order

1. Add site extent/block metadata, road classification and the documented package manifest; implement generator and geometry-only fixture checks.
2. Complete package upload, explicit relationships/rights binding, duplicate prevention and revision-aware preparation-to-registry handoff.
3. Implement whole-area navigation, scale-aware labels, block filters and direct workbench/map navigation.
4. Implement site-wide current/draft audit with exact intersection highlights and stale-result protection.
5. Generate all demo files, run sequential uploads in the browser, rehearse both conflict/correction stories, and update the root demo guide.

Offer two demo entry points: **Start empty area** for live uploads and **Load completed sample** for a fast tour. Both use the same real inspection/build/review pipeline. Loading a sample is idempotent and never resets operator edits; a fresh rehearsal creates a separate demo site intentionally.

## 8. Acceptance

- Eight buildings and shared infrastructure appear within one 250 × 250 m site, with stable placement after restart.
- Uploading independent packages does not create a new site per building, duplicate context or reissue existing IDs.
- Duplicate submissions/retries do not add duplicate records; new revisions target existing identities.
- Floors and rooms with repeated readable names remain distinguishable by building.
- Explicit source-linked rights survive import/export; missing rights stay visibly unrecorded.
- Whole-area plan, 3D selection, block/floor filters and map-to-record navigation work at presentation-laptop size.
- One click identifies the 150 m³ road proposal and 32 m³ vertical correction. Exact overlap shapes are highlighted.
- Corrected proposals yield zero positive-volume conflict; boundary contact and underground coexistence remain correctly classified.
- Current records remain unchanged while a problematic draft exists; stale audits/reviews cannot be recorded.
- Fixture provenance, local frame and prototype identifier status are visible in files, record details and exports.
- Existing Nandan, legacy case URLs, source downloads and review flows remain intact.
- The installed demo runs without internet access.
