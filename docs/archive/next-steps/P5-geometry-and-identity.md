# P5 — Levels, 3D spaces, topology, identity and exchange

Goal: turn reviewed footprints and level evidence into **3D spaces** (vertical delineation), check them (topology), give them **proposed P3 identities**, and export them as **CityJSON with real geometry**. All of this is deterministic; nothing here is learned.

---

## P5.1 ⭐ Reviewed level schedule

**Gate:** GF-T16 prerequisite, GF-SCENE · **Depends:** P4.4 (or a manual entry), P3.1 · **Owner:** backend

```text
A building's levels come from a REVIEWED level schedule, never from a guess.

- LevelSchedule: ordered levels {levelId, label literal, kind (basement|stilt|podium|floor|mezzanine|terrace|
  roof|other), lowerM?, upperM?, heightSource (stated|derived|unknown), citations[], revisionId}.
- Sources: storey candidates (P4.4), IFC storeys (P3.2), or officer entry with a citation; conflicts are kept
  and the officer picks one (with reason) or leaves the schedule "conflicting".
- Heights: stated floor-to-floor heights accumulate from a stated base; otherwise lowerM/upperM stay null.
  Nothing is filled with a typical 3 m. An explicitly labelled estimate is a separate field and never feeds
  measurement.
- Expose through /buildings/{id}/canonical storeys/levels. Review via existing registry commands.
Real case: Tower 3 (conflict) and one IFC building (stated elevations).
```

**Expect back:** level schedules for the two real cases, one conflicting and one with stated elevations, visible in the canonical record.

---

## P5.2 ⭐ Vertical delineation: prisms per level and space

**Gate:** GF-T16, GF-T18 · **Depends:** P5.1, P4.5 · **Owner:** backend/geo (owns the geometry seam)

```text
Build reviewed 3D spaces from reviewed 2D boundaries and level limits (H27 §B "Vertical delineation").
- Input: reviewed footprint or unit/room polygon (local metres), level lowerM/upperM, vertical reference.
- Output: a prism per level per space; multi-level units (duplex) keep one identity with components; basements
  use their own level polygons; stilt levels are open.
- Unknown limits -> the space exists in 2D with height state unknown; no extrusion.
- Extend services/geo/geo/geometry.py's single-ring prism to multipolygons with holes and multiple components;
  validate (closed, positive volume, valid rings); invalid -> unsupported with a reason, never zero.
- Compute area and volume with exact arithmetic where inputs are exact; record the method version.
Check by hand on 3 cases written before the code (DATA-08 style): a rectangle, an L-shape with a courtyard
hole, a duplex with an empty intermediate slab.
```

**Expect back:** prisms for the demo building's reviewed spaces, three hand-calculated cases that match, and invalid inputs ending as `unsupported`.

---

## P5.3 ⭐ Geometry qualification producer and CityJSON with real vertices

**Gate:** GF-EXCHANGE · **Depends:** P5.2 · **Owner:** backend (registry/geometry/exchange seams)

```text
Close backend gap 2 (docs/evidence/usp/backend-gap-audit-20261002.md): no qualify_geometry receipt producer
exists, and POST /api/v1/usp/exchange/cityjson/export emits vertices: [].

1. Implement the minimal producer: for a reviewed prism revision, run validity (ST_IsValid on rings; closure
   and orientation checks; optional val3dity if installed), frame check (area frame declared, transform
   recorded) and topology pre-checks (P5.4), then write the accepted receipt that
   database/sql/60-usp/09-geometry-schema.sql expects, bound to the exact revision and source pins.
   Keep every existing guard.
2. Make the CityJSON 2.0 export emit real vertices (transform/scale/translate from the area frame), semantic
   surfaces, LoD 1.2 (or 2.2 where present), building -> BuildingPart/BuildingStorey/BuildingUnit hierarchy,
   plus the rights/provenance sidecar and loss report (what was withheld or unsupported).
3. Round trip: export -> validate with cjio/cjval -> re-import -> compare vertices/attributes; differences go
   to the loss report.
```

**Expect back:** a CityJSON file of the demo building that validates and opens in a CityJSON viewer (ninja or similar), plus the round-trip comparison and the loss report.

---

## P5.4 Topology checks (deterministic, explainable)

**Gate:** GF-T18 · **Depends:** P5.2 · **Owner:** backend/geo (FIND)

```text
Checks over a building's reviewed spaces, each giving a finding with participants, volume/area, reason and
source coverage:
- exclusive-unit overlap with positive volume (contact/touching is not overlap);
- space outside its building envelope (only where a complete, source-supported envelope exists);
- gaps in a claimed complete partition (only with a complete component inventory; atria/shafts/voids are
  valid);
- level interval inconsistencies (overlapping or inverted limits);
- frame/datum mismatch between spaces -> not_assessed.
States: review_finding | not_assessed (with reason) | clean. Never "illegal". Order: blocking, then severity,
then size (no learned ranking).
Show the findings in the canonical record (findings[]) for the scene's findings mode.
```

**Expect back:** findings on the demo building (or a clean result with the coverage stated), plus one real case that ends as `not_assessed` and says why.

---

## P5.5 ⭐ P3 proposed identity wired end to end

**Gate:** GF-T15 · **Depends:** P5.2 · **Owner:** backend identity owner

```text
H26's P3 profile and project-identity lifecycle exist (packages/server/src/modules/usp/project-identity.ts,
project-code-generator.ts). Make them the only source of codes.
- Assign: POST /usp/identity/reviews and /assign for a reviewed space -> immutable proposed code with check
  symbol, plus a display-only Location line (parcel anchor, structure, level, space) that updates on correction.
- Lifecycle: proposed -> assigned -> retired/split/merged, idempotent and race-safe (concurrent assign of the same
  space yields one code).
- Official parcel ULPIN is stored only as a sourced anchor assertion; never generated.
- Expose proposedCode on spaces in /buildings/{id}/canonical.
Real check: assign codes to the demo building's reviewed units; a concurrent double-assign returns one code;
retiring a unit keeps history.
```

**Expect back:** codes on the demo units through the API, the concurrency result, and a retired unit with its history. The Studio switch to these routes happens in P8.3.

---

## P5.6 LADM mapping note

**Gate:** GF-EXCHANGE · **Depends:** P5.3 · **Owner:** any

```text
Write docs/api/ladm-mapping.md (at most 1 page): table mapping canonical/registry concepts to ISO 19152 Part 1/2
classes (LA_Party, LA_RRR, LA_BAUnit, LA_SpatialUnit, LA_LegalSpaceBuildingUnit, LA_Level, LA_Source), with
"not modelled" where true. Reference the export's sidecar fields. No code.
```

**Expect back:** a one-page mapping that is honest about what isn't modelled.
