# Studio source-to-record guide

Latest source-package demo (21 September 2026): see [Lake View source showcase](LAKE_VIEW_SOURCE_SHOWCASE.md). The complete ZIP builds a draft preview and is separate from the persisted workflow below. Navigation now calls the work queue **Batches** and its intake action **New batch**. Historical saved-demo availability depends on the selected local data environment.

Current workflow: 20 September 2026. Open the running local app at
`http://127.0.0.1:3000/studio`. Studio is the officer interface; its default is
the **Work queue**. The main workflow is **Add files → Review details → Check &
record**. Receipt, extraction, review and recording are separate actions.

## Choose the right data

Use the existing **Lake View** saved block for the persisted fictional
demonstration. Its demonstration labels and invented identifiers are not survey
evidence or official identity issuance. Choose real saved datasets separately
using **Choose a saved block** or **Browse saved blocks**, and retain their source
attribution. The **Reference quarter** is a separately labelled prepared
synthetic example; it is not a substitute for processing retained source files.

Do not reseed or replace sources to restart a demonstration. Resume saved work.
This release is local and single-operator. Keep the configured linked or
`REPO_DATA=true` environment intact; this guide does not call for resetting
volumes, copying private-PC data, or refreshing the repository snapshot.

## 1. Add files

Choose **Add files** in the Work queue. Drop one or more files, or use the file
picker. The current receipt paths accept:

| Source | Extensions | Per-file limit |
| --- | --- | --- |
| Documents and schedules | PDF, CSV, TXT, DOCX | 10 MiB |
| Images | PNG, JPG, JPEG | 16 MiB |
| GIS | GeoJSON, supported ArcGIS JSON, GeoPackage, Shapefile ZIP | 16 MiB |

Files must be nonempty. Extensions help select a path; services still inspect
their contents. A ZIP must be a supported shapefile archive, not an arbitrary
collection of files. GIS layer, coordinate-system, feature-ID and geometry
validation still applies. Accepting a document does not promise automatic
extraction of every field or image inside it. Raw GNSS, LAS and DEM processing
are not supported by this intake workflow.

Unsupported files and oversized documents show a per-file correction. Remove
them and choose suitable files before continuing. GIS inspection reports its
own size or content errors. Failed inspection is not a recorded spatial result.

**Documents:** select **Continue to document review**. The original bytes are
retained and the saved source workspace opens directly. A block or property is
not required for receipt. **Documents** opens the source list; choose a source
and page to inspect it. Use **Review details** to return to the review panel.

**GIS:** the **Review GIS details** form inspects the source. Check the detected
layer, coordinate system, suggested complete/unique ID column and name column.
Confirm what the boundaries represent and declare whether the source is real
observed, planned, hypothetical or fictional. Resolve missing details; use
advanced settings when a destination or mapping needs correction. Choose
**Continue to review**, then **Review GIS draft** on the retained file row.

A mixed selection handles GIS drafts and document receipt separately. Check
the displayed destination; one successful receipt does not mean every file has
been recorded. Retained rows stay visible if another file needs correction.

## 2. Review details

### Imagery without an existing property

In a document-only workspace, choose **Choose a block for imagery extraction**
when ready to extract spatial information. Select the destination block and
explicit source origin, then **Continue to extraction**. The originals already
retained are reused. The block must have a valid retained projected metre frame.
Do not substitute guessed coordinates for documented control evidence.

Choose **Extract or review imagery**. The **Spatial extraction** dialog shows
the configured local model's availability. Select the task and eligible retained
image/PDF parts, check the page, and choose **Queue … sources**. The current
local batch limit is up to 12 source parts. Reopen the dialog to inspect
**Retained attempts** or use **Refresh status**.

Inspect the actual retained inference raster and proposed boundaries. Select
only source-supported regions and give them useful names. Enter two documented
image-to-metre control pairs, the named metre frame and a control evidence/review
note. Matching retained controls may be restored; verify the source and frame
before using them. Two controls define a similarity transform, not perspective
correction or survey accuracy.

**Create footprint draft (…)** sends selected building outlines to ordinary GIS
review. It does not record them. Roof outlines do not establish parcels,
ownership or building heights. Retain unknown height when no separate evidence
supports it, then follow the GIS check-and-record path below.

### Detailed records for an existing property

Use the property's contextual workspace action, or expand **Link sources to an
existing property → Choose property** in source review. Verify the property and
selected sources before assigning them. Property assignment is optional for
imagery footprints; floor-plan regions need a property and reviewed placement.

