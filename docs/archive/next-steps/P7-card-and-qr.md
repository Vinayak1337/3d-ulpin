# P7 — Scoped property card and QR

Goal: an officer issues a **3D Property Card** for one unit, from an exact registry revision, showing only that unit's evidence, with a QR that resolves to the same revision. This closes backend gap 4.

---

## P7.1 ⭐ Property-card subtype of the existing packet service

**Gate:** GF-T21 · **Depends:** P5.5, P6.1 · **Owner:** backend (PACK)

```text
Read H10, packages/contracts/src/usp/{property-card,packets,packet-pdf*}.ts, packages/server/src/modules/usp/
packets/*, packet0.ts, and the gap audit §4. Reuse the packet/storage/access/PDF components; no new card service.

Build:
- CardPlan pinned to {unitId, revisionId, proposedCode, Location line, level(s), area/quantities with states,
  rights/declarations with states (not_assessed if absent), selected evidence regions, 3D snapshot image of
  the unit highlighted, hash-chain head}.
- Render to PDF from the plan. Evidence crops come only from regions linked to THIS unit; sibling units'
  pixels/metadata never appear (check by listing every embedded image's source region).
- Missing values print with their state ("Not assessed", "Unknown"), never blank or zero.
- Store as an immutable artifact; reissuing creates a new card revision.
```

**Expect back:** a PDF card for one demo unit from its exact revision, the list of embedded regions proving no sibling leakage, and a reissue that creates a new revision.

---

## P7.2 ⭐ QR resolver and verification

**Gate:** GF-T21, GF-PRIVACY · **Depends:** P7.1 · **Owner:** backend (FND)

```text
- The QR encodes an opaque card reference (no personal data, no internal IDs that reveal other records).
- Resolver: GET /api/v1/cards/{ref}, local_operator mode on the same workstation: returns the card revision
  summary and verification status; revoked/retired/superseded -> clear state; wrong unit -> 404.
- Verification recomputes the hash chain over canonical bytes and the predecessor link; it reports
  "consistent" (hash chain only) — not "authentic" unless a trusted signature/key policy exists (H10 F14).
- Phone/public access stays off (full_product).
```

**Expect back:** scanning the QR on the demo laptop opens the verification for that exact revision; a tampered byte fails verification; a revoked card shows revoked.
