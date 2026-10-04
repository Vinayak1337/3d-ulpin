# P6 — Govern: readiness, carpet area, deviation, underground

Goal: the "Govern" part of Identify → Prove → Govern. Every check runs only where the sources support it, and otherwise says `not_assessed` or `not_comparable` with the reason. That honesty is a feature to show, not a gap to hide.

---

## P6.1 Readiness per building and work item

**Gate:** GF-READY · **Depends:** P5.1–P5.4 · **Owner:** backend

```text
Compute readiness as an API projection (no new store): for a building/unit, which requirements are met
(footprint reviewed, level schedule reviewed, spaces delineated, identity assigned, geometry qualified,
documents linked, conflicts resolved or acknowledged), each with its evidence link, state and the next action.
Stale evidence (source revision changed after review) -> needs_review.
Expose GET /buildings/{id}/readiness and add readiness to GET /work-queue items (the Studio's Batches column).
```

**Expect back:** readiness for the demo building that explains what's missing in plain words, plus `work-queue` items carrying their next action.

---

## P6.2 RERA carpet-area check (component ledger)

**Gate:** GF-T17 · **Depends:** P4.3, P5.2 · **Owner:** backend/domain

```text
Implement H27 §D: CarpetComponent ledger (net_usable, internal_partition, external_wall, service_shaft,
exclusive_balcony_or_verandah, exclusive_open_terrace, other_or_unknown) per unit and revision; CarpetCheck
compares the computed RERA s.2(k) carpet area with the declared value from the RERA document (with citation).
- If external walls/shafts/terraces can't be separated -> not_assessed (no generic footprint fallback).
- A different area definition or revision -> not_comparable.
- A difference beyond the frozen tolerance -> review_finding, never a violation.
Hand-calculate one real unit's expected value before running (from the plan's dimensions), commit it, then run.
```

**Expect back:** one real unit with a computed vs declared comparison and its hand calculation, plus one honest `not_assessed` case.

---

## P6.3 Sanctioned vs observed deviation

**Gate:** GF-T19 · **Depends:** P4.2, P5.1 · **Owner:** backend (HISTORY)

```text
Compare a sanctioned plan (documents/plan revision) with observed geometry (imagery roofprint, LiDAR/DEM
height) for the same building, only where both support the same quantity:
- storey count (reviewed schedule vs any observed estimate, flagged as estimate), height (LoD1.2 roof height
  vs stated height, in a named vertical reference), footprint extent (sanctioned outline vs reviewed roofprint,
  remembering roofprints include projections).
- Registration uses recorded controls, never best-fit to hide a deviation; report uncertainty bands.
- Missing control/datum/phase, or a source-only image -> not_comparable / not_assessed.
- Rooftop structures (mumty, water tanks, lift rooms) don't count as storeys.
Persist as findings with both sources cited.
```

**Expect back:** a deviation result for the demo building (or `not_comparable` with exact reasons), shown in the deviation split view's data.

---

## P6.4 Underground screening with explicit unknowns

**Gate:** GF-T20 · **Depends:** P3.2 · **Owner:** backend (IMPACT)

```text
Promote the existing IMPACT0 screening to the canonical area: utility features with depth bands (lowerM/upperM)
and quality/coverage; areas with no survey are explicit "No survey" polygons. A dig/plan polygon returns
intersecting utilities, unknown-depth utilities and no-survey coverage. It is a screening report, never
clearance. If no permitted utility data exists for the demo area, return coverage none with that reason.
```

**Expect back:** a screening result for a polygon in the demo area. "No survey" here is an acceptable, honest result.
