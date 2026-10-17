# Route reuse and provenance disposition

- `document-proposals.controller.ts`: immutable decisions on saved provisional packets, explicitly **no canonical
  adoption**. It does not decide a canonical building conflict or append a registry revision.
- `officer.controller.ts` → `resolvePreparationFact`: selects a preparation claim only; `locked()` rejects
  `COMMITTED` packages. No unresolved decision or checked-page input. `preparation-facts` also rejects committed
  packages and would wrongly assert a human transcription for the D2 worker.
- Registry draft/correction editing needs a real footprint; source-only packages explicitly reject GIS corrections.
  There is no supported post-commit source-claim provenance correction route. Installed packages/history are left
  intact; the import fix applies to new requests. Canonical source-only legacy claims with missing transcriber
  metadata conservatively project as candidates, without rewriting their stored historical method.
- `events.controller.ts` is a read-only bounded notification stream, not a decision command.

Therefore one command in the existing officer module is justified for reviewed canonical conflict decisions.
It uses existing registry/physical revision tables, not a new decision store. An unresolved decision must retain
both alternatives and the null/conflicting headline. A selected alternative can become reviewed only via this
explicit command and must carry a checked page citation and local operator attribution.

D2 Tower truth does **not** settle G+41 versus G+42: `truthKind=conflict_preservation_with_registry_scope_gaps`,
`floorExpression.state=conflicting`, and no independent Tower-keyed approved revision was located. The live demo
will record **unresolved, needs source**, not select or normalize a floor count. Magnolia has no storey claims in
its installed source package; nothing will be fabricated for it.
