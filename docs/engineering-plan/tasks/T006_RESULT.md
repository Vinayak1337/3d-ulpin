# T006 — coordinate profiles accepted

Accepted for the declared bounded profiles on 18 September 2026. Implementation
commit `67079cb083116f3f88e6ad8f4be9285b28fd4ebd`; documentation encoding fix
`179eb4d499870c181909ff71d10aa0396b1795a9`. Review is self-review, shared cross-runtime
fixtures and independently specified numeric answers, not a claimed second reviewer.

Frames now distinguish engineering/projected/geographic/WGS84-ECEF metadata, source
axis order/direction, metre/mm/international-foot/survey-foot units and vertical
references. The qualified execution subset is explicit local rigid registration
and WGS84 ENU/ECEF placement, including inverse and ordered chains. It is not a
general CRS, geoid/grid-shift or terrain-depth transformer. Unsupported operations
are retained as metadata but cannot execute. No source coordinate is mutated.

Known answers include the rotated feet/down-to-metres registration
`[10,20,5] -> [6.952,26.096,98.476]`, equatorial and polar ECEF bases, mm/foot
conversion, negative vertical offset and a two-step world placement. Round trips
supplement those independent answers. Unknown/surface-relative vertical meaning,
missing explicit origin height, stale refs, cyclic/disjoint chains, wrong axes,
out-of-domain points and overflow are rejected rather than repaired or filled.
The first v1 frame consumer preserves original IDs and anchor metadata, and scopes
free-text benchmark identity to its original frame.

Verification: **40 new Node frame tests**; **137 total core tests**; **36 frame
cases** in local Python **3.13.7** and hosted Python **3.12**. Existing **29 spatial**
and **20 UI** tests, all generated-schema drift checks, typecheck and full production
build passed. Hosted contract conformance **35370697544** passed at the implementation
commit. The existing production-minification-disabled warning remains explicit.

Hosted plan run **35370697441** caught a Windows pipe replacing generated em dashes
with question marks. The JSON task content was intact. The exact generated heading
encoding was corrected; replacement plan run **35370968764** passed. Further backlog
generation uses the discovered existing Python venv directly, not a lossy shell
text renderer. T005 full isolated integration **35369211234** subsequently passed.
The T006 full isolated integration was still running at the recorded check; the
new contract changes do not touch a DB/API writer and do not claim that run passed.

Next: T007 representation/quantity/capability qualification against these frames.
