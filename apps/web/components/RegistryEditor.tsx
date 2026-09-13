"use client";
import { useEffect, useState } from "react";
import type {
  RegistryRecord,
  RegistryDraft,
  RegistryDetail,
  RegistryReview,
} from "@ulpin/contracts";
import { registryRequest } from "@/lib/registry-client";
import { number } from "@/lib/ui/geometry";
import RegistryFootprintDiff from "./RegistryFootprintDiff";
export default function RegistryEditor({
  draft,
  detail,
  onSaved,
  onReviewed,
  onRecorded,
  onSelectFinding,
  onPreview,
}: {
  draft: RegistryDraft;
  detail: RegistryDetail;
  onSaved: (d: RegistryDraft) => void;
  onReviewed: (r: RegistryReview | null) => void;
  onRecorded: () => Promise<void>;
  onSelectFinding: (id: string) => void;
  onPreview: (id: string) => void;
}) {
  const [recordId, setRecordId] = useState(draft.records[0]?.id || "");
  const record =
    draft.records.find((r) => r.id === recordId) ?? draft.records[0];
  const [form, setForm] = useState<RegistryRecord>(record);
  const [outline, setOutline] = useState(JSON.stringify(record.footprint));
  const [review, setReview] = useState<RegistryReview | null>(null),
    [ack, setAck] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    setForm(record);
    setOutline(JSON.stringify(record.footprint));
    setDirty(false);
    setAck("");
    setReview(null);
    onReviewed(null);
  }, [record, draft.revision]); // parent callback does not control this reset
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const change = (next: RegistryRecord) => {
    setForm(next);
    setDirty(true);
    setAck("");
    setReview(null);
    onReviewed(null);
  };
  const save = async () => {
    const { id, siteId, identifier, revision, ...body } = form;
    const footprint = JSON.parse(outline);
    body.footprint = footprint;
    if (body.geometry) {
      const { area, height, volume, ...geometry } = body.geometry;
      body.geometry = { ...geometry, footprint } as any;
    }
    const result = await registryRequest<RegistryDraft>(
      `/registry-drafts/${draft.id}`,
      { expectedRevision: draft.revision, recordId: form.id, body },
      "PATCH",
    );
    onSaved(result);
  };
  const current = detail.records.find((r) => r.id === record.id);
  return (
    <section className="registry-editor">
      <div className="section-heading">
        <span>Proposed revision</span>
        <span className="status-tag">Draft {draft.revision}</span>
      </div>
      <p className="muted">
        Current records stay unchanged until this exact snapshot is reviewed.
      </p>
      {draft.records.length > 1 && (
        <label>
          Record
          <select
            value={recordId}
            onChange={(e) => setRecordId(e.target.value)}
          >
            {draft.records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.alias}
              </option>
            ))}
          </select>
        </label>
      )}
      <h2>{record.name}</h2>
      <code className="record-code">{record.identifier}</code>
      <label>
        Name
        <input
          value={form.name}
          onChange={(e) => change({ ...form, name: e.target.value })}
        />
      </label>
      {form.geometry && (
        <div className="field-pair">
          <label>
            Lower limit (m)
            <input
              aria-label="Draft lower limit"
              type="number"
              step="0.1"
              value={form.geometry.lower}
              onChange={(e) =>
                change({
                  ...form,
                  geometry: {
                    ...form.geometry!,
                    lower: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            Upper limit (m)
            <input
              aria-label="Draft upper limit"
              type="number"
              step="0.1"
              value={form.geometry.upper}
              onChange={(e) =>
                change({
                  ...form,
                  geometry: {
                    ...form.geometry!,
                    upper: Number(e.target.value),
                  },
                })
              }
            />
          </label>
        </div>
      )}
      {current?.geometry && (
        <p className="muted">
          Current: {number(current.geometry.lower)}–
          {number(current.geometry.upper)} m · {number(current.geometry.volume)}{" "}
          m³
        </p>
      )}
      <details>
        <summary>Edit footprint coordinates</summary>
        <label>
          Local [x, y] vertices
          <textarea
            aria-label="Draft footprint"
            rows={4}
            value={outline}
            onChange={(e) => {
              setOutline(e.target.value);
              setDirty(true);
              setAck("");
              setReview(null);
              onReviewed(null);
            }}
          />
        </label>
      </details>
      <h3>Recorded rights</h3>
      {form.rights.map((right, i) => (
        <div className="right-editor" key={i}>
          <label>
            Fictional party
            <input
              value={right.party}
              onChange={(e) =>
                change({
                  ...form,
                  rights: form.rights.map((r, j) =>
                    j === i ? { ...r, party: e.target.value } : r,
                  ),
                })
              }
            />
          </label>
          <label>
            Right type
            <select
              value={right.type}
              onChange={(e) =>
                change({
                  ...form,
                  rights: form.rights.map((r, j) =>
                    j === i
                      ? { ...r, type: e.target.value as typeof r.type }
                      : r,
                  ),
                })
              }
            >
              <option value="ownership_claim">Ownership claim</option>
              <option value="shared_use">Shared use</option>
              <option value="easement">Easement</option>
            </select>
          </label>
          <label>
            Supporting source
            <select
              value={right.evidence.sourceId}
              onChange={(e) =>
                change({
                  ...form,
                  rights: form.rights.map((r, j) =>
                    j === i
                      ? {
                          ...r,
                          evidence: { ...r.evidence, sourceId: e.target.value },
                        }
                      : r,
                  ),
                })
              }
            >
              {detail.sources
                .filter(
                  (s) =>
                    s.inspection && ["ready", "needs_input"].includes(s.status),
                )
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
              value={right.evidence.locator}
              onChange={(e) =>
                change({
                  ...form,
                  rights: form.rights.map((r, j) =>
                    j === i
                      ? {
                          ...r,
                          evidence: { ...r.evidence, locator: e.target.value },
                        }
                      : r,
                  ),
                })
              }
            />
          </label>
          <button
            className="text-button"
            onClick={() =>
              change({ ...form, rights: form.rights.filter((_, j) => i !== j) })
            }
          >
            Remove right
          </button>
        </div>
      ))}
      <button
        className="text-button"
        disabled={!detail.sources.length}
        onClick={() =>
          change({
            ...form,
            rights: [
              ...form.rights,
              {
                party: "",
                type: "ownership_claim",
                evidence: { sourceId: detail.sources[0].id, locator: "page 1" },
              },
            ],
          })
        }
      >
        Add recorded right
      </button>
      <h3>Relationships</h3>
      {form.links.map((link, i) => (
        <div className="field-pair" key={i}>
          <label>
            Relationship
            <select
              value={link.type}
              onChange={(e) =>
                change({
                  ...form,
                  links: form.links.map((l, j) =>
                    j === i
                      ? { ...l, type: e.target.value as typeof l.type }
                      : l,
                  ),
                })
              }
            >
              {["within", "floor", "serves", "crosses"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Related record
            <select
              value={link.targetId}
              onChange={(e) =>
                change({
                  ...form,
                  links: form.links.map((l, j) =>
                    j === i ? { ...l, targetId: e.target.value } : l,
                  ),
                })
              }
            >
              {detail.records
                .filter((r) => r.id !== form.id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="text-button"
            onClick={() =>
              change({ ...form, links: form.links.filter((_, j) => j !== i) })
            }
          >
            Remove relationship
          </button>
        </div>
      ))}
      <button
        className="text-button"
        disabled={detail.records.length < 2}
        onClick={() =>
          change({
            ...form,
            links: [
              ...form.links,
              {
                type: "within",
                targetId: detail.records.find((r) => r.id !== form.id)!.id,
              },
            ],
          })
        }
      >
        Add relationship
      </button>
      {error && (
        <p className="registry-error" role="alert">
          {error}
        </p>
      )}
      <div className="editor-actions">
        <button
          className="button"
          disabled={!!busy || !dirty}
          onClick={() => run("Saving draft", save)}
        >
          Save draft
        </button>
        <button
          className="button primary"
          disabled={!!busy || dirty}
          onClick={() =>
            run("Building checks", async () => {
              const r = await registryRequest<RegistryReview>(
                `/registry-drafts/${draft.id}/review`,
                {
                  expectedRevision: draft.revision,
                  expectedSiteRevision: detail.site.revision,
                },
              );
              setAck("");
              setReview(r);
              onReviewed(r);
            })
          }
        >
          Build and check
        </button>
      </div>
      {busy && <p role="status">{busy}…</p>}
      {dirty && <p className="muted">Save changes before building checks.</p>}
      {review && (
        <section className="review-results">
          <h3>Review snapshot</h3>
          <p className="muted">
            Draft {review.draftRevision} against registry revision{" "}
            {review.siteRevision}. Includes current neighbouring spaces.
          </p>
          {review.records.map((r) => {
            const before = review.before.find((b) => b.id === r.id);
            return (
              <div className="review-diff" key={r.id}>
                <strong>{r.alias}</strong>
                <p>
                  {before
                    ? "Current record → proposed revision"
                    : "New registry record"}
                </p>
                {before && before.name !== r.name && (
                  <p>
                    Name: {before.name} → {r.name}
                  </p>
                )}
                {before &&
                  JSON.stringify(before.footprint) !==
                    JSON.stringify(r.footprint) && (
                    <RegistryFootprintDiff
                      before={before.footprint}
                      after={r.footprint}
                    />
                  )}
                {r.geometry && (
                  <p>
                    {before?.geometry
                      ? `${number(before.geometry.lower)}–${number(before.geometry.upper)} m → `
                      : ""}
                    {number(r.geometry.lower)}–{number(r.geometry.upper)} m ·{" "}
                    {number(r.geometry.volume)} m³
                  </p>
                )}
                <p>
                  Rights:{" "}
                  {before?.rights
                    .map((x) => `${x.party} (${x.type.replaceAll("_", " ")})`)
                    .join(", ") || "None"}{" "}
                  →{" "}
                  {r.rights
                    .map((x) => `${x.party} (${x.type.replaceAll("_", " ")})`)
                    .join(", ") || "None"}
                </p>
                <p>
                  Relationships:{" "}
                  {before?.links
                    .map(
                      (l) =>
                        `${l.type} ${detail.records.find((x) => x.id === l.targetId)?.name || l.targetId}`,
                    )
                    .join("; ") || "None"}{" "}
                  →{" "}
                  {r.links
                    .map(
                      (l) =>
                        `${l.type} ${detail.records.find((x) => x.id === l.targetId)?.name || l.targetId}`,
                    )
                    .join("; ") || "None"}
                </p>
                {[...r.evidence, ...r.rights.map((x) => x.evidence)].map(
                  (b, i) => (
                    <button
                      key={i}
                      className="evidence-link"
                      onClick={() => onPreview(b.sourceId)}
                    >
                      <span>
                        {detail.sources.find((s) => s.id === b.sourceId)
                          ?.name || "Source file"}
                      </span>
                      <small>{b.locator}</small>
                    </button>
                  ),
                )}
              </div>
            );
          })}
          <details className="review-neighbours">
            <summary>Affected neighbours and related records</summary>
            {[
              ...new Set(
                review.findings
                  .filter((f) =>
                    f.unitIds.some((id) =>
                      review.records.some((r) => r.id === id),
                    ),
                  )
                  .flatMap((f) => f.unitIds)
                  .concat(
                    review.records.flatMap((r) =>
                      r.links.map((l) => l.targetId),
                    ),
                  ),
              ),
            ]
              .filter((id) => !review.records.some((r) => r.id === id))
              .map((id) => {
                const neighbour = detail.records.find((r) => r.id === id);
                return neighbour ? (
                  <p key={id}>
                    <strong>{neighbour.name}</strong>
                    <br />
                    <code>{neighbour.identifier}</code> · revision{" "}
                    {neighbour.revision}
                    {neighbour.geometry
                      ? ` · ${number(neighbour.geometry.lower)}–${number(neighbour.geometry.upper)} m`
                      : ""}
                  </p>
                ) : null;
              })}
          </details>
          <div className="findings-list">
            {review.findings
              .filter((f) => f.code !== "BOUNDARY_CONTACT")
              .map((f) => (
                <button
                  key={f.id}
                  className={`finding-item ${f.severity}`}
                  onClick={() => onSelectFinding(f.id)}
                >
                  <strong>{f.title}</strong>
                  <span>{f.description}</span>
                </button>
              ))}
          </div>
          <p className="muted">
            {
              review.findings.filter((f) => f.code === "BOUNDARY_CONTACT")
                .length
            }{" "}
            boundary contacts have zero intersection volume.
          </p>
          {!review.findings.some((f) => f.severity === "error") && (
            <>
              <label>
                Warning acknowledgement
                <textarea
                  value={ack}
                  onChange={(e) => setAck(e.target.value)}
                  placeholder="Explain any remaining uncertainty in this synthetic review."
                />
              </label>
              <p className="muted">
                Technical demo review only. Recording does not confer ownership
                or legal approval.
              </p>
              <button
                className="button primary"
                disabled={
                  !!busy ||
                  (review.findings.some((f) => f.severity === "warning") &&
                    !ack.trim())
                }
                onClick={() =>
                  run("Recording revision", async () => {
                    await registryRequest(
                      `/registry-reviews/${review.id}/commit`,
                      { acknowledgement: ack },
                    );
                    await onRecorded();
                  })
                }
              >
                Record in demo registry
              </button>
            </>
          )}
        </section>
      )}
    </section>
  );
}
