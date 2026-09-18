# T001 subtask: adopt existing work and establish a Windows baseline

Prepared 18 September 2026 against `f082441`, inherited without rewriting
`origin/feat/reusable-spatial-map-core`. The active working branch is
`feat/unified-spatial-foundation`; `main` remains at `1622097`.

## Evidence and outcome

The newer remote branch already contains a minimum `ulpin-spatial/1` contract,
shared viewport/cache/session, compiler and calibration route. Preserve it and
map its verified coverage into the task board; do not recreate it or equate it
with completed product tasks. The original T001 package was recovered from the
user's download and its SHA-256 verified before applying the additive patch.

The first Windows spatial test run produced 28 passes and one failed assertion:
the engine ownership inventory returned a backslash-separated relative path.
The expected single-engine ownership is correct; only its platform-specific
string representation differs. Plan validation also caught Git autocrlf changing
the byte-preserved legacy planning records during patch application.

## Allowed changes and tests

1. Add explicit line-ending attributes for the new planning directory. Preserve
   legacy records byte-for-byte from the verified archive, without changing their
   expected source hashes. Re-run the plan validator and compare archive bytes.
2. Normalize the test's relative inventory path using the platform path separator
   before comparing it with the portable expected path. Preserve all ownership
   and compatibility assertions. Re-run all 29 spatial tests.
3. Re-run collector tests on temporary Git repositories, existing pure/UI/AI
   regression scripts, type checking, and a production build only after checking
   active-server ownership. Record each result separately.
   The collector's original CLI test names `python3`, which is unavailable on this
   Windows installation; use the running interpreter (`sys.executable`). Create
   a committed Git symlink fixture through Git's index with `core.symlinks=false`
   so this committed-blob test does not require Windows symlink privileges. Keep
   the real filesystem symlink test on hosts that support it; explicitly skip it
   on privilege error and retain an unconditional unit test of symlink rejection.
   Neither a skip nor that unit double proves native symlink creation here.
4. Collect committed source metadata only after the adoption commit. Include new
   spatial modules in the baseline inventory if missing from its current allowlist.
5. Use isolated storage for the API/preservation baseline. Docker is currently
   stopped; startup requests were blocked. Do not bypass that block or run
   migrations against the user's retained registry. Use a permitted isolated
   hosted environment or wait for the user to start Docker.

## Negative cases and rollback

Do not overwrite existing archive destinations, accept mismatched hashes, rename
or delete other agents' branches, silently omit failed tests, or mark metadata
checks as database preservation. A failed test remains visible until reproduced
and corrected. This subtask changes planning/test tooling only; reverting its
commit does not require a database rollback. M001 cleanup remains separate.

## Exit

The plan/tooling is adopted on the real branch, Windows-only baseline defects are
fixed with unchanged semantic assertions, and actual results are recorded. T001
itself is not accepted until required isolated integration/preservation evidence
also exists. All later task completion must be assessed against the backlog,
not inferred from the presence of the imported spatial implementation.
