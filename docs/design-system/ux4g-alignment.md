# UX4G and GIGW alignment

UX4G (User Experience for Government, a MeitY Digital India initiative) is our foundation: its type scale, spacing grid, radius scale, colour roles and citizen patterns. GIGW 3.0 (Guidelines for Indian Government Websites and Apps) with WCAG 2.1 AA is the review target. The component versions referenced here are the 3.1 components in the MIT-licensed [UX4G `web_design_system` repository](https://github.com/ux4g-negd/web_design_system); the public UX4G site may still label the kit 3.0.

Using UX4G guidance is not a claim of government approval, affiliation, STQC certification or full conformance.

## What we take, and how

| Area | Finale Studio | Portal (FP-PUBLIC) |
| --- | --- | --- |
| Tokens | Transcribed into `--ui-*` ([tokens.css](tokens.css)) | Same tokens |
| Components | **Do not install the UX4G CSS or JS bundle.** It ships a global reboot and scripts that conflict with the Studio | UX4G components allowed only under `/public/*`, with their styles scoped to those routes and themed by our tokens |
| Type | Noto Sans, UX4G's family; Studio uses a compact 15 px body | UX4G Portal scale, 16 px body minimum |
| Patterns | Status vocabulary, form anatomy, error summaries | Search and discovery, application submission, status tracker, consent and declaration, identity access, language switch |

## Theme mapping (for the Portal kit)

| UX4G token | Our token | Note |
| --- | --- | --- |
| `--ux4g-color-primary-600` (default purple) | `--ui-primary` | The purple default is never used |
| `--ux4g-color-primary-700` | `--ui-primary-hover` | |
| `--ux4g-color-primary-50` | `--ui-primary-soft` | |
| `--ux4g-text-neutral-primary` / `-secondary` / `-tertiary` | `--ui-ink` / `--ui-ink-soft` / `--ui-muted` | Our muted keeps 5:1 |
| `--ux4g-text-status-*` | success, danger, warning, info | |
| `--ux4g-font-family-base` | Noto Sans | Self-hosted |
| `--ux4g-radius-md` | 8 px | Scales already match: 8, 12, 16, pill |
| `--ux4g-space-*` | `--ui-space-*` | Same 4 px grid |
| Dark theme attribute | `data-theme="dark"` | Same attribute |

## Components we add

UlpinCode, LevelRail, StrataSection, MapToolbar, LayerPanel, Legend, MapStyle, Inspector, EvidenceChip, ReadinessMeter, FindingCard, ShareLedger, CarpetAreaCheck, DigColumn (impact screening), ImportStream, RevisionTimeline, PropertyCard, StudioHeader. UX4G has no map, 3D, evidence or cadastral components, so these follow its tokens, spacing and states. See [components.md](components.md).

## Checklist

- GIGW 3.0 and WCAG 2.1 AA on every surface; Portal body text 16 px.
- Accessibility bar on every Portal page; language choice persists.
- DPDP Act 2023 notice and consent before any personal upload, showing purpose and retention (H13 Z1).
- Every map view has a list or table alternative.
- No emblem, seal, signature or imitation of a government identity.
- Hindi strings are reviewed translations with correct `lang` attributes, never machine output shown as property facts.
