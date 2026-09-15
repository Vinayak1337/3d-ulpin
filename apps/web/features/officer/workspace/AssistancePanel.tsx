"use client";
import { useEffect, useRef, useState } from "react";
import type { ImportPackage } from "@ulpin/contracts";
import type { OfficerAiStatus, OfficerAiRun } from "@/lib/officer-ai-types";
import { request, useMutation, useResource } from "../shared/hooks";
import { Badge, Button, ErrorState } from "../shared/ui";
import type { CanvasSource } from "./types";
import "./assistance.css";
export default function AssistancePanel({
  pkg,
  buildingId,
  source,
  onUpdated,
  disabled,
  onBusy,
}: {
  pkg: ImportPackage;
  buildingId: string;
  source?: CanvasSource;
  onUpdated: (pkg: ImportPackage) => Promise<void>;
  disabled: boolean;
  onBusy: (message: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [partId, setPartId] = useState(""),
    [run, setRun] = useState<OfficerAiRun | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [approved, setApproved] = useState(false),
    [includeImage, setIncludeImage] = useState(false),
    [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const status = useResource<OfficerAiStatus>(open ? "/ai/status" : null),
    mutation = useMutation();
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const parts = pkg.parts.filter(
    (p) =>
      p.entityIds.includes(buildingId) &&
      (!source || p.sourceRevisionId === source.id),
  );
  const part = parts.find((p) => p.id === partId) || parts[0];
  useEffect(() => {
    setSelected([]);
    setRun(null);
    setApproved(false);
    setAnswers({});
  }, [pkg.id, source?.id]);
  async function operate(action: () => Promise<void>) {
    if (disabled) return;
    onBusy("Document assistance");
    try {
      await mutation.run(action);
    } finally {
      onBusy("");
    }
  }
  async function extract(mode: "live" | "cached") {
    if (!part) return;
    const payload = {
      expectedRevision: pkg.revision,
      partIds: [part.id],
      entityIds: [buildingId],
      mode,
      answers: Object.entries(answers)
        .filter(([, answer]) => answer.trim())
        .map(([question, answer]) => ({ question, answer })),
      ...(includeImage
        ? {
            imageRegions: [
              {
                partId: part.id,
                region: Object.fromEntries(
                  Object.entries(crop).map(([key, value]) => [
                    key,
                    value / 100,
                  ]),
                ),
              },
            ],
            imageContentApproved: approved,
          }
        : {}),
    };
    const signature = JSON.stringify(payload);
    if (operation.current?.signature !== signature)
      operation.current = { signature, key: crypto.randomUUID() };
    await operate(async () => {
      const result = await request<OfficerAiRun>(
        `/import-packages/${pkg.id}/ai-extractions`,
        { ...payload, requestKey: operation.current!.key },
      );
      setRun(result);
      setSelected([]);
    });
  }
  return (
    <details
      className="assistance-panel"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        Document assistance{" "}
        <Badge
          tone={status.data?.state === "available" ? "success" : "neutral"}
        >
          {status.data?.state === "available" ? "Available" : "Setup status"}
        </Badge>
      </summary>
      <p>
        {status.data?.message ||
          status.error ||
          "Checking the configured free route…"}
      </p>
      <label>
        Source section
        <select
          value={part?.id || ""}
          onChange={(e) => {
            setPartId(e.target.value);
            setApproved(false);
          }}
        >
          <option value="" disabled>
            Choose source text
          </option>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.locator}
            </option>
          ))}
        </select>
      </label>
      {part && (
        <blockquote>
          {part.text.slice(0, 900) || "This source part has no extracted text."}
        </blockquote>
      )}
      {source?.kind === "image" && (
        <>
          <label className="assistance-check">
            <input
              type="checkbox"
              checked={includeImage}
              onChange={(e) => {
                setIncludeImage(e.target.checked);
                setApproved(false);
              }}
            />
            Include an image crop
          </label>
          {includeImage && (
            <>
              <div className="assistance-crop">
                <img src={source.url} alt="Original selected for extraction" />
                <span
                  style={{
                    left: `${crop.x}%`,
                    top: `${crop.y}%`,
                    width: `${crop.width}%`,
                    height: `${crop.height}%`,
                  }}
                />
              </div>
              <div className="assistance-crop-fields">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}>
                    {key} %
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={crop[key]}
                      onChange={(e) => {
                        setCrop({ ...crop, [key]: Number(e.target.value) });
                        setApproved(false);
                      }}
                    />
                  </label>
                ))}
              </div>
              <label className="assistance-check">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                I reviewed this crop and excluded personal fields.
              </label>
            </>
          )}
        </>
      )}
      <div className="assistance-actions">
        <Button
          disabled={
            disabled ||
            mutation.busy ||
            !part ||
            status.data?.state !== "available" ||
            (includeImage && !approved)
          }
          onClick={() => void extract("live")}
        >
          Extract candidates
        </Button>
        <Button
          disabled={disabled || mutation.busy || !part}
          onClick={() => void extract("cached")}
        >
          Saved result
        </Button>
      </div>
      {mutation.error && <ErrorState message={mutation.error} />}
      {run && (
        <>
          <p>{run.message || run.state}</p>
          {run.questions.map((q) => (
            <label key={q}>
              {q}
              <textarea
                maxLength={1000}
                value={answers[q] || ""}
                onChange={(e) =>
                  setAnswers({ ...answers, [q]: e.target.value })
                }
                placeholder="Answer or identify the missing source"
              />
            </label>
          ))}
          {!!run.questions.length && (
            <small>
              Answers guide a new extraction; they are not measurement evidence.
              Use Extract candidates to continue.
            </small>
          )}
          {run.validationErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
          {run.suggestions?.map((suggestion) => (
            <details key={suggestion.id}>
              <summary>
                {suggestion.kind === "source_role"
                  ? "Suggested source role"
                  : "Suggested property association"}
              </summary>
              <p>{suggestion.role || suggestion.matchedIdentifier}</p>
              <blockquote>{suggestion.quote}</blockquote>
              <p>{suggestion.rationale}</p>
              <small>
                Unresolved suggestion. Review the original and use the source
                assignment controls before changing an association.
              </small>
            </details>
          ))}
          {run.candidates.map((candidate) => (
            <label className="assistance-candidate" key={candidate.id}>
              <input
                type="checkbox"
                checked={selected.includes(candidate.id)}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked
                      ? [...old, candidate.id]
                      : old.filter((id) => id !== candidate.id),
                  )
                }
              />
              <span>
                <strong>{candidate.property}</strong>
                {typeof candidate.value === "object"
                  ? "Structured candidate"
                  : String(candidate.value)}
                <small>
                  {candidate.citations.map((c) => c.quote).join(" · ")}
                </small>
              </span>
            </label>
          ))}
          {!!run.candidates.length && (
            <Button
              disabled={
                disabled ||
                mutation.busy ||
                !selected.length ||
                run.packageRevision !== pkg.revision
              }
              onClick={() =>
                void operate(async () => {
                  await request(
                    `/import-packages/${pkg.id}/ai-extractions/${run.id}/apply`,
                    { expectedRevision: pkg.revision, candidateIds: selected },
                  );
                  await onUpdated(await request(`/import-packages/${pkg.id}`));
                  setSelected([]);
                })
              }
            >
              Add selected for review
            </Button>
          )}
        </>
      )}
      <small>
        Selected evidence only. Candidates require review; assistance cannot
        publish geometry.
      </small>
    </details>
  );
}
