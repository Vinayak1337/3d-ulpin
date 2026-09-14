# Officer UI verification — 15 September 2026

This verifies local software behavior. The synthetic block and authored documents below are not a real Indian survey, title record, permission, utility observation, or accepted pilot. The retained Bronx block is foreign source regression only. Indian source permission/acquisition and a configured free Nous account remain separate acceptance requirements.

## Actual UI workflow

Using an isolated Chromium browser against the local app, the operator flow imported `/tmp/ulpin-officer-proof/synthetic-buildings.json`, chose ArcGIS JSON / EPSG:32643 / stable `id` / observed-ground geometry meaning / **Synthetic software fixture**, reviewed the package, and recorded three buildings. No API call was used to bypass these UI actions.

- Area: `8c61a45e-3ae9-4c7c-95f2-78918f23582a`
- Building A: `2c2aa2dc-b83e-4c64-842e-9790407afb0d`
- Building B: `2d5d12c8-1fa5-42a1-a3a9-80f8fad10ff6`
- Building C: `022597b5-41ed-495b-8318-6ccb0452b58b`
- A preparation package: `73a38abb-727a-464e-adf7-56c571c0df16`
- A linked case: `a99b91c8-c5d7-4a65-83f9-b56e49548010`

The same property's Prepare panel uploaded `synthetic-plan.csv` and `synthetic-levels.csv` in one file selection. The native parser produced five separate candidates: space label, floor label, Polygon boundary, lower level, upper level. The UI selected source support, reviewed the named block coordinate frame and `BM-SYNTHETIC-UI-ONLY` datum, selected all five facts with explicit reasons, queued the real geometry worker, reviewed three proposed records, and recorded them.

Read-back confirmed the original building ID plus floor `cdddf5f2-44f5-4492-a3fa-06ec51f256d6` and space `bd0cd76b-809e-4ed2-b131-6c436a62a76b`. The initial space was a 6 × 6 m authored boundary with 0–3 m limits. A separate revised levels CSV changed the proposed upper limit to 4 m. Its arrival reopened the old upper-level selection and displayed a targeted request to review the upper level. The UI explicitly selected 4 m, ran the real worker, reviewed three records with zero findings, and recorded the correction. Read-back immediately before commit still showed 0–3 m; after commit it showed 0–4 m with the same space ID at revision 2. Both CSV candidates and the earlier record remain retained. The existing physical building exterior remains 120 m² and 9 m high. The floor name is retained; no additional interior floors are inferred from exterior height.

## Browser findings and corrections

- Collapsing the explorer originally let the map auto-place into the zero-width first grid column. Explicit grid placement corrected the blank map and narrow toolbar.
- React StrictMode cleanup originally cached the untouched whole-globe camera before the first fit. Initialization now fits synchronously and only initialized block cameras are retained. An independent fresh production browser confirmed automatic Bronx62 framing without clicking Fit block.
- A rapid fact-selection click while placement was still refreshing the package received HTTP 409. The backend correctly preserved the current revision. Placement now shares the parent busy state, and a visible Refresh draft action supports stale recovery.
- Main Plan Workspace navigation now opens the selected property's preparation inside the shared block. The legacy editor is a secondary, explicitly linked action with a return to the same property.
- Investigation creation carries the relevant check ID as well as finding IDs. Source candidates expose their reference and original locator links.

## Legacy regression

Initial production browser run: seven of eight tests passed. The remaining PNG/PDF calibration test found that the new navigator reduced the reference viewport enough to clip the first control point. SourcePreview now fits the complete reference image in the available height while preserving image-to-local calibration coordinates. The focused `linked editing` calibration test then passed on the rebuilt production app (1 test, 26.5 seconds). The seven initially passing tests plus this corrected rerun cover all eight existing behaviors; the full suite was not repeated after this isolated correction.

TypeScript checks pass. Browser runs used installed headless Chromium against actual local services. Final viewport captures are listed below. Earlier diagnostic PNGs named `bronx-initial`, `bronx-fixed`, or `bronx-grid-fixed` show intermediate defects and are not acceptance evidence.


## Parcel, utility and investigation

The GIS import UI retained and recorded a synthetic 100 m² parcel and a utility alignment as separate sources in the existing block. A human-confirmed parcel association for A enabled the actual check: **20 m² outside the confirmed parcel**, with two participants and an exact geometry overlay. No assertion of legal encroachment follows from this authored fixture.

The utility is `71d3c272-7cf4-4d90-b275-60f71bf34f82`, source key `U-KNOWN`. Its source maps start/end centre levels −1.2/−2 m, 0.8 m circular diameter and `BM-SYNTHETIC-UI-ONLY`. The Section view displays the 24 m supplied alignment profile and its named reference. It explicitly says that exact circular or sloping solid volume checks are not implemented. The missing-depth fallback is implemented, but a separate unknown-depth utility was not exercised in this final browser fixture. Map controls are omitted in Section; they do not obscure its level-reference caption.

Investigation `fdb7b1e4-84dd-42fd-9814-2dd15ee27d74` / `SYNTHETIC-UI-INV-A` retains the original area revision 2, finding snapshot and two actual UI evidence requests. One request has a saved response about the authored benchmark; the second remains open, asking for independent boundary evidence before any real-world conclusion. This historical investigation is intentionally preserved after the utility source advanced the area to revision 3.

## Independent B workflow and responsive checks

A separate agent used an independent browser session and authored B-specific native CSV files. The first file lacked an upper level; Build refused the incomplete input. A separate upper-level reference supplied 3 m. The UI reviewed five native facts, placed them in the same declared frame, ran the worker, reviewed three records with zero findings, and recorded one 4 × 4 m room at 0–3 m. B retained B002 and the room is S002. B's preparation package is `0be28232-d656-4c6f-b4a4-ef571e9d45b6`.

