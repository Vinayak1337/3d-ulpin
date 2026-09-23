"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { BuildingDossier, RegistryRecord } from "@ulpin/contracts";
import {
  parseUsp, uspServiceResultSchema, uspSuccessEnvelopeSchema,
  UspErrorEnvelopeSchema, UspSnapshotManifestSchema, UspVerticalContextSchema,
  UspPacket0ReceiptSchema, UspExactPartResultSchema, type EvidencePointer, type Packet0Receipt,
  type SnapshotScope, type TargetPin, type ResolvedTarget,
} from "@ulpin/contracts/usp";
import { Button } from "../../officer/shared/ui";
import "./packet0.css";

type Vertical = { building: ResolvedTarget; floor: ResolvedTarget; space: ResolvedTarget };
type Ready = { scope: SnapshotScope; vertical: Vertical };
type State =
  | { kind: "loading" }
  | { kind: "ready"; value: Ready }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };
type ExactPart = { pointer: EvidencePointer; sourceSha256: string; text: string };
const verticalSchema = uspServiceResultSchema(UspVerticalContextSchema);
const exactPartSchema = UspExactPartResultSchema;

function pin(record: RegistryRecord): TargetPin {
  return { ref: { namespace: "registry_record", id: record.id }, revision: record.revision };
}

async function uspPost<T>(path: string, body: unknown, schema: Parameters<typeof uspSuccessEnvelopeSchema>[0], signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/usp/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store", signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = UspErrorEnvelopeSchema.safeParse(payload);
    throw new Error(error.success ? error.data.error.message : "The evidence service is unavailable.");
  }
  return parseUsp(uspSuccessEnvelopeSchema(schema), payload).data as T;
}

async function uspReceipt(packetId: string, signal: AbortSignal): Promise<Packet0Receipt> {
  const response = await fetch(`/api/v1/usp/packets/${encodeURIComponent(packetId)}/receipt`, { cache: "no-store", signal });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = UspErrorEnvelopeSchema.safeParse(payload);
    throw new Error(error.success ? error.data.error.message : "The saved packet is unavailable.");
  }
  return parseUsp(uspSuccessEnvelopeSchema(UspPacket0ReceiptSchema), payload).data;
}

function verticalRecords(dossier: BuildingDossier, space: RegistryRecord) {
  const floorIds = space.links.filter(link => link.type === "floor").map(link => link.targetId);
  const floor = dossier.records.find(record => record.kind === "floor" && floorIds.includes(record.id));
  const buildingIds = floor?.links.filter(link => link.type === "within").map(link => link.targetId) ?? [];
  const building = dossier.records.find(record => record.kind === "building" && buildingIds.includes(record.id));
  return floor && building ? { floor, building } : null;
}

function locatorLabel(pointer: EvidencePointer) {
  const locator = pointer.locator;
  if (locator.kind === "verbatim") return locator.locator;
  if (locator.kind === "page") return `Page ${locator.page}`;
  if (locator.kind === "rows" || locator.kind === "lines") return `${locator.kind} ${locator.range.start}–${locator.range.end}`;
  return locator.kind.replaceAll("_", " ");
}

