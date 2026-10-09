# P9 — One recorded journey, honest claims, presentation

Goal: prove the product end to end, once, on real data, and make every public claim match what ran.

---

## P9.1 ⭐ The golden journey script

**Gate:** GF-REHEARSAL · **Depends:** P3.1, P4.5, P5.2–P5.5, P7.1–P7.2 (grow it as they land) · **Owner:** lead

```text
Write scripts/golden-journey (Node or Python, one command) that runs against the live local stack and checks
the whole story on the demo building. Steps, each timed and logged to docs/evidence/gf5/<date>/journey.json:

 1 doctor green (P0.3)
 2 import the area and building documents through /import-packages (P3.1) — or confirm already installed
 3 GET /areas/{id}/canonical: frame present, building present, states/citations present
 4 building candidates: roofprint candidate exists with model id (P4.5); accept it via review
 5 level schedule: Tower 3 shows conflicting storeys with both citations (P4.4/P5.1); resolve or keep conflict
 6 delineation: prisms exist for reviewed spaces; volumes match the hand-calculated cases (P5.2)
 7 topology: findings or clean with coverage (P5.4)
 8 identity: assign codes; a concurrent double-assign gives one code (P5.5)
 9 exchange: CityJSON export validates, vertices not empty (P5.3)
10 card: issue for one unit; no sibling regions; QR resolves; tamper fails verification (P7)
11 invariants: original hashes unchanged before/after; no candidate in the registry without review

Steps that aren't built yet print SKIPPED(<prompt id>) instead of passing. The script is the only end-to-end
test the project maintains; every prompt's agent runs it before handing off.
```

**Expect back:** the script, one full run's `journey.json`, and a list of skipped steps with their prompt ids. The script must fail loudly when an invariant breaks.

---

## P9.2 Claims ledger and demo runbook

**Gate:** GF-REHEARSAL, H90-3 · **Depends:** P9.1 · **Owner:** lead

```text
1. docs/evidence/gf5/claims.md: every claim the PPT/demo/README makes, each with: measured (link to result)
   | preprocessed (with measured runtime) | planned (not shown as done). Examples: "building extraction:
   precision X / recall Y on N Indian team-labelled holdout tiles from M cities"; "identities are proposed,
   not official ULPIN issuance"; "permission unconfirmed for local development".
2. docs/DEMO_RUNBOOK.md (at most 1 page): start, reset-to-demo-state without deleting data (use a fresh demo
   area revision, never a volume reset), the click path, what's live and what's preprocessed, what to do if
   the network/model/Docker fails (replay adapters, recorded backup).
3. Update the README's feature list so nothing claims more than the claims ledger.
```

**Expect back:** the claims ledger, the runbook, and the README corrected. The owner approves the claims (H90-3).

---

## P9.3 Presentation and video

**Gate:** H90-1/2 · **Depends:** P9.2 · **Owner:** lead + owner

```text
Update the PPT (H24) and the launch video script (video/reel, docs/media) to the claims ledger. The story:
fragmented evidence -> Identify (real Indian building, learned candidates, review) -> Prove (every value opens
its source; the G+41/G+42 conflict is shown, not hidden) -> Govern (checks with honest not_assessed) -> card
and QR. Show numbers only from result.json files. No screen labelled "demo" or "fictional"; no invented data.
```

**Expect back:** a deck and video script that match the claims ledger, ready for the owner's submission.
