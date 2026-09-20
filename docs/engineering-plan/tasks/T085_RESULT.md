# T085 — Visual-only hackathon presentation

Replaced the live explanation page with a standalone presentation canvas. Source → Extract → Review → Measure → 3D proposal each pairs an input visual with its output. Removed paragraphs, speaker notes, verbose headings, editing controls and the text footer from this mode. Retained short source/model names, candidate status, dimensions, areas, height and volume. Added source switching, full-screen control and rotatable candidate geometry. Review's Present action opens this visual mode.

All images/outlines/calibration/measurements still come from retained results; no model output or source data changed. Uncalibrated or unreviewed examples show a compact pending label. Existing detailed review remains accessible through the back arrow.

Validation: production build including TypeScript passed; browser checked source/floor-plan switching, extraction overlays, documented controls, calibrated outline, prism rotation, return-to-review and Present actions. DOM contains zero paragraphs/blockquote elements in presentation mode. Default desktop and 768 px tablet inspected, with no horizontal overflow at 768 px. Browser error log empty. Screenshots in ../evidence/t085/.
