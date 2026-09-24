# CarpetAreaCheck

Recomputes RERA carpet area from the unit's plan polygon and compares it with the declared figure.

- Shows the arithmetic: floor area inside external walls, minus service shafts, minus exclusive balcony or terrace, equals carpet area (internal partitions stay included, per RERA s.2(k)).
- A difference above the set tolerance becomes a *Needs review* finding; below it, a *Within tolerance* note.
- The consumer provides the computed parts, the declared value with its source, and the tolerance.
