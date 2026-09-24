# MapStyle

The reference rendering of the base scene in plan view: neutral ground, roads, parcel lines, grey massing, one green selection with halo, estimated geometry hatched, a finding drawn as its own red solid, and a utility with its uncertainty sleeve.

- Use it as the look for both the 2D map and the 3D scene's materials. Colours come only from `map-*`, `mark-*` and `utility-*` tokens.
- Everything outside the selection sits at `opacity-context`. Labels use `m-label` with a `map-halo` stroke.
- The consumer provides geometry; the style is fixed.
