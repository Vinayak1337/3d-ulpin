# Current work — adopted USP handoffs

<!-- plan-next-gate: GF0 -->

**Updated 24 September 2026 after finale alignment.** The current plan is
[H00](../usp-agent-handoffs/00-README.md), with machine-readable releases and
requirements in [release-plan.json](../usp-agent-handoffs/release-plan.json).
The historical T-number backlog remains CI/evidence history.

**Next gate: GF0.** Reuse the recorded [D0/PACK0 and real D1 milestone](../evidence/usp/continuation-2026-09-23/README.md), inventory the current implementation and pin the H28 matched-data/independent-test contract. Then execute GF1–GF5 in dependency order. All new finale gates remain pending; this is a plan alignment, not a fresh application test pass. Concurrent learning, public portal, MCP, enrichment, renderer experiments and scale remain `full_product` work.

Consolidated application baseline: `staging@45d033baae7ec4e5a572d82459b0062c70a12c95`. Fetch/recheck the live head before implementation. Main remains unchanged. Read [H26](../usp-agent-handoffs/26-identifiers-and-standard-exchange.md), [H27](../usp-agent-handoffs/27-domain-ai-and-cadastral-checks.md), [H28](../usp-agent-handoffs/28-data-acquisition-and-finale-tests.md), shared H01 and UI H99. Do not seed or empty the product to prepare data.

Existing evidence worth consulting when its exact feature is relevant:

| Historical result | Scope |
| --- | --- |
| [T093](tasks/T093_RESULT.md) | Floor-registry implementation evidence at its recorded revision |
| [T092](tasks/T092_RESULT.md) | LiDAR/imagery/elevation display evidence, not universal reconstruction |
| [T091](tasks/T091_RESULT.md) | Responsive map/control observations from that run |
| [T083](tasks/T083_RESULT.md) | Saved-dataset persistence evidence |
| [T079](tasks/T079_RESULT.md) | Complete authored source-package showcase and stated limitations |

Recheck current code/tests rather than inheriting their pass status. Existing
backlog/acceptance/tools stay for CI traceability, not as a competing roadmap.
The [full earlier current-work record](https://github.com/Vinayak1337/3d-ulpin/blob/f623cff897f91bb3ebd4c225f700ac263f7beb72/docs/engineering-plan/CURRENT_WORK.md)
remains available without duplicating it into new instructions.
