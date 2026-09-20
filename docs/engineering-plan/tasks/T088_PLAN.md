# T088 — Clear ML page controls, result navigation and full import demo

1. Use fixed extraction tasks for explicitly grouped aerial images/floor plans; preserve explicit choice only for unclassified/supporting documents. Obtain actual PDF page counts from retained originals, display them, and provide bounded minus/plus page controls. Reject pages beyond the document at the server as well as UI.
2. Add previous/next result navigation with position and no wraparound. Verify saved predictions and distinguish visible list length from retained region count.
3. Audit current map issue markers and checks, retaining legitimate vertical separation and manual review (no invented geometry repair). Prepare data-source with the byte-identical complete Lake View package, inspectable source files and exact import instructions; verify upload/render and idempotent save against the existing dataset.

Tests: PDF page parsing (multi-page, corrupt/encrypted as applicable), selection bounds, server queue regression, production build, browser controls and result navigation, map findings and full package import. Never alter original source geometry or automatically resolve ambiguous ownership/survey conflicts. No inference reruns are needed for these checks.
