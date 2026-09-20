# T082 — Both demonstration datasets in the map list

Lake View and Shiv Vihar now appear as named cards in `/studio/datasets`, with building/floor counts and an explicit fictional, unrecorded status. All datasets is the initial filter; search and demonstration/source filters apply. The header dataset chooser exposes the same two entries. Saved areas retain their existing API, identity and routes; demo availability is independent of the saved-area request.

A shared catalog resolves `/studio/showcase?dataset=lake-view` and `?dataset=shiv-vihar` to their original source ZIPs. The named route overrides any previously active preview, reuses the layout resource cache and runs the existing normalizer. Reloading Shiv Vihar now reopens Shiv Vihar. Unknown dataset names return not-found. Importing a known bundled ZIP updates its URL after accepting the receipt. Arbitrary uploaded previews remain session-only and are not falsely listed as saved datasets.

Browser verification: both directory entries; search for Shiv; mapped-source exclusion; choosing Shiv Vihar; refreshing and confirming its title/URL; opening Lake View after Shiv; both entries in the header chooser. Actual directory screenshot saved in `../evidence/t082/`.

Checks: five showcase-import regressions passed; TypeScript and final production build passed. Initial build encountered an unfinished stylesheet from the concurrently edited explainer feature; no explainer files were changed here. Tested the directory with a temporary development server, stopped it, then restored the single production server after the stylesheet was completed. React review retained lazy map loading, shared cache, stable catalog keys, cancellable loading and real links/buttons.

This fixes discoverability and named-package reopening. It does not implement durable mixed-import recording (T080) or register these fixtures as authoritative property records. No database/source reset or snapshot refresh.
