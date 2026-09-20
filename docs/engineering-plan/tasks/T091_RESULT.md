# T091 — mobile scrolling and sidebar reachability

Implemented alone after reproducing the inspector’s 32px scroll region and clipped footer at 390 × 667.

- Small screens use document scrolling with a bounded map; map pan/orbit gestures remain on the canvas.
- Both map sidebars have one scroll owner. Explorer close stays visible at the end of all 49 properties; opening it preserves the inspector. Escape restores focus without clearing the selected floor.
- The register exposes its previously hidden building details through an accessible disclosure, keeps Back to block map available, and lets the full floor/resident/source schedule flow down the page.
- Wrapping header uses its actual height; narrow import dialogs scroll and retain their close control. Short desktop maps no longer exceed the available viewport.

Validation: production build (including TypeScript) passed; JS syntax and diff checks passed. Browser verified 390 × 667 inspector footer, register building details and basement; 320 × 568 header, map drag, expanded import options and close; 844 × 390 explorer final layer; 1024 × 500 inspector footer; 1280 × 720 selected floor retained after explorer Escape. No horizontal page overflow at either phone size. Screenshots: docs/evidence/t091/. Responsive browser emulation, not a physical-device touch test.

Deployment: code commit 849b389 pushed to main and feat/visual-ml-completion, built successfully on DigitalOcean, service active and HTTPS datasets route returns 200. Hosted responsive stylesheet SHA-256 matches the local verified build. Safari reload reopened saved Lake View with 50 source files and the selected floor 3D-T9GRMW08XWS50W:1. No data migration, identity changes or source replacement.

Point-cloud clarification: the complete Lake View package contains LAS/LAZ with 62,886 synthetic points. Its manifest explicitly states that points were sampled from authored ground/roof polygons. The current importer retains these originals; supplied vector and floor schedule geometry drives the map. Actual point-cloud generation, alignment, quality review and provenance overlays require a separate implementation. Do not describe the current buildings as extracted from a LiDAR survey.
