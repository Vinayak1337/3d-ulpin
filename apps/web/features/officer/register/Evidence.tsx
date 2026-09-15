"use client";
import { useEffect, useState } from "react";
import type { BuildingDossier, DossierSource } from "@ulpin/contracts";
import { Badge, Button, EmptyState, Panel } from "../shared/ui";
import { routes } from "../shared/routes";
import { date, locator, sourceKind } from "./model";
import styles from "./register.module.css";

export function SourcePreview({
  source,
  dossier,
}: {
  source: DossierSource;
  dossier: BuildingDossier;
}) {
  const [text, setText] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const parts = dossier.packages
    .flatMap((pkg) => pkg.parts)
    .filter((part) => part.sourceRevisionId === source.id);
  const distinctParts = [
    ...new Map(parts.map((part) => [part.id, part])).values(),
  ];
  const isImage = /\.(png|jpe?g|webp)$/i.test(source.name);
  const isPdf = /\.pdf$/i.test(source.name) || source.profile === "pdf";
  const isText =
    /\.(txt|csv|json|geojson|dxf)$/i.test(source.name) ||
    /geojson|canonical|text|csv/i.test(source.profile);
  useEffect(() => {
    setText("");
    setError("");
    if (!isText || distinctParts.length) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      const response = await fetch(routes.source(source.id), {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Original source could not be loaded.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No preview content.");
      const decoder = new TextDecoder();
      let content = "",
        bytes = 0,
        truncated = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const available = Math.max(0, 65536 - bytes);
        content += decoder.decode(value.subarray(0, available), {
          stream: true,
        });
        bytes += value.length;
        if (bytes >= 65536) {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
      content += decoder.decode();
      if (!controller.signal.aborted)
        setText(
          content +
            (truncated
              ? "\n\nPreview limited to 64 KB. Download the original for the complete source."
              : ""),
        );
    })()
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Preview unavailable.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source.id, isText, distinctParts.length]);
  return (
    <div className={styles.sourcePreview}>
      <div className={styles.previewHeading}>
        <div>
          <Badge tone="info">{sourceKind(source)}</Badge>
          <h3>{source.name}</h3>
          <p>
            Revision {source.revision} · {date(source.createdAt)}
          </p>
        </div>
        <a
          className={styles.linkButton}
          href={routes.source(source.id)}
          target="_blank"
          rel="noreferrer"
        >
          Open original ↗
        </a>
      </div>
      <div className={styles.previewBody}>
        {isImage ? (
          <img
            src={routes.source(source.id)}
            alt={`Original evidence: ${source.name}`}
            onError={() =>
              setError("Image preview unavailable. Open the retained original.")
            }
          />
        ) : isPdf ? (
          <iframe
            src={routes.source(source.id)}
            title={source.name}
            onError={() =>
              setError("PDF preview unavailable. Open the retained original.")
            }
          />
        ) : distinctParts.length ? (
          <div className={styles.partList}>
            {distinctParts.map((part) => (
              <article key={part.id}>
                <span>{part.locator}</span>
                <pre>{part.text}</pre>
              </article>
            ))}
          </div>
        ) : loading ? (
          <p role="status" className={styles.loading}>
            Loading source preview…
          </p>
        ) : text ? (
          <pre className={styles.originalText}>{text}</pre>
        ) : (
          <EmptyState
            title="Preview not available"
            description="The original file is retained and can be downloaded."
          />
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      <dl className={styles.sourceMetadata}>
        <div>
          <dt>Source format</dt>
          <dd>{source.profile}</dd>
        </div>
        <div>
          <dt>Evidence links</dt>
          <dd>
            {source.evidence.length
              ? [...new Set(source.evidence.map(locator))].map((value) => (
                  <span key={value}>{value}</span>
                ))
              : "Original source"}
          </dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd className={styles.hash}>{source.sha256}</dd>
        </div>
      </dl>
    </div>
  );
}
export default function Evidence({
  dossier,
  initialSourceId,
}: {
  dossier: BuildingDossier;
  initialSourceId?: string;
}) {
  const [filter, setFilter] = useState("All"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(
      initialSourceId || dossier.sources[0]?.id || "",
    );
  useEffect(() => {
    if (initialSourceId) setSelected(initialSourceId);
  }, [initialSourceId]);
  const sources = dossier.sources.filter(
    (source) =>
      (filter === "All" || sourceKind(source) === filter) &&
      `${source.name} ${source.profile}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const source = dossier.sources.find((item) => item.id === selected);
  return (
    <div className={styles.evidenceGrid}>
      <Panel title="Evidence & documents" className={styles.documentRail}>
        <div className={styles.filters}>
          <input
            aria-label="Search evidence"
            placeholder="Search documents"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label="Evidence type"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {["All", "Plans & drawings", "Photos", "Documents", "Data"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </div>
        <div className={styles.documentList}>
          {sources.map((item) => (
            <button
              key={item.id}
              aria-pressed={source?.id === item.id}
              onClick={() => setSelected(item.id)}
            >
              <span className={styles.documentIcon}>▤</span>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {sourceKind(item)} · rev {item.revision}
                </small>
                <small>{date(item.createdAt)}</small>
              </span>
              <span>›</span>
            </button>
          ))}
        </div>
        {!sources.length && (
          <EmptyState
            title={
              dossier.sources.length
                ? "No matching documents"
                : "No evidence yet"
            }
            description="Add sources in the property workspace."
          />
        )}
      </Panel>
      <Panel className={styles.previewPanel}>
        {source ? (
          <SourcePreview key={source.id} source={source} dossier={dossier} />
        ) : (
          <EmptyState
            title="Select a source"
            description="Open a document to inspect its original and source links."
          />
        )}
      </Panel>
    </div>
  );
}
