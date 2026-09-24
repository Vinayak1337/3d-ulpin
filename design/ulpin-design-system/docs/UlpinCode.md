---
category: Identity
---

# UlpinCode

Shows a space's identity in two lines of copyable mono text.

- **Line 1, the code:** the proposed project code `P3-<20 symbols>-<2 check>`, labelled **3D ULPIN (proposed)**. It is random and carries no meaning, so its segments have no tooltips. Only the two separators shown are used.
- **Line 2, the location:** `<parcel anchor> / <structure> / <level> / <space>`, labelled **Location**, in muted text. Display only: never stored as identity, parsed or accepted as input. Its segments carry tooltips. `MULTI(2)` or `NO-ANCHOR` replaces the parcel when there is no single reviewed parcel.
- **States:** *Assigned* (solid), *Draft* (no code yet: "Code assigned after review"), *Retired* (struck through, always with successor links), *Cancelled* (struck through, with the reason).
- Always show the state's **Parcel ULPIN** separately with its anchor state. Never call a project code official or issued.
- The consumer provides the code, the derived location, the state and any successors.

## Usage

```jsx
<UlpinCode code="P3-7Q4M2R8T6V0W3X5Y9ZAB-R4" location="MH2507A1B3C4D5 / S01 / F07 / R003" legend />
<UlpinCode state="draft" location="MULTI(2) / U01 / B1 / P041" />
<UlpinCode state="retired" code="P3-3M8Q0T5W1Y7Z2A4B6C9D-GE" note="Retired 12 Sep 2026 · merged into P3-9F2K…-RS" />
<UlpinCode code="P3-7Q4M2R8T6V0W3X5Y9ZAB-R4" location="MH2507A1B3C4D5 / S01 / F07 / R003" labelled={false} />
```
