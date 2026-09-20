"use client";
import { useState } from "react";
import type { ImportPackage } from "@ulpin/contracts";
import { request } from "../shared/hooks";
import { Badge, Button, Icon } from "../shared/ui";
import MapPlan from "./MapPlan";
export default function ImportReview({
  pkg,
  busy,
  onUpdate,
  onCommitted,
}: {
  pkg: ImportPackage;
  busy: boolean;
  onUpdate: (operation: () => Promise<ImportPackage>) => void;
  onCommitted: (pkg: ImportPackage) => void;
}) {
  const [acknowledgement, setAcknowledgement] = useState("");
  const outstanding = pkg.questions.filter((q) => !q.answer);
  const commit = () =>
    onUpdate(async () => {
      const next = await request<ImportPackage>(
        `/import-packages/${pkg.id}/commit`,
        { expectedRevision: pkg.revision, acknowledgement },
      );
      onCommitted(next);
      return next;
    });
  return (
    <div className="ui-import-review">
      <div className="ui-rail-caption">
        <div>
          <h3>{pkg.name}</h3>
          <p>
            {pkg.features.length} features · {pkg.sourceRevisionIds.length}{" "}
            source{pkg.sourceRevisionIds.length === 1 ? "" : "s"} · revision{" "}
            {pkg.revision}
          </p>
        </div>
        <Badge tone={pkg.state === "COMMITTED" ? "success" : "warning"}>
          {pkg.state.replaceAll("_", " ").toLowerCase()}
        </Badge>
      </div>
      <div className="ui-import-preview">
        <MapPlan features={pkg.features} interactive={false} />
        <span>{pkg.state === "COMMITTED" ? "Recorded source geometry" : "Source geometry preview · not yet recorded"}</span>
      </div>
      {pkg.warnings.length > 0 && (
        <details className="ui-form-details">
          <summary>{pkg.warnings.length} source notices</summary>
          <ul>
            {pkg.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {outstanding.map((question) => (
        <form
          className="ui-question"
          key={question.id}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const claimId = String(data.get("claimId") || "");
            onUpdate(() =>
              request<ImportPackage>(`/import-packages/${pkg.id}/answers`, {
                expectedRevision: pkg.revision,
                questionId: question.id,
                answer:
                  question.kind === "conflicting_claims"
                    ? {
                        choice: "select_claim",
                        claimId,
                        reason: data.get("reason"),
                      }
                    : { choice: "keep_2d", reason: data.get("reason") },
              }),
            );
          }}
        >
          <strong>
            <Icon name="warning" size={16} />
            {question.message}
          </strong>
          {question.kind === "conflicting_claims" && (
            <label>
              Supported claim
              <select name="claimId" required>
                {pkg.factCandidates
                  .filter(
                    (c) =>
                      c.entityId === question.entityId &&
                      c.property === question.property,
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {typeof c.value === "object"
                        ? "Source geometry"
                        : String(c.value)}{" "}
                      · {c.evidenceState}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Review reason
            <input
              name="reason"
              required
              minLength={8}
              placeholder="Record why this treatment is appropriate"
            />
          </label>
          <Button disabled={busy} type="submit">
            {question.kind === "conflicting_claims"
              ? "Select supported claim"
              : "Keep height unknown / 2D"}
          </Button>
        </form>
      ))}
      {pkg.review && (
        <div className="ui-review-summary">
          <Icon name="check" />
          <div>
            <h3>{pkg.state === "COMMITTED" ? "Observations recorded" : "Check complete"}</h3>
            <p>
              {pkg.review.findings.length} findings ·{" "}
              {pkg.review.coverage.length} coverage notices
            </p>
          </div>
        </div>
      )}
      {pkg.review && <section className="ui-boundary-check" aria-label="Boundary check findings">
        <details open={pkg.state !== "COMMITTED" && pkg.review.findings.length > 0}>
          <summary>Findings ({pkg.review.findings.length})</summary>
          {pkg.review.findings.length ? <ul>{pkg.review.findings.map(finding => <li key={finding.id}>
            <strong>{finding.participants?.map(item => item.name).join(", ") || finding.code.replaceAll("_", " ").toLowerCase()}</strong>
            <p>{finding.message}</p>
          </li>)}</ul> : <p>No findings in this technical check.</p>}
        </details>
        <details><summary>Check coverage ({pkg.review.coverage.length})</summary><ul>{pkg.review.coverage.map((notice,index)=><li key={index}>{notice}</li>)}</ul></details>
      </section>}
      <details className="ui-form-details"><summary>Original source files ({pkg.sourceRevisionIds.length})</summary><ul>{pkg.sourceRevisionIds.map((id,index)=><li key={id}><a href={`/api/v1/sources/${id}/file`} target="_blank" rel="noreferrer">Open original {index+1}</a></li>)}</ul></details>
      {pkg.state !== "COMMITTED" && (
        <div className="ui-form-footer">
          {pkg.state === "REVIEWED" ? (
            <>
              <label>
                Source acknowledgement
                <input
                  value={acknowledgement}
                  onChange={(e) => setAcknowledgement(e.target.value)}
                  minLength={12}
                  placeholder="Reviewed source, geometry meaning and limitations"
                />
              </label>
              <Button
                variant="primary"
                onClick={commit}
                disabled={busy || acknowledgement.trim().length < 12}
              >
                Record observations
              </Button>
            </>
          ) : (
            <>
              <span>
                {outstanding.length
                  ? `${outstanding.length} questions need an answer`
                  : "Ready for revision-bound review"}
              </span>
              <Button
                variant="primary"
                disabled={busy || outstanding.length > 0}
                onClick={() =>
                  onUpdate(() =>
                    request<ImportPackage>(
                      `/import-packages/${pkg.id}/review`,
                      { expectedRevision: pkg.revision },
                    ),
                  )
                }
              >
                Review import
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
