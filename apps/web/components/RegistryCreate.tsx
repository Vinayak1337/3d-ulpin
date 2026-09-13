"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CaseRecord,
  RegistryDetail,
  RegistryDraft,
  RegistrySite,
} from "@ulpin/contracts";
import { registryRequest as request } from "@/lib/registry-client";
export default function RegistryCreate({
  detail,
  onDraft,
  onSite,
}: {
  detail: RegistryDetail;
  onDraft: (d: RegistryDraft) => Promise<void>;
  onSite: (id: string) => Promise<void>;
}) {
  const requestKey = useRef<string | null>(null);
  const [tab, setTab] = useState<"record" | "import" | "site">("record"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(""),
    [alias, setAlias] = useState(""),
    [kind, setKind] = useState("space"),
    [use, setUse] = useState("apartment");
  const [outline, setOutline] = useState("[[2,2],[6,2],[6,12],[2,12]]"),
    [lower, setLower] = useState(0),
    [upper, setUpper] = useState(3);
  const [sourceId, setSourceId] = useState(detail.sources[0]?.id || ""),
    [locator, setLocator] = useState(""),
    [related, setRelated] = useState("");
  const [frameId, setFrameId] = useState(""),
    [benchmark, setBenchmark] = useState(""),
    [cases, setCases] = useState<CaseRecord[]>([]),
    [caseId, setCaseId] = useState("");
  useEffect(() => {
    request<CaseRecord[]>("/cases")
      .then(setCases)
      .catch((e) => setError(e.message));
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="registry-create">
      <h2>Add to the registry</h2>
      <div className="create-tabs">
        {(["record", "import", "site"] as const).map((t) => (
          <button
            key={t}
            className="text-button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "record"
              ? "New record"
              : t === "import"
                ? "Import workspace"
                : "New site"}
          </button>
        ))}
      </div>
      {tab === "record" && (
        <>
          <p className="muted">
            Create a draft with explicit source evidence. It will appear in
            current records only after review.
          </p>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Alias
            <input value={alias} onChange={(e) => setAlias(e.target.value)} />
          </label>
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {["space", "parcel", "building", "floor"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          {kind === "space" && (
            <>
              <label>
                Use
                <select value={use} onChange={(e) => setUse(e.target.value)}>
                  {["apartment", "common", "basement", "utility"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <div className="field-pair">
                <label>
                  Lower (m)
                  <input
                    type="number"
                    value={lower}
                    onChange={(e) => setLower(Number(e.target.value))}
                  />
                </label>
                <label>
                  Upper (m)
                  <input
                    type="number"
                    value={upper}
                    onChange={(e) => setUpper(Number(e.target.value))}
                  />
                </label>
              </div>
            </>
          )}
          <label>
            Footprint [x, y] vertices
            <textarea
              rows={4}
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
            />
          </label>
          <label>
            Supporting source
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="">Choose an inspected source</option>
              {detail.sources
                .filter((s) => s.status === "ready")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Source location
            <input
              value={locator}
              onChange={(e) => setLocator(e.target.value)}
              placeholder="Page, feature or measurement row"
            />
          </label>
          <label>
            Within / related building or parcel
            <select
              value={related}
              onChange={(e) => setRelated(e.target.value)}
            >
              <option value="">Unassigned</option>
              {detail.records
                .filter((r) => r.kind !== "space")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="button primary"
            disabled={busy || !name || !alias || !sourceId || !locator}
            onClick={() =>
              run(async () => {
                const footprint = JSON.parse(outline);
                requestKey.current ??= crypto.randomUUID();
                const body = {
                  name,
                  alias,
                  kind,
                  ...(kind === "space"
                    ? {
                        use,
                        geometry: {
                          id: crypto.randomUUID(),
                          name,
                          alias,
                          kind:
                            use === "common"
                              ? "common"
                              : use === "basement" || use === "utility"
                                ? "basement"
                                : "unit",
                          footprint,
                          lower,
                          upper,
                          lowerVerified: false,
                          upperVerified: false,
                          bindings: { footprint: { sourceId, locator } },
                          revision: 1,
                          levelLabel: "",
                        },
                      }
                    : {}),
                  footprint,
                  links: related
                    ? [
                        {
                          type:
                            detail.records.find((r) => r.id === related)
                              ?.kind === "floor"
                              ? "floor"
                              : "within",
                          targetId: related,
                        },
                      ]
                    : [],
                  rights: [],
                  evidence: [{ sourceId, locator }],
                  synthetic: detail.site.synthetic,
                };
                await onDraft(
                  await request<RegistryDraft>(
                    `/sites/${detail.site.id}/drafts`,
                    { body, requestKey: requestKey.current },
                  ),
                );
                requestKey.current = null;
              })
            }
          >
            Create preparation draft
          </button>
        </>
      )}
      {tab === "import" && (
        <>
          <p className="muted">
            Import a built workspace with exactly the same frame and benchmark.
            This creates a review draft and preserves legacy identifiers as
            aliases.
          </p>
          <label>
            Workspace
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Choose workspace</option>
              {cases.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name} · {c.frame.id}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary"
            disabled={busy || !caseId}
            onClick={() =>
              run(async () => {
                const c = cases.find((c) => c.id === caseId)!;
                const result = await request<{ draftId: string }>(
                  `/sites/${detail.site.id}/import`,
                  { caseId, expectedRevision: c.revision },
                );
                await onDraft(
                  await request(`/registry-drafts/${result.draftId}`),
                );
              })
            }
          >
            Import as draft
          </button>
          <h3>Need new source files?</h3>
          <p className="muted">
            Open a preparation workspace to upload, inspect and build geometry
            before importing it.
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const c = await request<{ id: string }>(
                  `/sites/${detail.site.id}/workspace`,
                  {},
                );
                location.href = `/?case=${c.id}`;
              })
            }
          >
            Prepare source inputs
          </button>
        </>
      )}
      {tab === "site" && (
        <>
          <p className="muted">
            A site is a separate local coordinate frame. New sites begin empty;
            no buildings or rights are inferred.
          </p>
          <label>
            Site name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Local frame name
            <input
              value={frameId}
              onChange={(e) => setFrameId(e.target.value)}
              placeholder="LOCAL-SITE-02"
            />
          </label>
          <label>
            Vertical benchmark
            <input
              value={benchmark}
              onChange={(e) => setBenchmark(e.target.value)}
              placeholder="BM-SYNTHETIC-02"
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !name || !frameId || !benchmark}
            onClick={() =>
              run(async () => {
                const s = await request<RegistrySite>("/sites", {
                  name,
                  frame: {
                    id: frameId,
                    horizontalUnit: "m",
                    verticalUnit: "m",
                    benchmark,
                  },
                  synthetic: true,
                });
                await onSite(s.id);
              })
            }
          >
            Create synthetic site
          </button>
        </>
      )}
      {error && (
        <p className="registry-error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Saving…</p>}
    </section>
  );
}
