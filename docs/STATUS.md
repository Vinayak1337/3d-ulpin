# Status

**28 October 2026, early morning.** The plan is [PLAN.md](PLAN.md) and its tasks are in [TASKS.md](TASKS.md). The
demo runtime stays up and unchanged. This page stays under one page; the board before today is in
[archive/STATUS-2026-10-27.md](archive/STATUS-2026-10-27.md).

## Where each step stands

| Step | State |
| --- | --- |
| 0 Paperwork | Done. The plan is not yet signed (Needs you 1). |
| 1 Code version | `task/int3-pre` is the version we build on; it reaches `staging` after rehearsal 1. |
| 2 Kits | Done. The practice kit is catalogued; the closed kit is sealed (12 files, 4 families, hash only in Git). |
| 3 Stay up, stay smooth | Practice drop 2 is running again (S3.11c) on a fresh rehearsal runtime with every fix below. The first try stopped after 3 minutes: one slow status read ended the runner (fixed, S3.16) and the reading panel covered a button (fixed, S7.27 and S7.27b). |
| 4 Understanding | Reading cards exist for every family; drop 2 measures whether each practice file gets a correct one. |
| 5 Drawing | Readers exist for every family in the plan. New since the 27th: Berlin CityGML placed by its stated AdV system (S5.25), a gzip file gives out its member (S5.26), a file with no key field is keyed by each feature's position (S5.27), ZIP and gzip members above 128 MiB are kept through the large receipt (S5.28). The CityJSON bounds are being measured on a real 3DBAG tile now that the host answers (S5.18b). |
| 6 Linking | Done: links by key, address and place, shown on the map and in the record panel (S6.1 to S6.4). |
| 7 UI | The batch page layout is fixed at 1440 wide (S7.27, S7.27b). The screenshot set for your acceptance (S7.16) follows drop 2. |
| 8 Rehearsal 1 | Thursday 29 October, on the closed kit, after drop 2's fixes. |

## Known limits

- The Microsoft building file (about 800 MB) is above the streaming ceiling of 500,000
  features; it is kept and explained in words, not drawn.
- The CityJSON reader bounds (8 MiB) were set without a real tile; S5.18b sets them from one.

## Where things are

| Thing | State |
| --- | --- |
| Demo runtime `ulpin-demo` | Up, serving `4ffd801a` from `E:/Projects/ulpin-wt/demo`; not changed before step 9 |
| `task/int3-pre` | The newest code, in `E:/Projects/ulpin-wt/int3`, at `62b9fed7`; pushed; 76 commits (118 with merges) not yet in `staging` |
| `staging` | In `E:/Projects/3d-ulpin`; last pushed `5454ce56` on 27 October; holds the plan, tasks and this page |
| `main` | Never pushed or built on |
| Processor image | `ulpin-geo:git-7580d7661c31`, pinned on `task/int3-pre` (IMG7) |
| Rehearsal runtimes | `ulpin-reh-06` (S3.11c, created at `2b72f962`); `ulpin-reh-05` stopped (first drop 2 try); `ulpin-reh-01` to `04` kept |

## Next

1. Drop 2 result (S3.11c): fix what it finds.
2. The screenshot set (S7.16) for your acceptance.
3. Rehearsal 1 on Thursday 29 (S8.1), then fixes and rehearsal 2 (S9.1, S9.2).

## Needs the owner

The five items under "Needs you" in [PLAN.md](PLAN.md).
