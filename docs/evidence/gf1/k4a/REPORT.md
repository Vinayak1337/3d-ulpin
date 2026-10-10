TASK K4a — reject-only migration registration and P3 readiness · GATE GF1 (readiness only)
WORKS Registered loader/runner step; demo receipt rows 3→3, package_id nullable, both FKs unchanged.
SEE IT `GET http://127.0.0.1:3194/api/v1/buildings/e8777ffc-9409-4129-bacf-f680160d8795/canonical`
INPUTS Magnolia original including unit-number annex annotations; Tower 3 scans, D2 demo/A5/P1 derivatives.
GAPS No recorded floors/spaces; no unit-to-panel crosswalk; current CityJSON frame guard refuses both sites.
DESIGN `manifest.json` + `migrateSpatialMl()` load the existing forward-only SQL after source-batches.
       `readiness.md` traces identity/canonical/card guards and three conditional options; no identity was assigned.
COMMITS Migration: f6c25999; documentation: `docs(identity): K4a readiness for P3 codes on the demo records`.
CHECKS Backend typecheck 0; registered migration 0; final demo doctor 0; genuine LF API check 1.
       LF diagnostics: only four historical `runtime receipt changed` hashes; no receipt/pin normalization.
       Extra SQL verifier 1: historical authored-task allowlist rejects K4a; lead owns that unassigned seam.
       Native API/dispatcher refreshed for cached manifest; containers/volumes preserved; demo left running.
       Evidence JSON/syntax/style/diff checks pass; readiness is 120 lines. No OCR/provider/acquisition/registry write.
NEXT Recommend option 1 only as an officer-reviewed, source-defined plan-local space/card, not a legal unit.
     Dispatch scoped source-only recording + canonical P3 wiring; use a building card fallback if review blocks.
