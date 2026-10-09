# Official storey source truth — D2

**11 building/group records from 8 projects:** Tower 3 and Magnolia are `demo`; six further Bihar RERA projects are split **3 dev / 3 holdout**, at project level. A M Pinnacle has four separate source-named tower records. All plan pages, revisions and inventory-category relatives stay in the same project split.

- Development/demo records: `dev/` and `demo/`.
- **Evaluator only:** `holdout/` and `holdout-manifest.json`. Do not open these in a teacher context, send their documents to Claude/Sarvam, or tune against them. `project-split.json` pins the seal's exact hash.
- PDFs and whole registry HTML are external under `E:/BhuAayam-data/datasets/rera-storeys/`. Every record pins the URL, retrieval time, unchanged bytes and source locator. Existing demo originals were copied unchanged, not reacquired.

## What is truth, and what is not

The native **registry building table** is independent of the scanned PDF used by the document extractor. Its floor expressions, apartment-type counts and sanctioned building/wing count are retained as publisher literals. Their source unit/meaning is not inferred. Repeated category rows are not silently summed into a guessed total, and blank/missing separate basement counts remain `unknown`.

PDF statements are separately cited by page and region. D2's visual transcription is a **candidate source-literal observation**, not a new human label or a teacher oracle. The registry literals can score extraction; PDF citations require quote verification by the document worker/reviewer. This pack does not claim current approval, as-built condition, rights, a reviewed level schedule or registry admission.

## Difficult scopes kept honest

- **Tower 3:** S-001 labels the tower graphic `G+41`, but its UNIT DETAIL and TOWER AREA DETAIL tables say `G+42`. Both stay `conflicting`. The plan table also states 81 units for Tower 3. There is no unambiguous Tower-3 keyed floor/unit/basement field in the retained registry page, so these document facts are **not** an independent registry oracle. Project-shared basement labels do not establish Tower-3 basement geometry/count.
- **Magnolia:** registry group `Magnolia Residency`, literal floor count `3`, type `Duplex`, count `12`; the CAD drawing title has a blank Type-5 unit number. Do not turn the group into an identified villa. Ground/first/second/terrace captions remain literal plan scopes.
- **A M Pinnacle:** a municipal/area-authority sanction letter independently states tower-specific floor expressions; the registry repeats the fourth tower in two apartment categories. Keep category counts separate.
- **3D Apartment / A One Heritage:** the PDFs have distinct blocks, whereas registry building labels are not block-keyed. Do not infer a block crosswalk. Heritage's same-name rows carry two different floor expressions; the record conservatively marks this unresolved same-name association `conflicting`, not a proven physical same-building discrepancy.

No storey model, OCR evaluation, teacher call, API import or runtime gate ran. Further authority evidence is needed to close Tower 3's independent storey-oracle gap.