Independent viewport checks found no page-width overflow at 1920 × 1080, mobile 390 × 844, and 1093 × 614 CSS pixels. The last is the layout-equivalent viewport of 1366 × 768 at 125%; it is **not a claim of testing native browser zoom**. Actual retained Bronx62 source framing and source identifier navigation were also verified in a fresh production session without clicking Fit block.

## Captures and reproducible inputs

Only named final or workflow captures below are acceptance evidence; older diagnostic files remain excluded.

- [Actual Bronx62 first automatic fit](evidence/ui/officer-independent-prod-first-load.png)
- [1920 viewport](evidence/ui/officer-independent-1920.png)
- [125% equivalent CSS viewport](evidence/ui/officer-independent-125-equivalent.png)
- [Mobile selected property](evidence/ui/officer-independent-mobile.png)
- [B missing upper-level question](evidence/ui/officer-independent-B-missing-level.png)
- [B recorded section](evidence/ui/officer-independent-B-recorded-section.png)
- [A source correction candidates](evidence/ui/a-source-correction-conflict.png)
- [A corrected-model review before recording](evidence/ui/a-correction-review-ready.png)
- [Exact 20 m² parcel discrepancy](evidence/ui/exact-parcel-20m2-plan.png)
- [Authored synthetic inputs and reproduction notes](../demo-data/synthetic-officer/README.md)

React best-practices review covered abort/race guards for dossier selection, lazy Cesium loading, retained camera/mesh caches, conditional section controls, and shared busy state for source/placement/build actions. A rapid source-selection-to-build click initially reached the old revision and was rejected without changing current records; Build now shares the parent busy state to prevent that avoidable race.


## Final current investigation and exports

After the revised A source, B's independent room and the utility import, the actual UI ran a fresh area check and opened `SYNTHETIC-UI-INV-A-FINAL`, ID `63143c47-3e9d-4037-88ad-29f83f5b8db6`. It captured area revision 3, the exact 20 m² finding and the current source-backed section. A request about the revised level CSV received a retained response. The correct sequence **READY_FOR_REVIEW → REVIEWED → CLOSED** completed at investigation revision 6. Attempts to skip the preceding review step were rejected and did not change the current investigation.

The UI's JSON and CSV links downloaded files, and its Print / save PDF link opened the actual report. The printable report contains the exact plan overlay, an east–west section at local northing 4 m with 0–4 m limits, source hashes, request response and decision history. JSON omits the duplicate raw register snapshot; it keeps the explicit exported register and compact check fingerprint metadata.

- [Printable report capture](evidence/ui/final-investigation-print.png)
- [Saved PDF](evidence/synthetic-final-investigation.pdf)
- [Downloaded JSON](evidence/synthetic-final-investigation.json)
- [Downloaded CSV](evidence/synthetic-final-investigation.csv)
- [Known utility section with level reference](evidence/ui/known-utility-section.png)
- [Nous missing-key state](evidence/ui/nous-missing-key.png)

The Nous panel explicitly reports that `NOUS_API_KEY` is not configured and no inference has run. The visible Suggest source facts action is disabled; an attempted browser click remained blocked. No live or cached model result is claimed. Independent test details, including actual draw-frame sampling and the distinction between native zoom and an equivalent CSS viewport, are in [Independent UI verification](OFFICER_INDEPENDENT_VERIFICATION.md).


## Reopen after all services restart with external access blocked

The lead stopped and restarted the database, object storage, broker, private processors and production web service, then reran migrations. The web process used a deliberately unreachable loopback HTTP(S) proxy while excluding local services. This browser context separately aborted external HTTP(S) requests and allowed localhost and local worker assets.

The actual UI reopened A and reran Check current area successfully: the exact 20 m² discrepancy remained. It reopened closed investigation `63143c47-3e9d-4037-88ad-29f83f5b8db6` and downloaded its JSON again. Parsed investigation, register and source arrays were identical to the pre-restart UI export. The lead's separate integrity checkpoint also confirmed the same 62 real-feature IDs, both A/B registers, closed case, and eight original-source byte hashes.

The UI then opened the saved Bronx block and attempted **Data sources → NYC building footprints → Refresh source**. The request failed visibly under server egress denial; the current area still showed **62 physical observations**. The initial generic service message was corrected to a typed upstream-source failure. A second actual UI attempt under the same blocked-server conditions displayed: “The source provider could not be reached. Open the saved snapshot, or retry when online.” The saved 62 observations remained available. This proves failure handling and saved-data retention, not successful live refresh.

- [Live refresh failed while saved data remained](evidence/ui/live-source-refresh-blocked.png)

The final focused-plan label size was measured from SVG font size × its actual screen matrix: 12.00000024 px. Labels therefore remain readable while zooming, rather than scaling as fixed metre-size text. The final screenshot returns to the full block while retaining the exact discrepancy and closed investigation. Dashed boundaries are separate scene overlays: stored group boundaries when available, otherwise the actual saved area extent explicitly labeled Analysis extent; they do not create physical records.

The final UI exports were downloaded again after the evidence-link correction. Their six-source list includes the exact associated `synthetic-parcel.json` original in addition to A's building, plan, both level documents, and reviewed derivative. The printable report retains the original closed case and its source snapshot. No geometry or investigation was recreated for this correction.

- [Final full-block plan and closed investigation](evidence/ui/final-investigation-closed.png)

Earlier intermediary map-label captures are not the final visual acceptance result.

Minor visual note: at the full synthetic block scale, the utility and B names can still overlap locally in Plan. Geometry, fixed 12 px text, full inspector names and the Labels toggle remain usable; this is a label-collision polish item, not a geometry or saved-workflow blocker.
