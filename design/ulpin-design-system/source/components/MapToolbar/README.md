# MapToolbar

The floating tool cluster at the top-left of the canvas: Select, Measure distance, Measure area, Section, Impact screening, Underground, then view toggles and Reset camera.

- Icon-only tools carry a tooltip and `aria-label`; the active tool uses `aria-pressed` and `primary-soft`.
- Group tools with separators: tools that act on the scene, then view toggles. Keep it to one row.
- The consumer provides the active tool and which tools the current role may use.
