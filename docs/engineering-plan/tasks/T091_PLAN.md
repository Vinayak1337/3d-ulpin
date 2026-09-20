# T091 — reachable mobile map and sidebar controls

Reproduced at 390 × 667: fixed wrapped header overlaps the map context; the inspector gives its scroll area only 32px and clips its footer. The explorer nests competing scroll areas. The register hides all building context and its return action on narrow screens.

Use normal document scrolling on narrow screens, a bounded interactive map, full-height inspector content, a single scrolling explorer drawer, and accessible expandable register details. On short desktops remove minimum map heights that exceed the available space and let each sidebar scroll as a whole. Preserve camera gestures, records, sources and identity assignment. Escape closes the explorer without resetting floor selection.

Verify real browser scrolling at phone, narrow phone, landscape and short desktop sizes, register details and return navigation, explorer contents, header bounds, and import dialog. Run production build. Deploy the same code to the already authorized demo without data changes.

Follow-up requested during this work: point-cloud-assisted generation. Existing Lake View LAS/LAZ contains synthetic points derived from authored buildings and is retained, not processed into geometry. A future bounded implementation must distinguish extraction results from supplied geometry and link point-cloud evidence; do not claim current map geometry was extracted from LiDAR.
