# P8 — Officer Studio on the live API

Goal: the Studio judges see must run on the **live backend** with the real demo area, not on the local NYC/Swiss mocks. Today `apps/studio/src/local/routes.ts` has 3 live and 33 local routes, and several of the local ones already exist in the backend.

**Owner (updated 10 October):** the Studio worker F1 under the Claude lead.
- One writer per seam still holds. F1 owns `apps/studio`, `packages/scene`, `packages/ui` and `packages/api-client`.
- Backend gaps found here go to the lead, who assigns them to K1/K2/A1 (or to F1 when the task file names that backend seam).
- Before handing off any UI change, follow `.agents/skills/ui-design-check/SKILL.md` and include its report.
- The UI stays desktop-first and light-only. Never copy sample values from `design-mockup/`.

**State on 10 October:** the route table has **2 live / 31 local** routes. The backend now also serves:
- document proposals and decisions;
- source-only spatial-ML batches and candidate reviews;
- AI extractions;
- `property-cards/generate|read`;
- `identity/assign|reviews`.

---

## P8.1 ⭐ Switch existing backend routes to live

**Gate:** GF-SCENE, GF-REHEARSAL (UI side) · **Depends:** P3.1, P1.2 · **Owner:** frontend

```text
Read docs/frontend/GOAL.md, docs/frontend/PLAN.md, apps/studio/src/local/routes.ts, apps/studio/src/api/
queries.ts, packages/api-client, docs/api/openapi.json.

1. For every route marked local, check whether the backend now serves it (OpenAPI). Produce a table: route,
   backend status (exists | partial | missing), contract differences.
2. Switch to live every route that exists: /areas, /areas/{id}/context, /buildings/{id}/register, /work-queue,
   /import-packages/* (inspect, create, status, questions, answers, review, prepare, commit),
   /sources/{id}/file and any document-pages routes that now exist. Adapt the Studio to the real contract
   (generated client types), not the other way round.
3. Map screens on /areas/{id}/canonical + /buildings/{id}/canonical via packages/contracts toSceneInputs()
   (P1.1), so the scene draws only record-backed values.
4. Keep MSW only for routes that are truly missing; list them with the backend request.
5. Remove the local NYC/Swiss data from the default path (keep it for tests only, clearly separated).

Verify by hand against the live API: Batches lists real work; the map shows the demo area; clicking the
building opens the register and the evidence viewer opens a real RERA page.
```

**Expect back:** an updated route table (live vs local, with reasons), screenshots at 1440×900 of the map/register/evidence on real data, the ui-design-check report, and the list of missing backend routes sent to the backend owner.

---

## P8.2 Review screen on real spatial-ML candidates

**Gate:** GF-AI (UI side) · **Depends:** P4.3, P4.5, P8.1 · **Owner:** frontend

```text
S9 Review currently reads a mocked EXTRACT-02 route. Point it at the real flow:
GET /api/v1/spatial-ml/batches/{id} (room/building candidates with masks/polygons, model id, confidence,
limitations) and the apply/review commands. Show candidates distinctly from reviewed geometry (H99 words),
show the model card summary and "uncalibrated" confidence, and let the officer accept/reject with a reason
and choose the level for room candidates. Roofprint candidates appear on the map in candidate style.
```

**Expect back:** the officer accepting a real room candidate onto a chosen level and a real roofprint candidate, with the canonical record updating. Screenshots and the ui-design-check report.

---

## P8.3 Identity, level schedule and card from the backend

**Gate:** GF-T15, GF-T21 (UI side) · **Depends:** P5.1, P5.5, P7.1, P7.2 · **Owner:** frontend

```text
Replace the browser workflow store (apps/studio/src/local/workflow.ts) for:
- the level schedule review (P5.1 commands),
- assigning proposed codes (P5.5 routes),
- the Property Card and Verify pages (P7.1/P7.2 routes).
After a reload, everything persists from the backend. Delete the browser-store paths that are replaced.
```

**Expect back:** a code assigned in the Studio that survives reload and appears in the canonical record; a card issued from the Studio; Verify reading the backend; the ui-design-check report.

---

## P8.4 ⭐ Live import with progress, agent questions and the learner panel

**Gate:** GF-STREAM, GF-AGENT (UI side) · **Depends:** P8.1, P3.4, P3.5 · **Owner:** F1

The flow also shows the agent's mapping proposals as candidates. Uncertain fields appear as questions with the target's display label and meaning (from P1.0). A small learner panel shows, per chunk, how many fields came from memory, the student, the teacher or the officer, so the falling teacher-call curve is visible live.

```text
Add files -> live inspect -> mapping questions (from the mapping agent, with "needs input" items) -> start import
-> progress via the existing SSE ingestion events (fall back to polling only if SSE is unavailable) ->
buildings appear on the map as chunks commit -> failures show a readable reason and retry.
Use one real messy Indian file from P2.2.
```

**Expect back:** a screen recording (or screenshots) of a real file importing with progress, one question answered, and the result appearing on the map.