/** Uses one verified Studio selection. All facts and bytes come from local USP routes. */
export default function Packet0Action({ dossier, record }: { dossier: BuildingDossier; record: RegistryRecord }) {
  const pathname = usePathname(), router = useRouter(), search = useSearchParams();
  const packetId = search.get("packet");
  const duplicatePacket = search.getAll("packet").length > 1;
  const parents = useMemo(() => verticalRecords(dossier, record), [dossier, record]);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [parts, setParts] = useState<Array<{ pointer: EvidencePointer; value: ExactPart | null; reason: string | null }>>([]);
  const [receipt, setReceipt] = useState<Packet0Receipt | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<"text" | "csv">("text");
  const [generation, setGeneration] = useState(0);
  const current = useRef(0);
  const selectedKey = `${dossier.area.siteId}:${dossier.canonicalBuildingId}:${record.id}@${record.revision}`;

  useEffect(() => {
    const sequence = ++current.current;
    const controller = new AbortController();
    setState({ kind: "loading" });
    setParts([]);
    setReceipt(null);
    setReceiptError("");
    if (!parents || record.kind !== "space" || record.revision < 1) {
      setState({ kind: "unavailable", reason: "A supplied building, floor and recorded space are required." });
      return () => controller.abort();
    }
    void (async () => {
      const manifest = await uspPost<ReturnType<typeof UspSnapshotManifestSchema.parse>>(
        "snapshots", { scopeId: dossier.area.siteId,
          world: { namespace: "world", id: `registry-site/${dossier.area.siteId}` },
          stage: "recorded", selection: { kind: "site" } },
        UspSnapshotManifestSchema, controller.signal,
      );
      const result = await uspPost<ReturnType<typeof verticalSchema.parse>>(
        "targets/vertical", { scope: manifest.scope,
          building: pin(parents.building), floor: pin(parents.floor), space: pin(record) },
        verticalSchema, controller.signal,
      );
      if (controller.signal.aborted || sequence !== current.current) return;
      if (result.state !== "available") {
        setState({ kind: "unavailable", reason: result.state === "pending" ? "target_resolution_pending" : result.reasonCode });
        return;
      }
      const ready = { scope: manifest.scope, vertical: result.data };
      setState({ kind: "ready", value: ready });
      const reads = await Promise.all(result.data.space.evidence.map(async pointer => {
        try {
          const part = await uspPost<ReturnType<typeof exactPartSchema.parse>>(
            "evidence/part", { scope: manifest.scope, pointer, action: "extract" },
            exactPartSchema, controller.signal,
          );
          return { pointer, value: part.state === "available" ? part.data : null,
            reason: part.state === "available" ? null : part.state === "pending" ? "exact_extract_pending" : part.reasonCode };
        } catch (cause) {
          return { pointer, value: null, reason: cause instanceof Error ? cause.message : "Exact extract unavailable" };
        }
      }));
      if (!controller.signal.aborted && sequence === current.current) setParts(reads);
    })().catch(cause => {
      if (!controller.signal.aborted && sequence === current.current)
        setState({ kind: "error", message: cause instanceof Error ? cause.message : "Evidence unavailable." });
    });
    return () => controller.abort();
  }, [selectedKey, generation, parents, dossier.area.siteId, record]);

  useEffect(() => {
    if (!packetId || duplicatePacket) return;
    const controller = new AbortController();
    setReceipt(null);
    setReceiptError("");
    void uspReceipt(packetId, controller.signal).then(saved => {
      if (controller.signal.aborted) return;
      if (saved.target.ref.namespace !== "registry_record" || saved.target.ref.id !== record.id
        || saved.scope.scopeId !== dossier.area.siteId) {
        setReceiptError("This packet belongs to another property selection.");
        return;
      }
      setReceipt(saved);
    }).catch(cause => {
      if (!controller.signal.aborted) setReceiptError(cause instanceof Error ? cause.message : "Saved packet unavailable.");
    });
    return () => controller.abort();
  }, [packetId, duplicatePacket, record.id, dossier.area.siteId]);

  const generate = async () => {
    if (state.kind !== "ready" || busy || !state.value.vertical.space.evidence.length) return;
    const controller = new AbortController();
    setBusy(true);
    setReceiptError("");
    try {
      const result = await uspPost<Packet0Receipt>("packets", {
        scope: state.value.scope, target: state.value.vertical.space.pin,
        evidence: state.value.vertical.space.evidence, format,
        guard: { mode: "create", requestKey: crypto.randomUUID() },
      }, UspPacket0ReceiptSchema, controller.signal);
      setReceipt(result);
      const next = new URLSearchParams(search.toString());
      next.set("packet", result.packetId);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    } catch (cause) {
      setReceiptError(cause instanceof Error ? cause.message : "Packet compilation failed.");
    } finally { setBusy(false); }
  };

  return <section className="usp-packet-action" data-usp-target={record.id} aria-label="Scoped evidence packet">
    <div className="usp-packet-heading"><strong>Exact evidence & packet</strong><small>Recorded space · revision {record.revision}</small></div>
    <p className="usp-packet-scope">{parents ? `${parents.building.name} / ${parents.floor.name} / ${record.name}` : record.name}</p>
    {state.kind === "loading" && <p role="status">Checking the recorded selection and its evidence…</p>}
    {state.kind === "error" && <p role="alert">{state.message} <button onClick={() => setGeneration(value => value + 1)}>Retry</button></p>}
    {state.kind === "unavailable" && <p role="status">Scoped packet unavailable: {state.reason.replaceAll("_", " ")}</p>}
    {state.kind === "ready" && <>
      {!state.value.vertical.space.evidence.length && <p>No exact evidence link is recorded for this space.</p>}
      {state.value.vertical.space.evidence.map((pointer, index) => {
        const part = parts[index];
        const source = dossier.sources.find(item => item.id === pointer.sourceRevision.ref.id);
        return <article className="usp-packet-source" key={`${pointer.sourceRevision.ref.id}:${locatorLabel(pointer)}`}>
          <div><strong>{locatorLabel(pointer)}</strong><small>{source?.name ?? `Source ${pointer.sourceRevision.ref.id}`} · revision {pointer.sourceRevision.revision}</small></div>
          {part?.value ? <><p className="usp-packet-excerpt">{part.value.text}</p><small>Original SHA-256 {part.value.sourceSha256}</small></>
            : <p className="usp-packet-unavailable">{part ? `Exact extract unavailable: ${part.reason?.replaceAll("_", " ")}` : "Checking exact extract…"}</p>}
        </article>;
      })}
      {!!state.value.vertical.space.evidence.length && <div className="usp-packet-controls">
        <label>Format <select value={format} onChange={event => setFormat(event.target.value as "text" | "csv")}><option value="text">Text</option><option value="csv">CSV</option></select></label>
        <Button disabled={busy} onClick={() => void generate()}>{busy ? "Compiling…" : "Compile scoped packet"}</Button>
      </div>}
    </>}
    {duplicatePacket && <p role="alert">This link has conflicting packet identifiers.</p>}
    {receiptError && <p role="alert">{receiptError}</p>}
    {receipt && <div className="usp-packet-receipt" data-usp-packet={receipt.packetId}>
      <strong>{receipt.status === "complete" ? "Scoped packet saved" : "Incomplete packet saved"}</strong>
      {receipt.target.revision !== record.revision && <span>Saved for earlier space revision {receipt.target.revision}</span>}
      <span>{receipt.included.length} exact extract{receipt.included.length === 1 ? "" : "s"} · {receipt.unavailable.length} unavailable</span>
      {receipt.unavailable.length > 0 && <p>Unresolved source parts remain listed in the saved artifact.</p>}
      <a className="ui-button" href={`/api/v1/usp/packets/${encodeURIComponent(receipt.packetId)}`} download>Download {receipt.format.toUpperCase()} packet</a>
      <small>SHA-256 {receipt.artifact.sha256}</small>
    </div>}
  </section>;
}
