# HEALTH-OBSERVATION-01 — observed versus unobserved dependency health

Code commit `b76d014303fc80ae654bc4a8a940c91029304156`, from publication `3d0a3630d4aa62ca2464cfdd8149b3992917246f`, adds `serviceObservations.redis` and `.worker` to the existing local GET `/api/v1/health`. Each carries typed `status`, `source` and nullable `reason`. Existing service booleans and their conservative overall conjunction remain compatible for valid readiness and unavailable probes. Database/schema/storage behavior, local guard, processor bearer request and its existing 3,000ms timeout are preserved.

The retained [current runtime observation](current-runtime-20261003.md) showed direct Redis PONG while the API's Redis flag was false because the processor was stopped. The API now identifies that false flag as unobserved instead of implying a reported Redis failure. It uses only the existing processor readiness result; no direct Redis probe, client, dependency or health authority was added. Both dependencies retain `source: processor-readiness`, so observed values are explicitly processor-reported rather than independent API measurements.

| Readiness result | Existing processor/Redis/worker booleans | Added Redis/worker observations |
| --- | --- | --- |
| Probe unavailable | false / false / false | `unobserved`, `processor-unavailable` |
| Malformed readiness | false / false / false | `unobserved`, `invalid-readiness` |
| Valid explicit negatives | true / actual Redis / actual worker | `observed`, null reason |
| Valid positives | true / true / true | `observed`, null reason |

Validation requires boolean `ok`, `redis` and `worker` and the processor's existing `ok === (redis && worker)` invariant. Null/incomplete payloads, coerced strings and contradictory success cannot create observed or positive dependency health. A malformed body previously could count as processor availability; it now conservatively stays false. Errors/payloads and bearer values are not exposed in observations. The controller's response schema declares the additive field; lead owns generated OpenAPI/client publication.

Three focused controlled checks pass with no skips: unavailable plus malformed payloads, explicit negatives including Redis true/worker false, and valid positives. These target the observed diagnostic regression; they invoke the production interpretation helper without services. `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/test/health-observations.test.ts` exit0 (3/3), `pnpm typecheck:backend` exit0 (server and API), and code/handoff whitespace checks exit0. Changed controller/helper/schema reviewed; no broader campaign was run.

Private receipt and command logs: `E:/BhuAayam-data/task-data/health-observations-20261003-run01/verification.json`. It pins code, tests, this handoff and the unchanged saved runtime evidence. Owner `01a0f810-a9ec-73b2-9a47-dc2884e09c2d`; exclusive `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, branch `task/desktop-health-observations`. Requested GPT-6.1 Sol/high/default-standard; actual model/effort/tier unexposed. Supplied permissions are never/danger-full-access. Prior runtime branch/checkpoint is preserved; staging is read-only.

No service/profile/source/native/model restart, data/migration/configuration/dependency change, frontend edit, push or deployment occurred. No persistent process/container was started, so no owned runtime cleanup is pending. Verification qualifies controlled interpretation and types only; corrected live HTTP health, independent worker measurement, queue recovery and GF/release remain unqualified.
