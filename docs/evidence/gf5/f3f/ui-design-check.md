# UI design check: F3f (draft wording, registry cards from the map inspector, copyable card id)

Change checked: `task/f3f-draft-wording-map-cards` against its branch point `e434ab64` (the Studio files under
`features/identity`, `features/verify`, `features/map/inspector/SpaceInspector.tsx`, `features/map/MapWorkspace.tsx`,
`portal/RecordPage.tsx`, `local/routes.ts`). Screens were read in the code and in the screenshots beside this file,
taken at 1440 px and at 200% zoom.

The scan script reads only `apps/web`, so it saw no line of this change. Its six patterns were also run by `grep`
over the 242 lines this change adds under `apps/studio`: no match.

## Blocking

None.

## Design system

1. **A printed draft card still labels its code "Assigned".** `packages/ui/src/components/PropertyCard.tsx:22`
   renders `UlpinCode` without a state, so the card of `features/identity/CardDialog.tsx:50` and of
   `portal/RecordPage.tsx:85` prints "3D ULPIN (proposed) · Assigned" above the row "Record: Draft on this device,
   not a registry record" (`local-layer-11-portal-record-printed-card.png`). Rule: status words say what the record
   states, [Content rules](../../../design-system/README.md#content-rules). `packages/**` is read-only for this
   task. Smallest fix: a `state` prop on `PropertyCard`, passed to `UlpinCode`; the two callers pass `draft`.
2. **The map inspector at 200% zoom.** In a 720 x 450 CSS px window the inspector is 197 px high: its header takes
   158 px, its rows get 32 px (their own padding, so no row shows) and 25 of the 40 px of Property Card are in view
   (`07-zoom-200-map-inspector-registry-card.png`; `browser-result.json`, `zoom.inspector`). The action opens with the
   keyboard. Rule: readable at 200% zoom, [Accessibility](../../../design-system/README.md#accessibility). The height
   comes from `features/map/MapWorkspace.module.css:12` (`max-height: calc(100% - 80px)`) and the grid of
   `features/map/inspector/Inspector.module.css:1`, neither owned by this task. Before this change the same window
   showed the action whole and cut 64 px off the right of every line; see finding 3. Smallest fix: let the header
   scroll with the rows (one scrolling region above the actions) in `Inspector.module.css`.
3. **Inline style for a wrap.** `features/map/inspector/SpaceInspector.tsx:130` sets `overflowWrap: 'anywhere'` on
   the record identifier. Without it an identifier with no break (Tower 3: `…:B001:F001:S001`) made the inspector's
   one grid column 384 px wide inside a 352 px panel (320 px at 200% zoom), so the status badge and every line of
   the body were cut on the right; the new refusal sentence lost words at 1440 px. Rule: styles in the stylesheet.
   Smallest fix: `.subtitle { overflow-wrap: anywhere; }` in `Inspector.module.css` (not owned) and drop the inline
   style.
4. **One fact stated more than once.** With a browser code the inspector says draft three times
   (`SpaceInspector.tsx:127` header, `:141` the code label, `:142` the sentence), and the portal record page says it
   in the code label, the notice and the button (`portal/RecordPage.tsx:56,59,77`). Rule: no fact repeated on one
   screen, [Principles](../../../design-system/README.md#principles). Kept on purpose: the label is `UlpinCode`'s
   own, the sentence is the one this task asks for, and the header would otherwise read "Assigned" above it.
5. **Words outside the fixed status list.** "Draft revision rN on this device" (`features/identity/draft.ts:21`,
   the task's wording) and the row value "Listed by the registry" (`SpaceInspector.tsx:101`). Rule: fixed status
   words, [Content rules](../../../design-system/README.md#content-rules). Neither is drawn as a status badge; the
   header badge uses the fixed word *Draft*.
6. **The shared copy control clips its focus ring.** `packages/ui/src/styles/components.css:96` gives `.ul-code`
   `overflow: hidden`, and the focus outline of `.ul-code__copy` is drawn 3 px outside it. On the new card id control
   only the left edge of the ring showed; `features/verify/VerifyPage.module.css:14` now draws that ring inside
   (`08-zoom-200-verification-copy-card-id.png`). `UlpinCode` and `review/recorded/AssignedCode.tsx` use the same
   classes and were not changed (read-only); their rings were not captured. Rule: visible 2 px focus. Smallest fix:
   the inset ring in `components.css`, then drop the local rule.

## Checked, no issue

- Tokens: the two new rules in `VerifyPage.module.css` use `--ui-surface-subtle`, `--ui-ink` and
  `--ui-border-strong`; no literal colour or font. The neutral result has a border and a tinted fill, no shadow.
- Components: `Banner`, `StatusBadge`, `UlpinCode`, `DescriptionList`, `Toast` and `PropertyCard` from `@ulpin/ui`
  as they are; the copy control is the `ul-code` markup the Studio already uses.
- Every value on screen is read from a response or from this browser's store: the Cards row is shown only when the
  card list names a snapshot; the draft line takes its revision from the stored draft. Nothing is copied from the
  mockups.
- Unknown stays distinct: a refused card read and a search that stopped short are stated with the server's code or
  the reason, and neither becomes "no card"; while the registry has not answered, the browser's own step is disabled.
- Registry and draft are told apart in the inspector: the registry fact is a plain row ("Cards: Listed by the
  registry"), the draft is a code labelled Draft with the sentence under it
  (`05-live-map-inspector-draft-and-registry.png`).
- One primary button per view: the inspector shows Property Card or the browser's own step, never both.
- Light mode only; no theme code; no mobile variant added.
- Keyboard: the copy control and Property Card are buttons in tab order; Enter copied the card id and opened the
  cards dialog at 200% zoom. The icon-only copy control has an `aria-label` that names the card id.
- 200% zoom (720 CSS px): no horizontal page scroll on the verification page, the draft verify page or the portal
  record page (0 px overflow each); the inspector no longer overflows its width (0 px).

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs` → "0 added line(s) in apps/web. No candidates.",
exit 0.
