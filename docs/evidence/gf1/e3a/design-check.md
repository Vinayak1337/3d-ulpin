# E3a UI design check

## Blocking

None in the delivered screen. No invented value, geometry, theme switch or copied reference content. Product completeness remains blocked by the response gaps in `step0.json`; this is not a passed GF1/GF5 gate.

## Design system

- Fixed the actual 200% tray finding: file names and byte counts were squeezed into fragments. `Batch.module.css:42–65` now preserves column widths inside a keyboard-focusable horizontal scroll region. The layout question wraps into two columns. The existing shared header still creates document-level horizontal overflow at 200%; outside this task's owned paths.
- The unavailable action has a visible sentence explaining the missing destination/current-layout reads (`LayoutQuestion.tsx:19–25`). Buildings is explicitly a supported layout option, not an inferred fact about the sidewalk file.
- Plain task-specific intake words follow the task's wording requirement; stored `limitReason` is not rewritten. Unknown counts, sizes, coordinate system and extent say “Not known”, never zero.

## Checked, no issue

- `IntakeDropDialog.tsx`, `BatchPage.tsx`, `IntakeTray.tsx`, `LayoutQuestion.tsx`: shared Dialog/Button/DataTable/Banner/Skeleton, visible labels, one primary action, no new icon set, no colour-only status. Table paths were reused without editing `table/**`.
- New CSS uses existing surface, border, spacing and 12px-radius tokens; no border/shadow/tint stack, new font, colour literal or animation.
- Real browser: Tab from the focusable tray reaches both row controls then the identifier select; 2px focus outline recorded. Native select responds to ArrowDown. 200% screenshot captures are listed in `runtime-visual-final.json`; text and controls remain reachable by scrolling.
- Delivered light-token contrast calculated from `packages/ui/src/styles/tokens.css`: ink/surface 15.42, ink-soft/background 9.34, muted/surface 5.60, muted/background 5.20, primary/surface and on-primary/primary 8.75, warning/warning-soft 6.22. Disabled action is explicitly unavailable.

Skill scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit 0, but scans only `apps/web`. Reused those exact rules, retargeted without modifying the shared skill: `node docs/evidence/gf1/e3a/studio-design-scan.mjs staging` — exit 0, no candidates. This report includes manual Studio review, not a claim based on the legacy-only scan.
