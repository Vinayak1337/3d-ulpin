"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CaseDetail, UnitSpec, Point2 } from "@ulpin/contracts";
import PlanView from "@/components/PlanView";
import { api } from "@/lib/client";
import { Button, ErrorState, LoadingState, Badge } from "../shared/ui";
import { useResource, useMutation } from "../shared/hooks";
import { routes, withQuery } from "../shared/routes";
import "./geometry-workspace.css";
export default function GeometryWorkspace({ caseId }: { caseId: string }) {
  const resource = useResource<CaseDetail>(`/cases/${caseId}`),
    mutation = useMutation(),
    search = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [floor, setFloor] = useState("all"),
    [spatial, setSpatial] = useState(""),
    [levels, setLevels] = useState("");
  const detail = resource.data,
    unit = detail?.units.find((u) => u.id === selectedId);
  const [lower, setLower] = useState(""),
    [upper, setUpper] = useState("");
  useEffect(() => {
    setLower(unit?.lower == null ? "" : String(unit.lower));
    setUpper(unit?.upper == null ? "" : String(unit.upper));
  }, [unit]);
  const building = search.get("building"),
    area = search.get("area");
  const back = building
    ? routes.workspace(building, area)
    : routes.case(caseId);
  async function save(unit: UnitSpec, footprint: Point2[]) {
    const saved = await mutation.run(async () => {
      await api.editUnit(caseId, unit.id, {
        expectedRevision: unit.revision,
        footprint,
      });
      await resource.reload();
      return true;
    });
    return !!saved;
  }
  if (!detail)
    return resource.error ? (
      <ErrorState message={resource.error} retry={resource.reload} />
    ) : (
      <LoadingState label="Opening geometry draft" />
    );
  return (
    <main className="geometry-workspace">
      <header>
        <div>
          <Link href={back}>← Back to plans</Link>
          <h1>Geometry draft</h1>
          <p>{detail.case.name}</p>
        </div>
        <Badge>Revision {detail.case.revision}</Badge>
        <Button
          disabled={mutation.busy || !detail.units.length}
          variant="primary"
          onClick={() =>
            void mutation.run(async () => {
              await api.build(caseId, detail.case.revision);
              await resource.reload();
            })
          }
        >
          Rebuild draft
        </Button>
      </header>
      {mutation.error && (
        <ErrorState message={mutation.error} retry={resource.reload} />
      )}
      <div className="geometry-workspace-grid">
        <aside>
          <h2>Spaces</h2>
          <select
            aria-label="Geometry floor"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          >
            <option value="all">All floors</option>
            {[...new Set(detail.units.map((u) => u.levelLabel))].map(
              (label) => (
                <option key={label}>{label}</option>
              ),
            )}
          </select>
          {detail.units
            .filter((u) => floor === "all" || u.levelLabel === floor)
            .map((u) => (
              <button
                key={u.id}
                aria-pressed={u.id === selectedId}
                onClick={() => setSelectedId(u.id)}
              >
                <strong>{u.name}</strong>
                <small>
                  {u.levelLabel} · {u.alias}
                </small>
              </button>
            ))}
          <details>
            <summary>Prepare from native sources</summary>
            <label>
              Spatial source
              <select
                value={spatial}
                onChange={(e) => setSpatial(e.target.value)}
              >
                <option value="">Choose source</option>
                {detail.sources
                  .filter((s) => s.profile === "parcel-local-json-v1")
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Level schedule
              <select
                value={levels}
                onChange={(e) => setLevels(e.target.value)}
              >
                <option value="">No schedule</option>
                {detail.sources
                  .filter((s) => s.profile === "levels-csv-v1")
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              disabled={!spatial || mutation.busy}
              onClick={() =>
                void mutation.run(async () => {
                  await api.prepare(caseId, spatial, levels || undefined);
                  await resource.reload();
                })
              }
            >
              Prepare geometry
            </Button>
          </details>
        </aside>
        <section>
          <PlanView
            units={detail.units}
            context={detail.context}
            selectedId={selectedId}
            onSelect={setSelectedId}
            floor={floor}
            isolate={false}
            finding={null}
            onSave={save}
            busy={mutation.busy}
          />
        </section>
        <aside>
          <h2>{unit?.name || "Choose a space"}</h2>
          {unit ? (
            <>
              <p>
                Drag footprint vertices or edit source levels. Each save creates
                a draft revision.
              </p>
              <label>
                Lower level (m)
                <input
                  type="number"
                  value={lower}
                  onChange={(e) => setLower(e.target.value)}
                />
              </label>
              <label>
                Upper level (m)
                <input
                  type="number"
                  value={upper}
                  onChange={(e) => setUpper(e.target.value)}
                />
              </label>
              <Button
                disabled={mutation.busy || !lower || !upper}
                onClick={() =>
                  void mutation.run(async () => {
                    await api.editUnit(caseId, unit.id, {
                      expectedRevision: unit.revision,
                      lower: Number(lower),
                      upper: Number(upper),
                    });
                    await resource.reload();
                  })
                }
              >
                Save levels
              </Button>
              <p>{detail.case.frame.benchmark}</p>
              <small>Rebuild and review before updating the register.</small>
            </>
          ) : (
            <p>Select a room on the plan or in the list.</p>
          )}
        </aside>
      </div>
    </main>
  );
}
