# DQ1 - a sealed set of public files nobody on the team has chosen, for the 22 October dress rehearsal

**Worktree for your commits:** `<worktree>`. First: `git -C <worktree> status --short` (clean, or stop), then there
`git switch -c task/dq1-unseen-set 7a6fded0` (staging `7a6fded0`; say it). Gate GF5 (rehearsal), GF1.
You are the only writer of `docs/api/real-sources.md` and `docs/api/datasets.json` while you run.

Read first: `AGENTS.md` ("Data rules"); `docs/next-steps/00-STANDARDS.md` (data rules and licences);
`docs/api/real-sources.md` sections DA1 to DA6 (the shape of a receipt and a report; the India-first search that found
nothing, line 129); `docs/api/datasets.json` (every publisher and portal already recorded); the plan you serve:
`docs/next-steps/SPRINT-SELECTION.md` §1 and `docs/next-steps/INGESTION-ARCHITECTURE.md` §10 row "D Rehearse".

## Why
On 22 October the judges may hand over a file in a format we have not seen, and the Studio must take it with no code
change. Every public file the team holds was chosen by the team, and each has been looked at. The architecture's
rehearsal step asks for "two runs from empty with files the team did not choose". This task fetches such a set and
seals it: you choose it, nobody else looks at it until the dress rehearsal (REH8) opens it.

## Hard rules (each is a stop rule: if a step cannot be done inside them, stop, record it, go to the next part)
- **Issuing authorities only:** a government portal or the agency that publishes the data (data.gov.in, a state or
  city GIS portal, a national mapping agency's open-data page). No mirror, no aggregator, no vendor.
- **A new publisher only:** no publisher, portal dataset id or URL already in `real-sources.md` or `datasets.json`.
  That keeps every held-out or development family closed to this set.
- **An open licence stated by the publisher** for that dataset (GODL-India, an Open Government Licence, CC BY or
  CC0). A dataset with no stated licence is not taken. Record the licence words and their URL.
- **No personal data:** read every text column or property name and a sample of its values before keeping a file;
  drop the file if it holds person names, phone numbers, email addresses or ID numbers of people. Dropped bytes are
  kept apart under `excluded/`, never used, and named only by reason in evidence.
- **No login, no CAPTCHA, no form, no stated purpose required**; nothing bypassed. Respect the portal's terms.
- **Size:** 4 to 6 files, 300 MB in total at most; one file may be up to 200 MB (the "any size" case).
- **Formats:** at least three different ones among GeoJSON, Shapefile ZIP, GeoPackage, KML/KMZ, CSV, XLSX and a
  native-text PDF. At least one map layer of buildings, parcels or boundaries, and, if the same publisher offers it,
  one table whose key column names a feature of that layer.
- **India first:** spend up to 40 minutes on Indian issuing authorities; take foreign files only to reach three
  formats. Indian files keep H23/H28 tags; foreign files are `test_only` in their own geography.
- **Sealed:** never upload, import, profile or open a kept file in the product; never send any byte to a model or
  provider. You may read a file only as far as the screening rules above require.
- Never open any `heldout`, `holdout`, `evaluator`, `provisional` or `acquisitions` folder, nor anything under
  `E:/BhuAayam-data/runtime/**` or `E:/BhuAayam-data/task-data/d1c/`. Never read any `.env`, `.envvv` or keys file.
  No Docker command, no runtime start, no GPU. Originals are never changed.

## Part 1 - fetch and screen (commit `docs(data): DQ1 the unseen set, receipts and screening`)
1. Keep each original unchanged under `E:/BhuAayam-data/datasets/unseen-dq1-20261018/<publisher>/`, with a sibling
   receipt: issuer, original URL, acquisition date and time (IST), bytes, SHA-256, licence words and URL, geography,
   the CRS exactly as the file states it (or "not stated"), the format as the bytes show it (magic bytes, not the
   extension).
2. `docs/evidence/gf5/dq1/result.json`: every candidate looked at, kept or not, with the reason; every fetch with
   its URL and HTTP status; the screening result per kept file (columns read, personal data none found).
3. `docs/evidence/gf5/dq1/sealed-manifest.json`: for each kept file only path, bytes, SHA-256, format and licence.
   No column names, no counts, no sample values: REH8 must meet the files the way a judge's file arrives.

## Part 2 - record the acquisition (commit `docs(data): DQ1 the unseen set enters the source index`)
Add one section `## DQ1 sealed rehearsal set - 18 October 2026 IST` at the top of `real-sources.md` in the DA style
(publisher, link, bytes, licence, `test_only` or Indian tags, "sealed for REH8; not profiled or imported"), and the
matching entries in `datasets.json` under `retainedExternalSources` with the same fields the DA entries use.

## Stop rule and success
- **Success:** 4 to 6 kept files in three or more formats, each with an open licence and a receipt, at least one
  map layer among them, none from a recorded publisher, none with personal data.
- **Stop:** after 90 minutes of searching, keep what passes and report what was missing; the same fetch failing
  twice is not retried a third time.

## You own
`docs/evidence/gf5/dq1/**` (new), `docs/api/real-sources.md` (one new section), `docs/api/datasets.json` (new
entries only); `E:/BhuAayam-data/datasets/unseen-dq1-20261018/**` (new); `E:/BhuAayam-data/task-data/dq1/**`.

## Checks
`git diff --check`; lines of 120 characters or fewer in files you write; `datasets.json` still parses
(`python -c "import json;json.load(open('docs/api/datasets.json',encoding='utf-8'))"`); every SHA-256 in the manifest
recomputed from the bytes on disk and equal; no personal value in any evidence file.

## Git (owner's rules, binding)
Commit on `task/dq1-unseen-set` only; never push; never touch `staging` or `main`. Author and committer are the
owner's configured identity. No attribution of any kind: no Co-Authored-By line, no "generated with" line, and no
commit message or evidence line that names an AI model, tool, provider or worker as the one who did the work. If time
runs short, commit `wip(...)` with one line on what is missing, the same line in `docs/evidence/gf5/dq1/CHECKPOINT.md`.

## Final answer
```
TASK   DQ1 - sealed unseen public set for the dress rehearsal                     GATE GF5
WORKS  <kept files: count, formats, total bytes; Indian or foreign>
BRANCH <branch name and head sha>
GAPS   <formats or kinds not found; why>
COMMITS <short sha + subject, one per line>
CHECKS <each command with its exit code>
NEXT   <anything needing the lead or the owner>
```
Time box: 120 minutes.