The **Review details** panel shows **Still needed** requirements first. For each
suggested or conflicting fact, inspect the cited source/page using **Show
source**, then **Review value** and **Use reviewed value**, recording the reason.
Reviewed facts and alternative source values remain accessible in their
disclosures. Do not infer floor levels, heights or legal units from appearance.

Under **Confirm source placement**, verify the source's named metre frame,
placement and vertical reference against evidence. Source geometry and vertical
levels must agree before proposed 3D details can be built.

Optional assistance is under **Read details from a source**:

- **Document assistance** offers **Extract candidates** only when its configured
  free route is available, plus **Saved result** for a retained result. Review
  the source section and any outgoing image crop as the panel requires. A local
  segmentation model being ready does not establish a working Nous free route.
- **Extract plans or imagery** opens local spatial extraction. Review the exact
  source and controls. **Send … to fact review** adds unreviewed floor geometry;
  separately review supported floor names and lower/upper levels before building.

For a manual fallback, use **Add source fact** with a cited source location.
**Tools → Calibrate / Measure / Compare** remains available. A supported trace
with matching source controls can be offered through **Use a calibrated trace**;
it still enters fact review. **Advanced geometry editing** remains available in
the preparation controls. **Clear drawing** or **Ctrl+Q** cancels only the
current drawing. Browser-local annotations are distinct from saved canonical
facts and the unchanged original files.

If a model or document provider is unavailable, retain the source and use
supported manual review or resume later. A failed or empty model output does
not establish absence of buildings or source unsuitability. AI suggestions are
reviewed assistance, never spatial authority or direct publication.

## 3. Check & record

**GIS / imagery footprint draft:** inspect the source geometry preview and
notices. Resolve every outstanding question with a reason, including **Keep
height unknown / 2D** when appropriate. Choose **Review import**. Inspect the
resulting findings and coverage notices, enter the **Source acknowledgement**,
then **Record observations**. These actions preserve the original source and
create a recorded technical revision.

**Detailed property proposal:** once the panel's required facts and placement
are complete, choose **Build proposed 3D details**. Processing can continue while
you leave the workspace. On success, choose **Review proposed records**. In
**Check & record**, inspect **Proposed changes and level references**, additions
or updates, and all findings. Blocking errors must be resolved. Enter the
**Review note**, then **Record reviewed details**. The saved result offers
**Open recorded details**; it should not require rebuilding the same proposal.

Changed input revisions invalidate stale preparation/review eligibility.
Reopen or refresh saved progress and resolve the actual reported requirement.
Use **Retry proposed 3D details** for a reported processing failure after checking
its cause. Recording creates a technical revision while retaining originals,
identities and earlier records. It is not statutory acceptance or official
identity issuance, and “no conflicts found” refers only to the implemented check.

## Resume, inspect and export

Return to **Work queue** for saved cases and GIS drafts. Search by work name,
block or work ID; use **Previous / Next** for further pages. The row's next action
is contextual: **View progress**, **Review processing issue**, **Review details**,
**Review boundaries**, **Open map**, or **Open recorded details**. **Recorded
history** includes work with an older recorded revision even if later edits
still need review. The visible queue refreshes every 15 seconds and when the tab
becomes visible. Draft review and processing receipts survive a page reload;
unsaved file selections and browser-local drawing state are not recording.

The header's **Search properties and record IDs** is separate from saved-work
search. **Cmd/Ctrl+K** focuses it. **Map** and **Property Register** open their
directories; contextual property actions retain the selected property's identity.
Old bookmarks resolve into Studio while keeping applicable source, case, floor
and unit context.

In the Property Register, inspect the model and floor/unit table, then use
**Documents**, **History**, and the available checks to examine the retained
evidence. Use **Export register** and verify **Scope** before **Download export**:

| Scope | Formats exposed by the current export dialog |
| --- | --- |
| Whole building, floor or unit | PDF, JSON, CSV, ZIP, Print HTML |
| Complete map dataset | PDF, JSON, GeoJSON, ZIP, SVG |
| Individual map feature | JSON, GeoJSON, SVG |

JSON provides individual include controls; other formats use their stated fixed
schema. ZIP includes original bytes and report material. Shared originals may
cover more than one floor. Exports retain canonical identifiers, source revision
references and applicable provenance; unavailable geometry stays unavailable.
An SVG exports supported selected 2D geometry, not a screenshot. Check stale
finding warnings and source scope rather than treating an export as new evidence.

For model setup and retained inference limitations, see
[local spatial extraction](local-spatial-extraction.md). Qualification results
and remaining acceptance gates are recorded separately in the engineering task
results; this guide describes supported actions, not universal ML accuracy or
user visual acceptance.
