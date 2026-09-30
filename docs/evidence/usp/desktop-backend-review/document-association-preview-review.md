# LINK-01A-R — document association preview review

30 September 2026. Reviewed candidate `e915af9c447c8967d1b5a39a71b00073b5c7629e` against `a6944c064f806defeefeb3f1f77d2025cc7d01a9`, following the assignment at primary staging `2ce90a3511f8ea2698459776a8f621e6feccae45`. Scope: the 12-file stateless API increment and relevant existing authorities. Primary remained read-only. Review branch `task/desktop-document-association-review` uses `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`; the completed archive-review branch was preserved.

## Verdict

**Scoped code acceptance: no actionable finding identified.** The increment is ready for the separately assigned runtime verification. The live API journey is **UNRUN**, and no genuine matched document/building/floor positive journey is qualified. This review does not establish runtime readiness, an association, a learning label or a GF gate.

## Authority and behavior checked

| Boundary | Review conclusion |
| --- | --- |
| Exact document/job/result/attempt | `document-association-authority.ts:11–25` selects the exact document job by case/source/job, parses its registered input, checks current source/case/access/reader authority, compares every request source pin and calls the existing accepted-result checker. That checker joins the current accepted fence to an accepted attempt and requires succeeded states plus matching result/completion/input hashes and payload. These checks run again after result I/O, with the original input fingerprint. |
| Part citations | The service uses `readDocumentResult`, which checks stored result size/hash, input fingerprint, source-bound part schema, text hashes and available unit/segment integrity. Requested IDs select only exact parts from that result; unknown or duplicate selections fail. Projection retains the complete part and typed locator. Blank, nonliteral workbook cells and redaction markers are ineligible for identifier review. OCR-only and archive geometry do not become native text. |
| Snapshot and targets | A nonempty target selection requires an exact recorded snapshot and positive registry-record pins. `readManifest`, manifest membership and explicit-selection checks precede resolution. Only recorded buildings/floors are accepted; no missing-floor substitution occurs. `assertCurrentAssociationTarget` compares current site, revision, kind, identifier, full body and applicable project identity against the captured row, including same-revision drift. |
| Projected context and visibility | Labels, identifiers and relationship pins come from `resolveRegistryTarget`, backed by retained rows. No caller label, inferred alias or identifier overlap is used. The adapter authorizes source references in evidence, rights, geometry bindings and registry metadata through `registrySourceTx`; snapshot document visibility is also rechecked by existing manifest authority. Only relationships within the exact selected pins are returned; excluded/missing relations remain partial and missing selected parents remain explicit. |
| Post-I/O checks | `document-association.ts:50–64` checks both authorities before the accepted result read, then repeats document/accepted-result authorization and target resolution/currentness before return. It compares the second target projection to the first and fails on drift. It does not refresh pins, accept relationships, write records or re-extract originals. |
| Guard and bounds | The controller uses the existing private guard and server-created local principal. Normal application bootstrap installs loopback Host/Origin checks and `no-store`; the controller guard additionally denies cross-site fetches. Request bytes are capped at 1 MiB, selections at 25 parts/25 targets, and preview bytes at the existing 4 MiB result bound minus 4 KiB for the bounded envelope. Module registration reaches `AppModule` through `domainModules`. |

### Intake envelope version is backed by existing authority

The `caseRevision + 1` in `document-association.controller.ts:25` is the existing conversion from zero-based case revision to positive USP intake version. `documents.ts:50–53` registers document jobs with exactly `{kind:'intake', workspaceId:caseId, version:current.revision+1}`; `jobs.ts:32–36` rejects document enrollment unless that version equals `job.case_revision+1` and the payload case revision equals the job revision. The preview then compares the requested case revision to the registered input and reconstructs that input from current case authority before returning. This is justified by actual enrollment/currentness rules, rather than an arbitrary positive value.

With selected targets, `meta.scope` is the authorized target snapshot; the independently authorized document pins remain explicit in `data.document`. With `scope:null, targets:[]`, the envelope names the current document intake scope and the data reports unavailable target selection. Neither branch asserts that the document belongs to a target snapshot or establishes a source-to-target link.

## Evidence and actual checks

- Inspected all 12 changed files, focused tests, the prepared smoke script, shared document/result/attempt readers, snapshot/registry source readers, guard and envelope definitions. `git diff --check a6944c064f806defeefeb3f1f77d2025cc7d01a9 e915af9c447c8967d1b5a39a71b00073b5c7629e` and `node --check scripts/usp/desktop-document-association-preview-smoke.mjs` each exited 0. The latter is syntax only.
- The [implementation handoff](../document-association-preview-handoff.md) records backend typecheck, four focused service/projection checks and actual Nest provider/route metadata verification without a listener at exit 0. I inspected their code and scope; I did not rerun them or treat the technical target doubles as records. No unresolved concrete suspicion required a new reproduction.
- Reused the source index/catalogue and accepted native-table/XLSX handoffs. The LGD administrative CSV and UK MHRA blank template support citation/incomplete-input checks only. The Bihar/Haryana crosswalk evidence still leaves canonical matches `not_assessed`. No new source, byte-reader campaign, operational fixture or label was created.

## Remaining qualification and cleanup

Every association and identifier overlap remains `not_assessed`. `state=available` describes available review context only. Missing targets are not a global registry no-match, and duplicate literals retain their individual identifier assertions rather than merging namespaces. Optional automatic overlap was intentionally excluded and is not a missing requirement.

The bounded real API journey, current runtime source/result/code pins, positive target qualification and generated OpenAPI/client refresh remain open. The planned source-only smoke can qualify exact citations and an unavailable-target response; it cannot qualify a genuine building/floor association. A later authorized native retry may prepare a current receipt if old reader pins are stale; the preview itself must stay read-only.

Only this report was written. No API/Docker/listener, live database, model, provider, source acquisition or additional worker was used; no resource cleanup was needed. CITYJSON-02 retains runtime ownership. Supplied active permissions were `approval_policy=never`, `sandbox_mode=danger-full-access`. Requested Astra/xhigh/default-standard; actual runtime model, effort and service tier were not exposed and are not attested.
