# Design mockup: Officer Studio, Verify, Portal and Admin

This folder is the team's interactive design mockup, exported from Claude Design (project "Officer Studio mockups transfer", `OfficerStudio.dc.html`) on 26 September 2026. **Agents follow it for how the product looks and behaves:**

- layout and spacing;
- panels, dialogs and the inspector;
- the 3D map's look per mode;
- interactions and camera behaviour;
- screen states;
- wording.

## Open it

The pages load React, Babel and Three.js from a CDN, so they need a network connection. Serve this folder and open the wrapper page:

```bash
python3 -m http.server 8765 --directory design-mockup
```

Then open `http://127.0.0.1:8765/OfficerStudio.dc.html` in a desktop browser. The two tabs at the top switch between the pages below.

| Page | What it shows |
| --- | --- |
| `Officer Studio.html` | The interactive Studio: Batches, Add files, live import, area map, building and floors, underground, evidence viewer, findings, workspace review and check, assign dialog, register, deviation check, Property Card and the local verify page |
| `Portal Admin and Phone.html` | A canvas of boards: Portal P1–P7, Admin A1–A7, Studio S15–S19 (full product) and phone views |

The Studio's Tweaks panel switches screen states: Default, Empty, Loading, Stale, Error, Snapshot, No 3D, Replayed, Restricted and Mapping unavailable. Claude Design opens it from its toolbar; standalone, open `Officer Studio.html` directly and run `postMessage({type: '__activate_edit_mode'}, '*')` in the browser console.

## Where each screen is, and what builds it

Open the Studio tab of `OfficerStudio.dc.html`. The IDs are the plan's screen IDs ([H99](../docs/usp-agent-handoffs/99-ui-ux-and-integration.md) Z3); cards are in [H29](../docs/usp-agent-handoffs/29-agent-task-cards.md); the per-screen bindings are in [screens.md](../docs/design-system/mockups/officer-studio/screens.md).

| Screen | How to reach it in the mockup | Card and gate |
| --- | --- | --- |
| Frame: top bar, scope strip, left panels, toolbar, level rail, legend, readout, tray | Map page; Layers, Spaces, Sources and Checks in the scope strip; More and language menus in the header | UI-01, UI-02 (GF2) |
| S1 Batches | **Batches** in the top bar | UI-04 (GF2) |
| S2 Add files | **Add files** in the scope strip or on Batches | UI-04 (GF2) |
| S3 Live import on map | Add files → **Start import** | UI-04 (GF2) |
| S4 Area map | **Map** in the top bar, building selected | UI-03, UI-04 (GF2) |
| S5 Building and floors | Click the selected building or **Explore floors**, pick a level on the rail, click a unit | UI-03, UI-04 (GF2); UI-05 refinements |
| S6 Underground and impact screening | Underground or Impact screening in the map toolbar, or Layers → Colour by Utilities | UI-05 (GF3) |
| S7 Evidence viewer | In a unit's inspector, click the area evidence chip | UI-05 (GF3) |
| S8 Findings review | The findings badge in the building inspector, or a row in the Checks panel | UI-05 (GF3) |
| S9 Workspace: review details | Batches → a row at stage *Review details* | UI-04 (GF2) |
| S10 Workspace: check and record | Batches → a row at stage *Check and record*, or the workspace stage bar | UI-04 (GF2) |
| S11 Assign proposed 3D ULPIN | A reviewed unit's inspector → **Assign code** | UI-04 (GF2) |
| S12 Property register | **Register** in the top bar | UI-05 (GF3) |
| S13 Deviation check | Register → **Deviation check** | UI-05 (GF3) |
| S14 Property Card | After assigning, **Make Property Card** in the toast, or Register → **Property Card** | PACK-01 with UI (GF4) |
| P4L Verify card, local link | Property Card → **Open local link** | PACK-01 with UI (GF4) |
| Screen states | Tweaks panel (below) | Every UI card; UI-08 for provenance badges |
| Enhanced view | Not in the mockup yet | UI-09 (GF2), [H30](../docs/usp-agent-handoffs/30-reference-scene-and-incomplete-data.md) C |
| P1–P7, A1–A7, S15–S19, phone views | The **Portal, Admin, phone and full-product boards** tab | Full product; phone views out of current scope |

The six-minute demo ([H24](../docs/usp-agent-handoffs/24-product-method-and-ppt.md)) follows the same path through the mockup: S1 → S2 → S3 → S9 → S10 → S8 → S5 → S11 → S13 → S6 → S14 → P4L. UI-07's scripted journeys follow it too.

## What to follow and what not to copy

**Follow:**

- the visual design;
- component choice and composition;
- layout sizes and floating map chrome;
- the interaction model (selection, Escape, camera eases);
- how each state looks;
- the fixed wording.

The same rules are written out, per screen and bound to data, in the [mockup reference](../docs/design-system/mockups/officer-studio/README.md) and its [screens](../docs/design-system/mockups/officer-studio/screens.md).

**Do not copy, whatever the mockup shows:**

- **Data.** Every name, code, number, file name, date and person is a design example. Screens show only values read from records, through the [view model schema](../docs/design-system/mockups/officer-studio/view-model.schema.json). The "Design mockup" badge exists only here; the product shows the dataset's recorded classification (AGENTS.md).
- **Code.** This is prototype code: in-browser Babel, inline styles, `localStorage`, simulated timers and a Three.js scene (`scene.js`). Build in `apps/web` on the shared Cesium map path with the repository tokens and components ([design system](../docs/design-system/README.md)).
- **Out-of-scope variants.** The product ships desktop-first and light-mode only (AGENTS.md, 25 September 2026). Ignore the mockup's dark-theme toggle and phone boards for now.
- **Full-product screens.** Portal, Admin and S15–S19 are full product. Build them only under their gates.

The plan still governs:

- routes, selection and acceptance come from [H99](../docs/usp-agent-handoffs/99-ui-ux-and-integration.md);
- tokens and components come from the [design system](../docs/design-system/README.md);
- features and tests come from the handoffs and [H29](../docs/usp-agent-handoffs/29-agent-task-cards.md) cards.

Where the mockup disagrees with them, the plan wins; note the difference in your receipt. The Enhanced view ([H30](../docs/usp-agent-handoffs/30-reference-scene-and-incomplete-data.md) C) has no mockup yet.

## Files

| Path | Role |
| --- | --- |
| `OfficerStudio.dc.html` | Wrapper with the two tabs (uses `support.js`, the Claude Design runtime) |
| `Officer Studio.html`, `app.jsx`, `screens.jsx`, `studio-panel.jsx` | The interactive Studio |
| `Portal Admin and Phone.html`, `boards.jsx`, `fp-portal.jsx`, `fp-admin.jsx`, `fp-studio.jsx` | Board canvas |
| `scene.js` | The mockup's Three.js scene (look only; the product uses Cesium) |
| `tweaks-panel.jsx`, `ds-base.js`, `support.js` | Claude Design helpers |
| `_ds/bhuaayam-…/` | The design-system bundle the pages load (`_ds_bundle.js`, `_ds_bundle.css`, `styles.css`, lint rules for component props) |

**Differences from the Claude Design export:**

- The badge text "Fictional demonstration" became "Design mockup".
- The UI brief upload and the bundle's README and manifest were left out. The maintained brief is [ui-brief.md](../docs/design-system/ui-brief.md), and it has no sample data.

Otherwise the files are byte-identical to the export. The bundle matches the team design system's synced copy.
