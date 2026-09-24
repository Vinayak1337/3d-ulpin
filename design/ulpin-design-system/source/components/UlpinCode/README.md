# UlpinCode

Shows a space's identity in two lines of copyable mono text.

- **Line 1, the code:** the proposed project code `P3-<20 symbols>-<2 check>`, labelled **3D ULPIN (proposed)**. It is random and carries no meaning, so its segments have no tooltips. Only the two separators shown are used.
- **Line 2, the location:** `<parcel anchor> / <structure> / <level> / <space>`, labelled **Location**, in muted text. Display only: never stored as identity, parsed or accepted as input. Its segments carry tooltips. `MULTI(2)` or `NO-ANCHOR` replaces the parcel when there is no single reviewed parcel.
- **States:** *Assigned* (solid), *Draft* (no code yet: "Code assigned after review"), *Retired* (struck through, always with successor links), *Cancelled* (struck through, with the reason).
- Always show the state's **Parcel ULPIN** separately with its anchor state. Never call a project code official or issued.
- The consumer provides the code, the derived location, the state and any successors.
