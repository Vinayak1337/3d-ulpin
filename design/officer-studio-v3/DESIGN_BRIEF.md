# Officer Studio — revised reference design

User steering, 20 September 2026: correct the supplied reference designs first, then continue product implementation. Original images remain unchanged at `/Users/vinayak/Downloads/3D_ULPIN_V2_REDESIGN_PACK_FINAL/images`.

## Reference audit

Reviewed all three anchors and ten named block-map/register/workspace images. Several filenames do not match the actual screen: register/01 is a detail register, register/02 is the start page, block-map/05 is the workspace start, workspace/01 is a multi-screen board. Judge the rendered image, not its filename.

1. Map shows layers and a full property list together, a selected-building photo duplicating the scene, expanded findings beneath it and repeated issues inside the inspector. Same issue appears up to four times. Collapse secondary controls and show one contextual inspector only.
2. Register repeats building statistics in left rail and top cards, evidence/issues/history in permanent right rail and tabs, plus a duplicate building photo. Give the model and floor/unit table the main area; evidence and history are tabs/drawers.
3. Workspace presents four competing primary actions, two Build details controls, two Send for Review controls, permanent comparison, extraction, measurement, floor stack and 3D preview. Show the source plus the current review decision; other tools are requested modes.
4. Start page has five overlapping actions (choose, create, add source, recent, continue), a hero, tutorial stepper and a second recent-plan list. Use one Add files action and one actionable work list.
5. Import asks file type before upload, repeats known location and offers destructive-sounding replace-by-name. Detect supported formats and metadata first; ask only unresolved questions. Explain existing-record update by identity/revision, never filename.
6. Visual claims conflict: workspace height 12.5 m is shown while warning it was not found; investigation is both In progress and Resolved; utility clearance is called horizontal while section draws a vertical arrow; parcel IDs/areas change across related screens. Revised demonstration values must agree across screens and remain explicitly fictional.
7. The screenshot's municipal identity, statutory labels, ownership and approval badges are not app capabilities or evidence. Use local demonstration context; no fake signed-in officer or approval status.

## New interaction structure

Shared navigation: Work queue / Map / Property Register. Workspace opens contextually from a queue task or selected property; it is not another duplicate home. Search remains one global retrieval control. A compact dataset/location control changes context without asking state/district again on each task.

- Work queue: one Add files primary action; search/filter; rows say property, current stage, exact next action and last updated. New users see upload and a secondary Open demonstration link.
- Add files: drop files first. Automatically read file type/page count/native spatial reference. Present a concise review of detected details; source origin and ambiguous target/meaning remain explicit. Specialist settings are collapsed.
- Workspace: stage navigation Add files → Review details → Check & record. System handles extraction between stages with progress, cancellation and retry. Wide document canvas plus focused right panel; document list is compact/collapsible. Show source-linked suggestions with one needs-review decision at a time. Group confirmed details behind a disclosure. Scale/placement unresolved is a specific task with visual control picking; no unexplained coordinate form in the ordinary view. Manual measure/compare under Tools.
- Check & record: show source/model side by side, actual blockers and concise changes; primary Record reviewed details only when checks allow it. Autosave preserves draft. This is technical recording, not legal approval.
- Map: map first, compact Layers control, quiet 2D/3D switch and navigation tools; no full property list on initial view. Selection opens one right inspector. One issues count opens focused review. Photos/history/underground tools appear when requested.
- Register: identity/header once; model + floor/unit table; one selection summary; tabs for Documents / Checks / History. Show parcel assertion distinct from 3D technical ID. Unknown quantities are unavailable. Export uses selected scope.

## Visual rules

Keep the reference's restrained forest green, near-white surfaces, quiet hairline borders and spatial legibility. Readable 14–16 px body type at desktop scale, 44 px action targets, clear labels and visible keyboard focus. No decorative coloured KPI cards, repeated hero images, floating duplicate findings trays, giant onboarding illustrations or fake official profile. Two main content columns maximum for ordinary tasks. Red indicates actual blocking findings; amber indicates needs review. Unselected geometry is subdued, selected geometry green; reserve red for a specific relevant conflict overlay.

## Consistent fictional specimen

Lake View demonstration; property Lake View Residence, 12 Lake View Road; demonstration reference LV-12 (not an officially issued ULPIN). Ground plan review: Ground floor, 4 proposed interior regions, placement pending if not evidenced; do not show unsupported height/area as established. Mockups may use a clearly labelled illustrative calculated area where helpful, but product must substitute computed current records. Images are design artifacts, never source evidence.

## Deliverables, in order

01 focused plan review; 02 decluttered map selection; 03 property register; 04 work queue; 05 file-first intake; 06 final checks and recording. Generate and review each separately. Preserve original reference files. Record prompts and outputs here. Apply this corrected specification to T064–T068 only after completing the reference pass.
