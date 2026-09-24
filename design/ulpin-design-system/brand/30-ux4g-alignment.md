# UX4G alignment

Use UX4G 3.1 (npm `ux4g-web-components`, MIT) for Portal page patterns and standard form controls, themed with these tokens and scoped to Portal routes (never installed into the Studio, because it ships a global reboot and scripts); use this system's own components for anything spatial or record-specific.

## Theme mapping

| UX4G token | Set to | Note |
| --- | --- | --- |
| `--ux4g-color-primary-600` (brand purple) | `primary` | Re-theme with UX4G Theme Craft; the purple default is not used. |
| `--ux4g-color-primary-700` | `primary-hover` | |
| `--ux4g-color-primary-50` | `primary-soft` | |
| `--ux4g-text-neutral-primary` | `ink` | |
| `--ux4g-text-neutral-secondary` | `ink-soft` | |
| `--ux4g-text-neutral-tertiary` | `ink-muted` | UX4G's neutral-500 is lighter; `ink-muted` keeps 5:1. |
| `--ux4g-text-status-success`, `-error`, `-warning`, `-info` | `success`, `danger`, `warning`, `info` | |
| `--ux4g-font-family-base` | `Noto Sans` | Same family UX4G ships. |
| `--ux4g-radius-md` (8px) | `radius-8` | UX4G's scale already matches 8, 12, 16 and pill. |
| `--ux4g-space-*` | `space-*` | Same 4px grid. |
| Dark theme `:root[data-theme="dark"]` | This system's dark values | UX4G uses the same theme attribute. |

## Components taken from UX4G

Accessibility Bar, Navbar, Footer, Breadcrumb, Search, Input-Textfield, Input-OTP, Combobox, Select, Checkbox, Radio, Toggle, Date Picker, File Upload, Stepper, Journey Timeline, Status Pipeline, SLA Progress Indicator, Alert, Modal, Drawer, Tabs, Tables, Pagination, Tooltip, Empty State, Feedback. Use them as they are, themed; don't restyle their structure.

UX4G patterns used on the Portal: Search and discovery (property search), Application submission (evidence or correction request), Status tracker (my requests), Consent and declaration (DPDP consent before upload), Identity access (sign in), Language switcher.

## Components added here

UlpinCode, LevelRail, StrataSection, MapToolbar, LayerPanel, Legend, MapStyle, Inspector, EvidenceChip, ReadinessMeter, FindingCard, ShareLedger, CarpetAreaCheck, DigColumn, ImportStream, RevisionTimeline, PropertyCard, StudioHeader. UX4G has no map, 3D, evidence or cadastral components, so these follow its tokens, spacing and states instead.

## Compliance checklist

- GIGW 3.0 and WCAG 2.1 AA on every surface; body text 16px on the Portal.
- Accessibility bar on every Portal page; language switch persists.
- DPDP Act 2023 consent step before any personal upload; show purpose and retention.
- Every map view has a list or table alternative.
- No fake official identity: no seal, emblem or signature unless the department supplies it.
