# T058 — original Studio and mockup comparison

## Sources and method

The original `E:/Projects/ulpin-city-studio` was opened and captured before product
changes. Its source hashes and four actual captures are in `baseline/`.
REF-15/16/17 are the supplied map, register and workspace image anchors.
The main project first adopted the Studio composition; route and record checks
then passed before the new authored-quarter and rendering work.

Final desktop captures use **1672 × 941** and mobile **390 × 844**. Side-by-side
images and the zoomable comparison gallery are in
`apps/web/public/studio-review/`. The comparison script records exact hashes and
labels source images separately from browser output. Review was performed on the
full map triple, scene-only pair, register triple and workspace pair, plus the
building-close, underground and mobile captures. This is explicit self-review,
not independent review or a fabricated user approval.

## Discrepancies corrected

| Reference concern | Actual correction and proof |
|---|---|
| T057 did not use the requested Studio design | Copied the actual Studio source, scoped its CSS, kept its header, rails, inspector, minimap and findings dock; T057 remains rejected rather than retrospectively approved. |
| Original Studio had a repetitive 944-building composition unlike the anchor | Prepared a separate 62-building quarter, keeping the full original fixture. Its park lies in the foreground beside the selected example; street intersections, parcels and context all follow this explicit dataset. |
| Scene depth and surface treatment were flat | Added bundled daylight/material textures, neighbourhood-scale shadows, a short-range contact pass, varied facade/window/balcony treatments and roof structures. The map remains actual geometry in all camera views. |
| Different views could create different GPU scenes | One persistent canvas is leased between district, register and workspace. Browser tests compare its actual DOM identity, not merely a counted selector. |
| Register/dialog did not follow the full-page hierarchy | The Studio register keeps the common product header, exposes a linked floor stack, exact unit list, prepared documents and contextual findings. Unit/document routes survive reload. |
| Original Studio had no full source-plan workspace | Added the source rail, metre-based plan tools, source facts, selected unit, lower 3D preview/floor stack and explicit local review draft panel using the mockup's three-column structure. |
| Documents were examples generated on click | Prepared all 903 specimens in advance from one versioned dataset and validated the normalized core. Downloads return the exact hash-verified files. |
| Dense optional layer controls displaced the property list | Kept primary layers visible and put sewer/electrical controls behind an accessible disclosure; no layer capability was removed. |
| Display-specific actions could obscure correctness | Plan measurements are draft values in source metres; unknown routes do not choose another record; source upload reports only the actual received original; local review does not pretend to publish. |

## Differences intentionally not disguised

The mockup is a photorealistic illustration. The implementation remains a
procedural, inspectable 3D neighbourhood: tree silhouettes, facade weathering,
street furniture and the exact geographic arrangement are not pixel-identical.
The colour, composition, UI hierarchy and close inspection are materially closer
than the original Studio and rejected map-lab, but no numeric perceptual-similarity
score is claimed. The supplied image is never inserted behind the controls.

Mockup quantities and legal-looking labels are not copied as facts. The prepared
example uses a 288 m² footprint, 4,608 m³ prism and a 506.25 m² parcel. The 32 m²
outside-parcel region overlaps the 16 m² road region. The source UI keeps those
findings separate rather than summing them. Every generated record is fictional.

The existing imported Uttam Nagar geometry remains unchanged in its saved-data
workflows. It is not relabelled as the new rectangular reference fixture. ML,
arbitrary importer coverage and a production multi-user approval system are not
claimed by this visual task.

## Failures found and resolved during verification

The first canvas-picking probe mistakenly added a canvas offset to a helper that
already returned absolute viewport coordinates. Correcting that test oracle then
proved real scene raycasting; the selection assertion was not removed. Normal
property-list selection was separately improved to retain the camera.

The exact 5 m pointer probe returned 4.99 m because browser pointer positions are
quantized to pixels. The numeric geometry test retains an exact 5 m oracle; the
actual pointer test uses a declared 0.03 m click tolerance and verifies the draft
scale factor independently. This is not presented as survey accuracy.

The import panel initially lacked the original Studio's overlay class, so a map
layer intercepted its buttons. The panel now uses the existing focus-trapped
overlay; the real upload, source receipt and original-byte download all passed.
A transient Next development-route JSON error was resolved by the clean production
build; the final navigation tests target that production build.

## Evidence

`verification/results.json` records eleven successful final real-browser groups with no
uncaught errors or failed local requests. The separate `verification/upload-run.json` contains the actual source-upload
receipt; the final run adds an independent camera-continuity check and avoids
creating another source. Both used the NVIDIA RTX 3070/Direct3D11 backend. `verification/data-preservation.json`
shows every protected original row retained, with one intentionally added source.
`final/capture.json` records the eight final visual views. Mobile is browser
emulation, not a physical phone benchmark.
