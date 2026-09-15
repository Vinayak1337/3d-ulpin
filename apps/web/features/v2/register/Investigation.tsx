"use client";
import { useState } from "react";
import type {
  AreaFinding,
  BuildingDossier,
  Investigation as Case,
} from "@ulpin/contracts";
import { request, useMutation } from "../shared/hooks";
import { Badge, Button, Dialog, EmptyState, Panel } from "../shared/ui";
import { dateTime, locator, number, words } from "./model";
import styles from "./register.module.css";

const transitions: Record<Case["status"], Case["status"][]> = {
  OPEN: ["NEEDS_EVIDENCE", "READY_FOR_REVIEW"],
  NEEDS_EVIDENCE: ["OPEN", "READY_FOR_REVIEW"],
  READY_FOR_REVIEW: ["OPEN", "NEEDS_EVIDENCE", "REVIEWED"],
  REVIEWED: ["OPEN", "CLOSED"],
  CLOSED: ["OPEN"],
};
const classifications = {
  boundary_discrepancy: "Boundary or occupation discrepancy",
  missing_evidence: "Missing source evidence",
  utility_information: "Utility alignment or levels",
  source_correction: "Source or geometry correction",
};
export default function Investigation({
  dossier,
  onRefresh,
  onMap,
  initialFindingId,
  initialCaseId,
}: {
  dossier: BuildingDossier;
  onRefresh: () => Promise<void>;
  onMap: (finding: AreaFinding) => void;
  initialFindingId?: string;
  initialCaseId?: string;
}) {
  const [selected, setSelected] = useState(
      initialCaseId || dossier.investigations[0]?.id || "",
    ),
    [active, setActive] = useState<Case | null>(null),
    [create, setCreate] = useState(
      !!initialFindingId || !dossier.investigations.length,
    ),
    [statusDialog, setStatusDialog] = useState<Case["status"] | null>(null),
    [tab, setTab] = useState("Summary");
  const mutation = useMutation();
  const useActive =
    active &&
    !dossier.investigations.some(
      (item) => item.id === active.id && item.revision >= active.revision,
    );
  const cases = useActive
    ? [
        active,
        ...dossier.investigations.filter((item) => item.id !== active.id),
      ]
    : dossier.investigations;
  const current = cases.find((item) => item.id === selected) || cases[0];
  const evidenceOptions = dossier.sources.flatMap((source) =>
    [
      ...new Map(
        source.evidence
          .filter((item) => item.partId || item.featureId)
          .map((item) => [JSON.stringify(item), item]),
      ).entries(),
    ].map(([key, evidence]) => ({
      key,
      evidence,
      label: `${source.name} · ${locator(evidence)}`,
    })),
  );
  const update = async (operation: () => Promise<Case>) => {
    const result = await mutation.run(operation);
    if (result) {
      setActive(result);
      setSelected(result.id);
      setCreate(false);
      setStatusDialog(null);
      await onRefresh();
    }
  };
  const stale =
    !!current &&
    (current.inputSnapshot.areaRevision !== dossier.area.revision ||
      current.inputSnapshot.featureRevision !== dossier.building.revision ||
      !!dossier.check?.stale);
  return (
    <div className={styles.investigationLayout}>
      <div className={styles.investigationMain}>
        <div className={styles.tabTitle}>
          <div>
            <h2>Investigation</h2>
            <p>Local evidence and decision record</p>
          </div>
          <Button onClick={() => setCreate(true)} disabled={mutation.busy}>
            + New case
          </Button>
        </div>
        {mutation.error && !statusDialog && (
          <div role="alert" className={styles.error}>
            {mutation.error}
            <Button variant="ghost" onClick={() => void onRefresh()}>
              Refresh record
            </Button>
          </div>
        )}
        {mutation.busy && (
          <p role="status" className={styles.note}>
            Saving case…
          </p>
        )}
        {!!cases.length && (
          <div className={styles.casePicker}>
            <label>
              Investigation
              <select
                value={current?.id || ""}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setCreate(false);
                  setTab("Summary");
                }}
              >
                {cases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.reference} · {words(item.status)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {create ? (
          <Panel title="Open an investigation">
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void update(() =>
                  request<Case>("/investigations", {
                    buildingId: dossier.canonicalBuildingId,
                    expectedRevision: dossier.building.revision,
                    requestKey: crypto.randomUUID(),
                    reference: String(data.get("reference")),
                    classification: data.get("classification"),
                    notes: data.get("notes"),
                    findingIds: dossier.check?.stale
                      ? []
                      : data.getAll("finding"),
                    checkId: dossier.check?.stale
                      ? undefined
                      : dossier.check?.id,
                  }),
                );
              }}
            >
              <label>
                Local case reference
                <input
                  name="reference"
                  required
                  maxLength={200}
                  placeholder="Inspection reference"
                />
              </label>
              <label>
                Case type
                <select name="classification">
                  {Object.entries(classifications).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Initial observation
                <textarea
                  name="notes"
                  maxLength={10000}
                  placeholder="What needs review?"
                />
              </label>
              {!!dossier.issues.length && !dossier.check?.stale && (
                <fieldset>
                  <legend>Include current findings</legend>
                  {dossier.issues.map((item) => (
                    <label key={item.id} className={styles.checkbox}>
                      <input
                        name="finding"
                        type="checkbox"
                        value={item.id}
                        defaultChecked={
                          initialFindingId ? item.id === initialFindingId : true
                        }
                      />
                      <span>{item.message}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {dossier.check?.stale && (
                <p className={styles.warning}>
                  The check is stale. Create an evidence-only case or rerun
                  checks in the block.
                </p>
              )}
              <div className={styles.actions}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={mutation.busy}
                >
                  Open local case
                </Button>
                {!!cases.length && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCreate(false)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </Panel>
        ) : !current ? (
          <EmptyState
            title="No investigation yet"
            description="Open a local case to track evidence requests and a review."
            action={
              <Button onClick={() => setCreate(true)}>Open a case</Button>
            }
          />
        ) : (
          <>
            <Panel>
              <div className={styles.caseSummary}>
                <div>
                  <span className={styles.eyebrow}>Case reference</span>
                  <h3>{current.reference}</h3>
                </div>
                <Badge
                  tone={
                    current.status === "CLOSED"
                      ? "neutral"
                      : current.status === "REVIEWED"
                        ? "success"
                        : "info"
                  }
                >
                  {words(current.status)}
                </Badge>
                <dl>
                  <div>
                    <dt>Type</dt>
                    <dd>
                      {classifications[
                        current.classification as keyof typeof classifications
                      ] || words(current.classification)}
                    </dd>
                  </div>
                  <div>
                    <dt>Opened</dt>
                    <dd>{dateTime(current.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Record revision</dt>
                    <dd>{current.revision}</dd>
                  </div>
                  <div>
                    <dt>Operator</dt>
                    <dd>Local operator</dd>
                  </div>
                </dl>
              </div>
            </Panel>
            {stale && (
              <div className={styles.warning}>
                This case retains an earlier input snapshot. Open a new case to
                review current geometry.
              </div>
            )}
            <div
              className={styles.segmented}
              aria-label="Investigation sections"
            >
              {["Summary", "Evidence requests", "Decisions"].map((value) => (
                <button
                  key={value}
                  aria-pressed={tab === value}
                  onClick={() => setTab(value)}
                >
                  {value}
                  {value === "Evidence requests"
                    ? ` (${current.requests.length})`
                    : ""}
                </button>
              ))}
            </div>
            {tab === "Summary" && (
              <>
                <Panel
                  title={`Findings in this case · ${current.findings.length}`}
                >
                  {current.findings.length ? (
                    current.findings.map((finding) => (
                      <div key={finding.id} className={styles.findingCard}>
                        <div>
                          <Badge tone="warning">
                            {words(finding.category)}
                          </Badge>
                          <h3>{finding.message}</h3>
                          <small>{finding.code}</small>
                        </div>
                        <div className={styles.actions}>
                          {finding.areaM2 !== undefined && (
                            <strong>{number(finding.areaM2, "m²")}</strong>
                          )}
                          {finding.volumeM3 !== undefined && (
                            <strong>{number(finding.volumeM3, "m³")}</strong>
                          )}
                          <Button
                            onClick={() => onMap(finding)}
                            variant="secondary"
                          >
                            View on map
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      title="Evidence-only case"
                      description="No computed findings were included in this case."
                    />
                  )}
                </Panel>
                <Panel title="Inspection notes">
                  <form
                    className={styles.form}
                    key={`${current.id}:${current.revision}`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      void update(() =>
                        request<Case>(
                          `/investigations/${current.id}`,
                          {
                            expectedRevision: current.revision,
                            notes: data.get("notes"),
                            nextAction: String(
                              data.get("nextAction") ||
                                "Review retained evidence",
                            ),
                            reason: data.get("reason"),
                          },
                          "PATCH",
                        ),
                      );
                    }}
                  >
                    <label>
                      Notes
                      <textarea
                        name="notes"
                        defaultValue={current.notes}
                        maxLength={10000}
                      />
                    </label>
                    <label>
                      Next action
                      <input
                        name="nextAction"
                        defaultValue={current.nextAction}
                        maxLength={2000}
                      />
                    </label>
                    <label>
                      Reason for update
                      <input name="reason" required maxLength={2000} />
                    </label>
                    <Button type="submit" disabled={mutation.busy}>
                      Save notes
                    </Button>
                  </form>
                </Panel>
              </>
            )}
            {tab === "Evidence requests" && (
              <>
                <Panel title="Evidence requests">
                  {current.requests.length ? (
                    current.requests.map((item) => (
                      <article key={item.id} className={styles.requestCard}>
                        <div className={styles.actions}>
                          <Badge
                            tone={
                              item.status === "ANSWERED" ? "success" : "warning"
                            }
                          >
                            {item.status === "ANSWERED"
                              ? "Response retained"
                              : "Awaiting evidence"}
                          </Badge>
                          <small>{dateTime(item.createdAt)}</small>
                        </div>
                        <h3>{item.question}</h3>
                        {item.response ? (
                          <>
                            <p>{item.response}</p>
                            {item.evidence.map((value, index) => (
                              <a
                                key={index}
                                href={`/api/v1/sources/${value.sourceRevisionId}/file`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Supporting source · {locator(value)} ↗
                              </a>
                            ))}
                          </>
                        ) : (
                          <form
                            className={styles.form}
                            onSubmit={(event) => {
                              event.preventDefault();
                              const data = new FormData(event.currentTarget);
                              const chosenEvidence = evidenceOptions.find(
                                (option) => option.key === data.get("source"),
                              )?.evidence;
                              void update(() =>
                                request<Case>(
                                  `/investigations/${current.id}/requests/${item.id}/answer`,
                                  {
                                    expectedRevision: current.revision,
                                    response: data.get("response"),
                                    evidence: chosenEvidence
                                      ? [chosenEvidence]
                                      : [],
                                  },
                                ),
                              );
                            }}
                          >
                            <label>
                              Response
                              <textarea
                                name="response"
                                required
                                maxLength={2000}
                              />
                            </label>
                            <label>
                              Supporting source
                              <select name="source">
                                <option value="">No additional source</option>
                                {evidenceOptions.map((option) => (
                                  <option key={option.key} value={option.key}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <Button type="submit" disabled={mutation.busy}>
                              Record response
                            </Button>
                          </form>
                        )}
                      </article>
                    ))
                  ) : (
                    <EmptyState title="No evidence requests" />
                  )}
                </Panel>
                <Panel title="Request evidence">
                  <form
                    key={`${current.id}:${current.requests.length}`}
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      void update(() =>
                        request<Case>(
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
                      Measurement or document needed
                      <textarea
                        name="question"
                        required
                        maxLength={2000}
                        placeholder="Describe the missing evidence."
                      />
                    </label>
                    <p className={styles.note}>
                      Saved in this local case. No message is sent.
                    </p>
                    <Button
                      type="submit"
                      disabled={mutation.busy || current.status === "CLOSED"}
                    >
                      Add evidence request
                    </Button>
                  </form>
                </Panel>
              </>
            )}
            {tab === "Decisions" && (
              <Panel title="Decision record">
                <ol className={styles.timeline}>
                  {current.history.map((entry, index) => (
                    <li key={index}>
                      <span className={styles.timelineDot} />
                      <div>
                        <strong>{words(entry.status)}</strong>
                        <p>{entry.reason}</p>
                        <small>
                          {entry.actor} · {dateTime(entry.time)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}
          </>
        )}
      </div>
      {current && !create && (
        <aside className={styles.investigationAside}>
          <Panel title="Next action">
            <p>
              {current.nextAction ||
                "Review the current evidence and decide the next step."}
            </p>
            <div className={styles.stack}>
              {transitions[current.status].map((status) => (
                <Button
                  key={status}
                  variant={status === "OPEN" ? "secondary" : "primary"}
                  disabled={mutation.busy}
                  onClick={() => {
                    mutation.clearError();
                    setStatusDialog(status);
                  }}
                >
                  {status === "OPEN"
                    ? current.status === "CLOSED"
                      ? "Reopen case"
                      : "Return to open"
                    : status === "CLOSED"
                      ? "Close reviewed case"
                      : status === "REVIEWED"
                        ? "Record review"
                        : status === "READY_FOR_REVIEW"
                          ? "Ready for review"
                          : "Request more evidence"}
                </Button>
              ))}
            </div>
            {current.requests.some((item) => item.status === "OPEN") && (
              <p className={styles.warning}>
                Resolve open evidence requests before completing review.
              </p>
            )}
          </Panel>
          <Panel title="Case exports">
            <div className={styles.stack}>
              {["json", "csv", "html"].map((format) => (
                <a
                  key={format}
                  className={styles.linkButton}
                  href={`/api/v1/investigations/${current.id}/export?format=${format}`}
                  target={format === "html" ? "_blank" : undefined}
                  rel="noreferrer"
                >
                  {format === "html"
                    ? "Print / save PDF"
                    : `${format.toUpperCase()} package`}{" "}
                  ↗
                </a>
              ))}
            </div>
          </Panel>
          <p className={styles.note}>
            Technical review record. Closure does not certify title or issue a
            legal order.
          </p>
        </aside>
      )}
      <Dialog
        open={!!statusDialog}
        title={
          statusDialog === "CLOSED"
            ? "Close investigation"
            : statusDialog === "OPEN"
              ? "Reopen investigation"
              : `Mark ${words(statusDialog || "")}`
        }
        onClose={() => !mutation.busy && setStatusDialog(null)}
      >
        {current && (
          <form
            key={`${current.id}:${current.revision}:${statusDialog}`}
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void update(() =>
                request<Case>(
                  `/investigations/${current.id}`,
                  {
                    expectedRevision: current.revision,
                    status: statusDialog,
                    reason: data.get("reason"),
                  },
                  "PATCH",
                ),
              );
            }}
          >
            <p>
              {current.reference} · revision {current.revision}
            </p>
            {mutation.error && (
              <p role="alert" className={styles.error}>
                {mutation.error}
              </p>
            )}
            <label>
              Decision reason
              <textarea name="reason" required maxLength={2000} />
            </label>
            <Button type="submit" variant="primary" disabled={mutation.busy}>
              Confirm decision
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
