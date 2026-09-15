"use client";
import { useState } from "react";
import Link from "next/link";
import type {
  RegistryDetail,
  RegistryDraft,
  RegistryRecord,
  RegistryReview,
  RegistryRight,
} from "@ulpin/contracts";
import { request, useMutation, useResource } from "../shared/hooks";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
} from "../shared/ui";
import { routes } from "../shared/routes";
import RecordHistory from "./RecordHistory";
import SpatialInquiry from "./SpatialInquiry";
import styles from "./register.module.css";
/** Local-frame records retain a usable register even without a supported geographic building link. */
export default function RetainedRegister({
  siteId,
  recordId,
}: {
  siteId: string;
  recordId?: string;
}) {
  const resource = useResource<RegistryDetail>(`/sites/${siteId}`),
    mutation = useMutation();
  const [selectedId, setSelectedId] = useState(recordId),
    [draft, setDraft] = useState<RegistryDraft | null>(null),
    [review, setReview] = useState<RegistryReview | null>(null),
    [name, setName] = useState(""),
    [ack, setAck] = useState(""),
    [rights, setRights] = useState<RegistryRight[]>([]),
    [dirty, setDirty] = useState(false);
  const detail = resource.data,
    record =
      detail?.records.find((r) => r.id === selectedId) || detail?.records[0];
  if (!detail)
    return resource.error ? (
      <ErrorState message={resource.error} retry={resource.reload} />
    ) : (
      <LoadingState label="Opening retained register" />
    );
  const select = (record: RegistryRecord) => {
    setSelectedId(record.id);
    setDraft(null);
    setReview(null);
    setName(record.name);
    setRights(record.rights);
    setDirty(false);
    setAck("");
  };
  async function createDraft() {
    if (!record) return;
    const result = await request<RegistryDraft>(`/sites/${siteId}/drafts`, {
      recordId: record.id,
      requestKey: crypto.randomUUID(),
    });
    setDraft(result);
    setName(record.name);
    setRights(record.rights);
    setDirty(false);
    setReview(null);
  }
  async function save() {
    if (!draft || !record) return;
    const source = draft.records.find((r) => r.id === record.id)!;
    const { id, siteId: _, identifier, revision, ...body } = source;
    const geometry = body.geometry;
    if (geometry) {
      const { area, height, volume, ...input } = geometry;
      body.geometry = input;
    }
    const result = await request<RegistryDraft>(
      `/registry-drafts/${draft.id}`,
      {
        expectedRevision: draft.revision,
        recordId: record.id,
        body: { ...body, name, rights },
      },
      "PATCH",
    );
    setDraft(result);
    setReview(null);
    setDirty(false);
  }
  return (
    <main className={styles.startPage}>
      <header className={styles.startHeading}>
        <div>
          <Link href="/register">← Property Register</Link>
          <h1>{detail.site.name}</h1>
          <p>Local-frame register · {detail.site.frame.id}</p>
        </div>
        <Badge tone={detail.site.synthetic ? "warning" : "neutral"}>
          {detail.site.synthetic
            ? "Fictional demonstration"
            : "Retained records"}
        </Badge>
      </header>
      {mutation.error && (
        <ErrorState message={mutation.error} retry={resource.reload} />
      )}
      <div className={styles.startGrid}>
        <Panel title="Records">
          <div className={styles.shortList}>
            {detail.records.map((r) => (
              <button
                key={r.id}
                disabled={mutation.busy}
                aria-pressed={r.id === record?.id}
                onClick={() => select(r)}
              >
                <span>
                  <strong>{r.name}</strong>
                  <small>
                    {r.kind} · {r.identifier}
                  </small>
                </span>
                <Badge>r{r.revision}</Badge>
              </button>
            ))}
          </div>
        </Panel>
        <div className={styles.stack}>
          {record ? (
            <>
              <Panel title={record.name}>
                <div className={styles.sidebarFacts}>
                  <div>
                    <span>Identifier</span>
                    <strong>{record.identifier}</strong>
                  </div>
                  <div>
                    <span>Recorded geometry</span>
                    <strong>{record.geometry?.area ?? "—"} m²</strong>
                  </div>
                  <div>
                    <span>Level reference</span>
                    <strong>{detail.site.frame.benchmark}</strong>
                  </div>
                </div>
                <div className={styles.actions}>
                  <a
                    className={styles.linkButton}
                    href={`/api/v1/registry/${record.id}/export`}
                  >
                    Export record
                  </a>
                  <Button
                    onClick={() => void mutation.run(createDraft)}
                    disabled={mutation.busy}
                  >
                    Prepare correction
                  </Button>
                  <Button
                    onClick={() =>
                      void mutation.run(async () => {
                        const result = await request<{ id: string }>(
                          `/sites/${siteId}/workspace`,
                          {},
                        );
                        window.location.assign(routes.case(result.id));
                      })
                    }
                  >
                    Prepare sources
                  </Button>
                </div>
              </Panel>
              <Panel title="Rights & evidence">
                <div className={styles.shortList}>
                  {record.rights.map((r, i) => (
                    <a
                      key={i}
                      href={routes.source(r.evidence.sourceId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>
                        <strong>{r.party}</strong>
                        <small>
                          {r.type.replaceAll("_", " ")} · {r.evidence.locator}
                        </small>
                      </span>
                    </a>
                  ))}
                  {record.evidence.map((e, i) => (
                    <a
                      href={routes.source(e.sourceId)}
                      key={i}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {e.locator} · Open original
                    </a>
                  ))}
                </div>
              </Panel>
              {draft && (
                <Panel title="Correction draft">
                  <div style={{ padding: 16, display: "grid", gap: 12 }}>
                    <label>
                      Record name
                      <input
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          setDirty(true);
                          setReview(null);
                        }}
                      />
                    </label>
                    <details>
                      <summary>Recorded rights ({rights.length})</summary>
                      {rights.map((right, index) => (
                        <fieldset key={index}>
                          <legend>Right {index + 1}</legend>
                          <label>
                            Party
                            <input
                              value={right.party}
                              onChange={(e) => {
                                setRights(
                                  rights.map((r, i) =>
                                    i === index
                                      ? { ...r, party: e.target.value }
                                      : r,
                                  ),
                                );
                                setDirty(true);
                                setReview(null);
                              }}
                            />
                          </label>
                          <label>
                            Type
                            <select
                              value={right.type}
                              onChange={(e) => {
                                setRights(
                                  rights.map((r, i) =>
                                    i === index
                                      ? {
                                          ...r,
                                          type: e.target
                                            .value as RegistryRight["type"],
                                        }
                                      : r,
                                  ),
                                );
                                setDirty(true);
                                setReview(null);
                              }}
                            >
                              {[
                                "ownership_claim",
                                "shared_use",
                                "easement",
                              ].map((type) => (
                                <option key={type} value={type}>
                                  {type.replaceAll("_", " ")}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Original source
                            <select
                              value={right.evidence.sourceId}
                              onChange={(e) => {
                                setRights(
                                  rights.map((r, i) =>
                                    i === index
                                      ? {
                                          ...r,
                                          evidence: {
                                            ...r.evidence,
                                            sourceId: e.target.value,
                                          },
                                        }
                                      : r,
                                  ),
                                );
                                setDirty(true);
                                setReview(null);
                              }}
                            >
                              {detail.sources.map((source) => (
                                <option key={source.id} value={source.id}>
                                  {source.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Evidence locator
                            <input
                              value={right.evidence.locator}
                              onChange={(e) => {
                                setRights(
                                  rights.map((r, i) =>
                                    i === index
                                      ? {
                                          ...r,
                                          evidence: {
                                            ...r.evidence,
                                            locator: e.target.value,
                                          },
                                        }
                                      : r,
                                  ),
                                );
                                setDirty(true);
                                setReview(null);
                              }}
                            />
                          </label>
                          <Button
                            onClick={() => {
                              setRights(rights.filter((_, i) => i !== index));
                              setDirty(true);
                              setReview(null);
                            }}
                          >
                            Remove from draft
                          </Button>
                        </fieldset>
                      ))}
                      <Button
                        disabled={!detail.sources.length}
                        onClick={() => {
                          setRights([
                            ...rights,
                            {
                              party: "",
                              type: "ownership_claim",
                              evidence: {
                                sourceId: detail.sources[0].id,
                                locator: "",
                              },
                            },
                          ]);
                          setDirty(true);
                          setReview(null);
                        }}
                      >
                        Add evidenced right
                      </Button>
                    </details>
                    <Button
                      disabled={mutation.busy || !dirty}
                      onClick={() => void mutation.run(save)}
                    >
                      Save draft
                    </Button>
                    <Button
                      disabled={
                        mutation.busy ||
                        dirty ||
                        name !==
                          draft.records.find((r) => r.id === record.id)?.name
                      }
                      onClick={() =>
                        void mutation.run(async () =>
                          setReview(
                            await request(
                              `/registry-drafts/${draft.id}/review`,
                              {
                                expectedRevision: draft.revision,
                                expectedSiteRevision: detail.site.revision,
                              },
                            ),
                          ),
                        )
                      }
                    >
                      Review changes
                    </Button>
                    {review && (
                      <>
                        <p>
                          {review.findings.length} findings · review{" "}
                          {review.id.slice(0, 8)}
                        </p>
                        {review.findings.map((f) => (
                          <p key={f.id}>
                            {f.title}: {f.description}
                          </p>
                        ))}
                        <label>
                          Review acknowledgement
                          <textarea
                            value={ack}
                            onChange={(e) => setAck(e.target.value)}
                          />
                        </label>
                        <Button
                          variant="primary"
                          disabled={mutation.busy || !ack.trim()}
                          onClick={() =>
                            void mutation.run(async () => {
                              await request(
                                `/registry-reviews/${review.id}/commit`,
                                { acknowledgement: ack },
                              );
                              setReview(null);
                              setDraft(null);
                              await resource.reload();
                            })
                          }
                        >
                          Record reviewed correction
                        </Button>
                      </>
                    )}
                  </div>
                </Panel>
              )}
              <RecordHistory key={record.id} record={record} />
              <SpatialInquiry key={detail.site.id} detail={detail} />
            </>
          ) : (
            <EmptyState
              title="No recorded geometry"
              description="Prepare sources to begin."
            />
          )}
        </div>
      </div>
    </main>
  );
}
