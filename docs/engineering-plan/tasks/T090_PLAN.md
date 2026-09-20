# T090 — imported parcel identifiers, assigned 3D identities and quiet map

Scope: remove scripted placeholder identity presentation; persist application-issued building/floor identifiers for every saved package, retain legacy aliases and immutable original/canonical snapshots. Source 2D ULPIN is never generated. Source fields accept 14-character alphanumeric strings, including leading zeroes. Missing/legacy demo parcel IDs remain source references, not official ULPINs.

Assignment v1: a 14-character base32 token derived from SHA-256 of the immutable package fingerprint and canonical building ID, prefixed `3D-`; floor suffix is the explicit integer source level (including zero/basements). Persist each assignment with unique database constraints, method, source/object linkage and aliases. Fail on collision/ambiguous floor numbering; never silently substitute another property. This is an application identity system, not ECCMA/official 3D issuance. Different source packages require reviewed reconciliation; no claim that a hash discovers the same physical building.

Preserve snapshots: assignments are a separate registry projection after original/digest verification. New imports and existing saved datasets use the same allocator. Search across saved datasets resolves dataset/building/floor and focuses the shared viewport; old aliases continue to resolve.

Design audit: duplicated identity/status badges, thumbnail repeats the adjacent live map, five inspector tabs compete with primary actions, floor dropdown plus duplicate list, section/isolate controls obscure useful floor selection. Keep compact identity header, visible supplied 2D ID or Not supplied, overview/floors/sources, concise conflict measurements. Move classifications/provenance into Sources. Remove section/isolate controls, retain compatibility engine. Native CSS and existing map; no geometry replacement.

Skills: Appllama usage/design and local taste guidance read. Appllama connector unavailable (no callable research tools); no external screen research claimed. Apply hierarchy and progressive disclosure to the supplied product/reference, not mobile-framework rules.

Validation: pure assignment/records tests, both complete packages, source ULPIN aliases/leading zeroes/multiple buildings, floor identity stability/ambiguity, persisted retry/uniqueness, cross-dataset route, typecheck/build, browser screenshot before/after and actual search-to-camera selection. Deploy current main without resetting data or importing via scripts.
