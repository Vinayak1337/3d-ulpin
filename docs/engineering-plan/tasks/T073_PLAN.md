# T073 — Dense plotted block and computed spatial conflicts

Status: implemented; see T073_RESULT.md.

User correction: the sparse landscaped specimen does not represent the intended tightly packed Delhi-style neighbourhood. “Any data” here means geometric arrangements: attached/overlapping buildings, dense blocks and roads conflicting with building/parcel boundaries. This task corrects the existing local reference on port3013 rather than adding another prototype or seeding the live app.

1. Create a separate revision of the fictional source package with compact plots, shared walls, narrow galis, a collector street, varied heights and minimal open space. Preserve the previous specimen as an archive.
2. Include exact, computed cases for building–building positive-area overlap, road–building overlap, building outside its linked parcel, and touching shared walls with zero intersection area. Persist the input revision references, method, calculated area and actual overlap geometry. Synthetic findings are geometry demonstrations, not legal determinations.
3. Keep overlapping objects in their true positions with independent IDs; red denotes computed conflicts and amber denotes missing evidence. Enable inspection of each affected building and the exact overlap area. Ordinary touching walls are not painted red.
4. Adapt the street/ground presentation to a dense paved block. Avoid assumptions that every road is a broad rectangle or every plot has a lawn/setback. Preserve exact source footprints, elevations, floor/space selection and missing-height behavior.
5. Inspect real browser captures and validate geometry/source round trips, conflict arithmetic, overlap selection, 2D/3D/floor controls and performance. Show the updated map and explain the demonstrated configuration support without claiming universal geometry/format support.

Ownership: source worker owns generator/validator/data/package; map worker owns renderer/architecture/map CSS; parent owns environment/shell/import validation, integration, browser review and task records. Work is shared; no recursive agents. Existing app data remains empty.
