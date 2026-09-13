"use client";

import { useEffect, useRef, useState } from "react";
import type { SourceRevision } from "@ulpin/contracts";
import { DownloadSimple, X } from "@/lib/ui/icons";
import { sourceUrl } from "@/lib/client";
import SourcePreview from "./SourcePreview";

type Preview = { text: string; rows?: string[][]; notice?: string };

function TextPreview({ source }: { source: SourceRevision }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const response = await fetch(sourceUrl(source.id), {
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          `Could not load the original file (${response.status}).`,
        );
      const text = await response.text();
      let result: Preview = { text };
      if (source.profile.endsWith("csv-v1")) {
        const Papa = (await import("papaparse")).default;
        const parsed = Papa.parse<string[]>(text, {
          delimiter: ",",
          skipEmptyLines: true,
          preview: 501,
        });
        result = {
          text,
          rows: parsed.data,
          notice: parsed.errors.length
            ? "This CSV has formatting issues. Check the original text below."
            : parsed.meta.truncated
              ? "Showing the first 500 data rows. Download the original for the complete file."
              : undefined,
        };
      } else {
        try {
          result.text = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          result.notice =
            "This file is not valid JSON. Showing its original text.";
        }
      }
      if (!controller.signal.aborted) setPreview(result);
    })().catch((cause) => {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Preview unavailable.",
        );
    });
    return () => controller.abort();
  }, [source.id, source.profile]);
  if (error)
    return (
      <p className="inline-error" role="alert">
        {error} You can retry by reopening the preview, or download the
        original.
      </p>
    );
  if (!preview)
    return (
      <p className="file-preview-status" role="status">
        Loading original file…
      </p>
    );
  const columns = Math.min(
    50,
    Math.max(0, ...(preview.rows || []).map((row) => row.length)),
  );
  return (
    <>
      <div className="file-preview-options">
        <span>
          {preview.rows
            ? "CSV · blank cells are preserved"
            : "JSON · formatted for reading"}
        </span>
        {preview.rows && (
          <button
            className="button small"
            aria-pressed={raw}
            onClick={() => setRaw(!raw)}
          >
            {raw ? "Show table" : "Show original text"}
          </button>
        )}
      </div>
      {preview.notice && (
        <p className="file-preview-status" role="status">
          {preview.notice}
        </p>
      )}
      {preview.rows && !raw ? (
        <div
          className="file-preview-scroll"
          tabIndex={0}
          aria-label="Source CSV table"
        >
          {preview.rows.length ? (
            <table className="file-preview-table">
              <thead>
                <tr>
                  <th scope="col" aria-label="Record number">
                    #
                  </th>
                  {Array.from({ length: columns }, (_, i) => (
                    <th scope="col" key={i}>
                      {preview.rows![0][i] || `Column ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(1).map((row, i) => (
                  <tr key={i}>
                    <th scope="row">{i + 2}</th>
                    {Array.from({ length: columns }, (_, j) => (
                      <td key={j}>{(row[j] ?? "").slice(0, 2000)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="file-preview-status">This file is empty.</p>
          )}
          <p className="file-preview-status">
            Table preview: up to 50 columns and 2,000 characters per cell.
            Original text and download retain the source values.
          </p>
        </div>
      ) : (
        <div
          className="file-preview-scroll"
          tabIndex={0}
          aria-label="Source file text"
        >
          <pre>{preview.text.slice(0, 200_000)}</pre>
          {preview.text.length > 200_000 && (
            <p className="file-preview-status">
              Showing the first 200,000 characters. Download the original for
              the complete file.
            </p>
          )}
        </div>
      )}
    </>
  );
}

export default function SourceFileDialog({
  source,
  onClose,
}: {
  source: SourceRevision;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    element
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Close source preview"]',
      )
      ?.focus();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="file-preview-dialog"
      aria-labelledby="file-preview-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className="file-preview-header">
        <div>
          <span className="eyebrow">
            Source preview · revision {source.revision}
          </span>
          <h2 id="file-preview-title">{source.name}</h2>
        </div>
        <div className="row">
          <a
            className="button small"
            href={sourceUrl(source.id)}
            download={source.name}
          >
            <DownloadSimple size={15} />
            Download
          </a>
          <button
            autoFocus
            className="icon-button"
            aria-label="Close source preview"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="file-preview-content">
        {source.profile.startsWith("plan-") ? (
          <SourcePreview
            key={source.id}
            source={source}
            controls={[]}
            busy={false}
            readOnly
          />
        ) : (
          <TextPreview key={source.id} source={source} />
        )}
      </div>
      <footer className="file-preview-footer">
        Original source · read only · previewing does not apply evidence or
        change the model.
      </footer>
    </dialog>
  );
}
