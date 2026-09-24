# LayerPanel

The Layers view of the left rail: a Colour by control on top, then layer groups with swatches and toggles.

- Colour by offers None, Rights, Readiness, Findings, Utilities; only one at a time, and it swaps the Legend.
- Groups: Context (ground, roads, public land, water), Cadastre (parcels, buildings, spaces), Below ground (basements, utilities, tunnels), Evidence (photos, survey controls).
- Toggles use `role="switch"`. A layer with no data shows "No data" in `ink-muted` and stays toggleable.
