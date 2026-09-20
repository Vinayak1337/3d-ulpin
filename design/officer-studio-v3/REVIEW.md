# Reference review and implementation contract

Six revised primary screens were generated sequentially with the built-in image tool and visually inspected. Original references remain unchanged. These are proposed designs, not a claim that the live application implements them or that a model produced the illustrated results.

## Reviewed outputs

- `04-work-queue.png`: one new-work action; three attention rows match the active filter; dates and next actions are explicit. No duplicated recent-plan gallery.
- `05-add-files.png`: file-first flow; one unresolved boundary question; disabled continuation states its reason; no default EPSG form or overwrite-by-name.
- `01-plan-review.png`: source visible beside suggested values; missing levels have a specific next step; measurement/comparison are on-demand. All extracted values remain proposals.
- `06-check-and-record.png`: proposed revision explains ground-floor spaces 1→2 and total spaces 8→9; checks and explicit record action are separate from extraction. Earlier map/register represent the previous eight-space revision.
- `02-map.png`: one inspector, one checks entry, no duplicated property photo or expanded bottom findings tray; layers collapse into a control.
- `03-register.png`: two-column model/table; source, checks and history are tabs; selected space has source links. Corrected initial table heading and competing primary export styling.

Two exploratory drafts are not the approved implementation references: `01b-scale-needs-input-draft.png` and `03-register-draft.png`. User acceptance of the proposed set has not been claimed.

## Precise rules that raster mockups cannot enforce

1. Reading a dimension label alone does NOT calibrate the drawing. A usable scale suggestion must identify the exact matching pixel endpoints/page and remain subject to review. If confidence/association is missing, open visual two-point picking and the known-distance field; its Continue button stays disabled until valid. Never copy the empty-enabled button from the exploratory fallback draft.
2. Floor name from filename is a suggestion only. Use existing parsed schedule/PDF text facts and source locators where available. Do not fabricate automated OCR/AI capability; unavailable local assistance gives an honest manual path, never a paid fallback.
3. Reuse existing reviewed source facts, selected property/block and valid calibration when fingerprints and named frames match. Missing data in a new document does not automatically invalidate valid previously retained evidence or require retyping it.
4. The plan may have four interior regions but these are not automatically four ownership units. Explicitly choose, combine and classify boundaries before creating vertical spaces or rights assertions.
5. Floor elevations require a named benchmark; the final UI must show it beside 0.00–3.00 m (the specimen may use `LV-BM`, explicitly fictional). The generated model is a composition reference only; actual implementation renders exact retained geometry and uses actual levels. Source geometry must never be replaced with the generated architectural illustration.
6. The map mockup's car-shaped glyph beside “8 recorded spaces” is not the intended semantic icon. Use the existing generic space/grid icon; a car icon is reserved for recorded parking spaces.
7. The source-linked candidate review must allow individual acceptance/rejection and conflict resolution. One “Confirm details” action may group explicitly selected consistent suggestions, but cannot silently accept every result or cross-source conflict.
8. The final Record action uses actual persisted validation and current fingerprints. Stale model, changed source/placement, blockers or absent benchmark disable recording and identify the next action. A suggested review note is editable and never becomes an officer declaration without explicit review.
9. Every original/history/revision/identifier/export capability remains accessible. Checks combines compact findings presentation; deeper evidence review and retained correction tools are contextual panels, not removed capabilities. Utility section labels distinguish horizontal clearance from vertical depth; no invented regulatory clearance limits.
10. Responsive behavior: at tablet width keep one context panel at a time and remove empty grid rails. On narrow widths use one column and document/model switcher, readable labels and touch targets. Keyboard can open/close panels and return focus. These requirements need browser testing in the app; raster previews do not prove accessibility.
11. Upload cancellation removes staged selections, not retained source revisions. Retried processing reuses identity and shows failures individually. Mixed file intake routes each supported profile through its real ingestion path.
12. Shared search wording is “Search records and work” in the corrected family. Search implementation must actually support the advertised scope; otherwise label the real scope honestly. Work queue is the proposed default pending the user's optional preference; Map remains a top-level destination.

## Proposed workflow

Add files → read available metadata/structured details → review only uncertain or missing information → inspect the proposed model and checks → explicitly record → inspect/export the selected record. Autosave and persisted processing state support leaving and resuming every step.

## Product implementation sequence

Do not collapse T064–T068 into a single redesign commit. Apply file inspection/intake first, then persisted guided preparation, then source-led extraction, then map/register visual hierarchy, then old-component cleanup and full verification. T063 is already complete and preserved. Reference changes alter the intended start from the temporary saved-block landing to the work queue if that direction is retained.
