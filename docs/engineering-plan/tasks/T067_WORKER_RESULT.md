# T067 visual hierarchy worker result

Implemented scoped map, register and workspace hierarchy on 20 September 2026. Parent production build, browser capture and acceptance review are pending. This report does not claim visual or user acceptance.

## Changes

- Canonical map: requested Layers / Properties dialog instead of a permanent left rail; one right inspector or Checks panel, with the existing finding selection, check execution and conflict overlay controls. Removed duplicate building scene inside inspector. Documents, photographs, parcel assertions, history, floor/unit inspection and property PDF remain accessible. Underground and labels live in Layers. Checks and inspector close actions return keyboard focus to their map controls.
- Register: defaults to Floors & spaces; removed the entire repeated identity/metric/sidebar scene and its empty tablet grid column. Model and floor/unit table use the main two columns. Documents, Checks, History, Property details and Investigation remain direct tabs. Selected record original-source links remain immediately visible; identifiers, actual geometry values, benchmark, recorded rights and selected-scope downloads remain under Record details, rights & downloads.
- Retained local-frame register: documents/rights, history and spatial inquiry are requested disclosures. Corrections and reviewed recording stay unchanged.
- Workspace: defaults to Review details, with the source canvas and a single review/tool panel. Documents opens a native dialog; Measure, Calibrate and Compare are requested through Tools. Clear/Ctrl+Q keeps the existing scoped handler. Removed the duplicate exterior preview/floor strip; every floor source remains in Documents. Existing source/page URL selection stays intact. Internal upload dialog replaced with unified Add files link carrying area/building/case. Computed model wording is neutral across proposal and recorded states.
- Fictional Studio map: layers/properties/findings use the existing focus-managed dialog; no permanent left rail, duplicated inspector preview, bottom findings dock or duplicate utility section. The same check findings remain in one inspector disclosure; minimap is requested through Overview. Source receipts are under processing details. Geometry, scene controls and canonical/fictional identities are untouched.

## Files owned by this worker

`apps/web/features/officer/block/{BlockPage.tsx,BlockRails.tsx,FindingsTray.tsx,block.css}`

`apps/web/features/officer/register/{RegisterPage.tsx,Floors.tsx,RetainedRegister.tsx,register.module.css}`

`apps/web/features/officer/workspace/{WorkspacePage.tsx,Workspace.module.css}` and one neutral model-label edit in `BuildPanel.tsx`.

`apps/web/features/studio/{App.tsx,hierarchy.css,components/Inspector.tsx}`

Inherited dirty T060–T066 changes were preserved. No backend, geometry/compiler, global navigation/header/routes, builds, server restarts or commits were performed.

## Verification

- Web TypeScript check passed after all structural changes.
- 73 focused regressions passed: `v2-state`, `v2-geometry`, `register-scope`, `studio-continuation`, `studio-routing`, `preparation-continuation`, workspace `measurement`.
- Scoped `git diff --check` passed.
- Reviewed changed React structure against the frontend, redesign and React best-practices skills: no new request waterfalls, duplicate model removed, semantic native select/disclosures, existing dialog focus trap/return retained, selected identities and source bindings preserved.

## Parent browser gate

Capture canonical map unselected/selected and Checks, register desktop/tablet floor/unit selection plus exact source/export, workspace desktop/tablet default review plus Documents focus return and Tools modes. Confirm 800px workspace breakpoint and 720px canonical map/register breakpoint. Exercise retained corrections/history/inquiry. Capture fictional map Layers Escape focus return, one checks disclosure and optional Overview minimap. Parent may adjust visuals based on actual production screenshots; this worker intentionally did not start or rebuild a server.

Primary selector changes: register default tab is now Floors & spaces; Evidence → Documents and Issues → Checks; workspace default mode is build/Review details, with manual mode selected via `select[aria-label="Workspace tools"]`; source picker is Documents; fixture side controls appear in Map controls dialog only.
