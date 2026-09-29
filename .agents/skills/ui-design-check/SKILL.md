---
name: ui-design-check
description: Check changed 3D ULPIN web UI against docs/design-system before handing it off, and report the findings. Trigger when a change adds or edits screens, components or CSS under apps/web (tsx/jsx/css), or when asked to review or polish UI. Do not trigger for backend, data, migration or docs-only changes. Report first; edit only after approval.
---

# UI design check

Compares a UI change with the repository design language and returns a findings report. It does not redesign screens or introduce a new visual style.

## Inputs

- The change: the working tree against `git merge-base HEAD staging`, or a base ref the user names.
- The rules, read only when a finding needs them:
  - `docs/design-system/README.md`: principles, content rules, tokens, shape lock, icons, accessibility
  - `docs/design-system/components.md` and `reference/components.css`: component anatomy
  - `docs/design-system/surfaces-and-layout.md` and `map-and-3d.md`: frame, panels, scene
  - `AGENTS.md`: current UI delivery scope and official-source data rules
  - `apps/web/AGENTS.md`: Next.js version rules, before any code change

## Steps

1. Run the mechanical scan from the repository root:
   `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs [base-ref]`
   It lists added lines in `apps/web` that use literal colours or fonts, `lucide-react`, placeholder images or names, provenance words the product bans, or theme-switch code. Exit 1 means it found candidates. Each one still needs your judgement.
2. Read each changed screen or component and check the rules the scan cannot see:
   - `--ui-*` tokens only. Radii follow the shape lock. Never a border, a shadow and a tinted fill on one element.
   - Status words come only from the fixed list. Sentence case. Units always shown. Identifiers in mono and copyable.
   - Every value on screen is read from a record. No hard-coded sample content and nothing copied from the mockups.
   - Unknown, absent, withheld and conflicting values stay distinct. Unknown shows as *Unknown*, never blank or 0.
   - One inspector per selection and one primary button per view. No fact repeated in two places on one screen.
   - Desktop, light mode only. No theme switch, no new dark or mobile variants. Keep existing tokens and responsive code.
   - Keyboard reachable, visible 2 px focus, icon-only buttons have `aria-label`, readable at 200 % zoom.
3. Write the report and stop. Ask before editing anything.

## Output

A report grouped as **Blocking** (breaks an AGENTS.md rule: invented data, a banned provenance label, a theme switch), **Design system** (token, shape, copy or component drift) and **Checked, no issue**. Each finding gives `file:line`, the rule it breaks with a link to the doc section, and the smallest fix. End with the scan command and its exit status.
