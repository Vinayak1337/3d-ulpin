# Backend register and source-export contracts

Updated 26 September 2026. The synthetic startup walkthrough is retired. [H10](usp-agent-handoffs/10-scoped-evidence-packets.md), [H01](usp-agent-handoffs/01-shared-contracts-and-ownership.md) and [H99](usp-agent-handoffs/99-ui-ux-and-integration.md) govern current backend planning; the user owns the controls and presentation.

A scoped register identifies exact record/revision and explicit building context. Invalid or foreign unit/floor membership cannot broaden an export to the building. Application identifiers are distinct from source-supplied official ULPIN assertions. Missing source assertions remain unavailable.

Original-source ZIPs contain `register.pdf`, `register.json`, `sources.json`, a README and unchanged authorized originals under `sources/<source-id>/`. Verify each original's retained SHA-256 before inclusion. An original covering several floors is not silently cropped or rewritten; a property-only evidence packet/card is a different H10 artifact with its own privacy and crop/mask rules. Keep source locators, revisions and hashes in structured manifests.

Retain explicit size/concurrency/capability errors instead of incomplete ZIP success. Historical limits were 128 MiB of originals, one active source bundle per process and 250 buildings per block register; inspect the current implementation before making an operational-capacity claim. Missing originals, checksum errors or unavailable PDF tooling must remain explicit. No new export feature or runtime check is implemented by this plan cleanup.

The [historical export report](evidence/register-controls/export-report.json) and [source-integrity result](evidence/register-controls/reference-integrity.txt) remain evidence at their recorded revision only. Source-bearing exports stay protected pending member/provenance review. Old seed/complete/restore commands and saved synthetic IDs are not current instructions; previous guide text is recoverable at `92e4d04cdeaaa2d8ccc65680c6fea1675dcee88a:docs/REGISTER_CONTROLS_AND_EXPORTS.md`.
