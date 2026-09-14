"use client";
import { useState } from "react";
import type {
  AreaFinding,
  BuildingDossier,
  Investigation,
} from "@ulpin/contracts";
import { registryRequest as request } from "@/lib/registry-client";

export default function InvestigationPanel({
  dossier,
  checkId,
  onRefresh,
  onInspect,
}: {
  dossier: BuildingDossier;
  checkId?: string;
  onRefresh: () => void;
  onInspect: (finding: AreaFinding) => void;
}) {
  const [active, setActive] = useState<Investigation | null>(null),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const cases = active
    ? [
        active,
        ...dossier.investigations.filter((item) => item.id !== active.id),
      ]
    : dossier.investigations;
  const current = creating ? undefined : active || cases[0];
  const run = async (label: string, action: () => Promise<Investigation>) => {
    setBusy(label);
    setError("");
    try {
      setActive(await action());
      setCreating(false);
      onRefresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Investigation could not be updated.",
      );
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="property-investigation">
      <h3>Investigation record</h3>
      <p className="area-note">
        Record an observation, request missing evidence, and retain your review.
        Requests stay in this local application.
      </p>
      {error && (
        <p role="alert" className="area-warning">
          {error}
        </p>
      )}
      {busy && <p role="status">{busy}</p>}
      {!!cases.length && !creating && (
        <label>
          Investigation
          <select
            value={current?.id || ""}
            onChange={(event) =>
              setActive(
                cases.find((item) => item.id === event.target.value) || null,
              )
            }
          >
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.reference} · {item.status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      )}
      {!!cases.length && (
        <button
          type="button"
          disabled={!!busy}
          onClick={() => setCreating(!creating)}
        >
          {creating ? "Return to existing investigation" : "New investigation"}
        </button>
      )}
      {!current ? (
        <form
          className="officer-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void run("Opening investigation…", () =>
              request<Investigation>("/investigations", {
                buildingId: dossier.canonicalBuildingId,
                expectedRevision: dossier.building.revision,
                reference: String(data.get("reference")),
                classification: String(data.get("classification")),
                notes: String(data.get("notes")),
                findingIds: dossier.issues.map((issue) => issue.id),
                checkId: dossier.check?.stale
                  ? undefined
                  : dossier.check?.id || checkId,
              }),
            );
          }}
        >
          <label>
            Local case reference
            <input
              name="reference"
              required
              placeholder="e.g. Site inspection 04"
            />
          </label>
          <label>
            What needs review?
            <select name="classification">
              <option value="boundary_discrepancy">
                Boundary or occupation discrepancy
              </option>
              <option value="missing_evidence">Missing source evidence</option>
              <option value="utility_information">
                Utility alignment or levels
              </option>
              <option value="source_correction">
                Source or geometry correction
              </option>
            </select>
          </label>
          <label>
            Inspection note
            <textarea
              name="notes"
              placeholder="Describe the source observation and what remains uncertain."
            />
          </label>
          <button className="area-primary" disabled={!!busy}>
            Open local investigation
          </button>
        </form>
      ) : (
        <>
          <div className="property-status">
            <strong>{current.reference}</strong>
            <span>{current.status.replaceAll("_", " ")}</span>
          </div>
          <p className="area-note">
            Building revision {current.inputSnapshot.featureRevision} · block
            revision {current.inputSnapshot.areaRevision}
          </p>
          {current.findings.map((finding) => (
            <button
              key={finding.id}
              className="area-finding"
              onClick={() => onInspect(finding)}
            >
              {finding.message}
            </button>
          ))}
          <form
            className="officer-form"
            key={`${current.id}:${current.revision}`}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void run("Saving review record…", () =>
                request<Investigation>(
                  `/investigations/${current.id}`,
                  {
                    expectedRevision: current.revision,
                    status: data.get("status"),
                    notes: data.get("notes"),
                    nextAction: data.get("nextAction"),
                    reason: data.get("reason"),
                  },
                  "PATCH",
                ),
              );
            }}
          >
            <label>
              Status
              <select name="status" defaultValue={current.status}>
                {[
                  "OPEN",
                  "NEEDS_EVIDENCE",
                  "READY_FOR_REVIEW",
                  "REVIEWED",
                  "CLOSED",
                ].map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Inspection notes
              <textarea name="notes" defaultValue={current.notes} />
            </label>
            <label>
              Next action
              <input name="nextAction" defaultValue={current.nextAction} />
            </label>
            <label>
              Reason for this update
              <textarea name="reason" required />
            </label>
            <button disabled={!!busy}>Save investigation</button>
          </form>
          <h3>Evidence requests</h3>
          {current.requests.map((item) => (
            <div className="property-request" key={item.id}>
              <strong>{item.question}</strong>
              <small>
                {item.status === "ANSWERED"
                  ? "Response retained"
                  : "Waiting for evidence"}
              </small>
              {item.response ? (
                <p>{item.response}</p>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void run("Recording response…", () =>
                      request<Investigation>(
                        `/investigations/${current.id}/requests/${item.id}/answer`,
                        {
                          expectedRevision: current.revision,
                          response: data.get("response"),
                        },
                      ),
                    );
                  }}
                >
                  <label>
                    Response
                    <textarea name="response" required />
                  </label>
                  <button disabled={!!busy}>Record response</button>
                </form>
              )}
            </div>
          ))}
          <form
            className="officer-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void run("Saving evidence request…", () =>
                request<Investigation>(
                  `/investigations/${current.id}/requests`,
                  {
                    expectedRevision: current.revision,
                    question: data.get("question"),
                  },
                ),
              );
            }}
          >
            <label>
              Request a measurement or document
              <textarea
                name="question"
                required
                placeholder="e.g. Supply the utility invert level and its benchmark at the crossing."
              />
            </label>
            <button disabled={!!busy}>Add in-app request</button>
          </form>
          <h3>Case exports</h3>
          <div className="property-action-row">
            {["json", "csv", "html"].map((format) => (
              <a
                key={format}
                href={`/api/v1/investigations/${current.id}/export?format=${format}`}
                target={format === "html" ? "_blank" : undefined}
                rel="noreferrer"
              >
                {format === "html" ? "Print / save PDF" : format.toUpperCase()}{" "}
                ↗
              </a>
            ))}
          </div>
          <details>
            <summary>Decision history · {current.history.length}</summary>
            {current.history.map((entry, index) => (
              <p key={index}>
                <strong>{entry.status.replaceAll("_", " ")}</strong> ·{" "}
                {new Date(entry.time).toLocaleString()}
                <br />
                {entry.reason}
              </p>
            ))}
          </details>
          <p className="area-note">
            Closing this technical record does not issue a legal order or
            certify title.
          </p>
        </>
      )}
    </section>
  );
}
