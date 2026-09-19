# T059 ? Unified Studio frontend completion

Status: implemented and production-build verified on `feat/studio-reference-rebuild`.

This pass finishes the frontend integration identified by the 32-reference audit without changing the normalized source schema or prepared fixture bytes. The Studio is now the product shell for saved datasets, saved registers and saved workspaces as well as the authored reference neighbourhood. Old URLs remain compatibility entry points.

## Delivered

- Shared product header/navigation across Studio, saved datasets, saved property register and processing workspaces.
- Saved-data map embedded in the Studio shell with real 2D/3D renderers, layer opacity, labels, basemap attribution, independent feature selection, findings and quick records.
- Map quick-register pattern retained: floors, units and prepared documents can be inspected without leaving the Studio map. Prepared originals render from exact stored PDF bytes with receipt/hash context.
- Full saved-property register under Studio with Overview, Floors & Units, Evidence, Issues, History and Investigation; retained evidence opens original source bytes; history has revision comparison where retained revisions exist.
- General building section view is available from the full register.
- Saved workspace directory and processing flows remain the operational path for source mapping, measurements, calibration, source comparison, candidate build/review and recording. The local Studio draft is not relabelled as publication.
- Property-aware workspace creation/search and upload destination handoff.
- Shared scoped export UI for datasets/registers with scope, format, include controls and preview; no second export implementation is kept in the saved-data modal.
- Studio workspace navigation guards now cover browser/back navigation, not only the visible Back button.
- Responsive product-shell behavior and current 320/390/768/desktop views use the same route family.

## Qualification

`pnpm typecheck`, `pnpm test:studio`, `pnpm test:ui`, `pnpm test:register-scope`, `pnpm test:spatial`, and `pnpm build` pass. Fresh browser captures under `docs/evidence/t059/final` cover the Studio map, same-page original evidence, fixture register, saved dataset map, full saved register/evidence/history/investigation, directories and responsive routes.

The reference screenshots remain art-direction targets rather than a claim of pixel identity. Saved/imported geometry is not reshaped to imitate the synthetic Studio quarter. Historical geometry is not fabricated where a retained scene revision does not exist.
