"use client";
import Link from "next/link";
import { useState } from "react";
import type { FeatureKind, PhysicalFeature } from "@ulpin/contracts";
import AreaSection from "@/components/AreaSection";
import { utilityScene } from "@/lib/officer-scene";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  formatNumber,
  type IconName,
} from "../shared/ui";
import { routes } from "../shared/routes";
import type { BlockController } from "./useBlock";
const kinds: { kind: FeatureKind; label: string; icon: IconName }[] = [
  { kind: "building", label: "Buildings", icon: "building" },
  { kind: "parcel", label: "Parcels", icon: "map" },
  { kind: "road", label: "Roads", icon: "layers" },
  { kind: "public_land", label: "Public land", icon: "layers" },
  { kind: "utility", label: "Utilities", icon: "utility" },
];
export function BlockLeftRail({
  block,
  onClose,
}: {
  block: BlockController;
  onClose?: () => void;
}) {
  const [filter, setFilter] = useState("");
  const { preferences, features } = block;
  const properties = features.filter((f) =>
    `${f.name} ${f.identifier} ${f.sourceKey}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <aside className="v2-block-left" aria-label="Map layers and properties">
      <div className="v2-rail-tabs">
        {(["layers", "properties"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => block.setPreferences({ rail: mode })}
            aria-pressed={preferences.rail === mode}
          >
            <Icon name={mode === "layers" ? "layers" : "building"} />
            {mode === "layers" ? "Layers" : "Properties"}
          </button>
        ))}
        {onClose && (
          <Button
            variant="ghost"
            icon="close"
            aria-label="Close layers"
            onClick={onClose}
          />
        )}
      </div>
      {preferences.rail === "layers" && (
        <div className="v2-layers">
          <div className="v2-rail-caption">
            <h3>Map layers</h3>
            <button
              onClick={() =>
                block.setPreferences({ hiddenLayers: [], labels: false })
              }
            >
              Reset
            </button>
          </div>
          {kinds.map(({ kind, label, icon }) => {
            const count = features.filter((f) => f.kind === kind).length;
            return (
              <label className="v2-layer" key={kind}>
                <Icon name={icon} />
                <span>
                  {label}
                  <small>
                    {count === 0 ? "No source supplied" : `${count} features`}
                  </small>
                </span>
                <input
                  type="checkbox"
                  aria-label={`Show ${label.toLowerCase()}`}
                  checked={!preferences.hiddenLayers.includes(kind)}
                  onChange={(e) =>
                    block.setPreferences({
                      hiddenLayers: e.target.checked
                        ? preferences.hiddenLayers.filter((k) => k !== kind)
                        : [...preferences.hiddenLayers, kind],
                    })
                  }
                />
              </label>
            );
          })}
          <label className="v2-layer">
            <Icon name="eye" />
            <span>Labels</span>
            <input
              type="checkbox"
              checked={preferences.labels}
              onChange={(e) =>
                block.setPreferences({ labels: e.target.checked })
              }
            />
          </label>
          <div className="v2-layer-info">
            <Icon name="info" />
            <span>
              Flat globe surface. Surveyed terrain has not been supplied.
            </span>
          </div>
        </div>
      )}
      <div className="v2-property-list-heading">
        <div className="v2-rail-caption">
          <h3>In this block</h3>
          <Badge>{features.length}</Badge>
        </div>
        <div className="v2-search-input">
          <Icon name="search" size={16} />
          <input
            aria-label="Filter properties in this block"
            placeholder="Find in this block"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      <div className="v2-property-list">
        {properties.map((f) => (
          <button
            key={f.id}
            aria-current={f.id === block.selectedId ? "true" : undefined}
            onClick={() => {
              block.select(f.id);
              onClose?.();
            }}
          >
            <span className={`v2-feature-icon v2-feature-icon--${f.kind}`}>
              <Icon
                name={
                  f.kind === "utility"
                    ? "utility"
                    : f.kind === "building"
                      ? "building"
                      : "map"
                }
                size={17}
              />
            </span>
            <span>
              <strong>{f.name}</strong>
              <small>
                {f.kind.replaceAll("_", " ")} · {f.sourceKey}
              </small>
            </span>
            {block.context.data?.latestCheck?.findings.some((issue) =>
              issue.featureIds.includes(f.id),
            ) && <span className="v2-issue-dot" title="Findings available" />}
          </button>
        ))}
        {!properties.length && (
          <EmptyState
            title="No matching features"
            description="Try another name or source ID."
            icon="search"
          />
        )}
      </div>
      <footer className="v2-rail-footer">
        <span>
          {properties.length} of {features.length} features
        </span>
        <Icon name="layers" size={14} />
      </footer>
    </aside>
  );
}
function Metadata({ feature }: { feature: PhysicalFeature }) {
  const verticalReference =
    feature.kind === "utility"
      ? utilityScene(feature)?.verticalReference
      : feature.height.value != null
        ? feature.height.reference
        : undefined;
  return (
    <dl className="v2-metadata">
      <div>
        <dt>Identifier</dt>
        <dd className="v2-mono">{feature.identifier}</dd>
      </div>
      <div>
        <dt>Source ID</dt>
        <dd>{feature.sourceKey}</dd>
      </div>
      <div>
        <dt>Geometry role</dt>
        <dd>{feature.geometryRole?.replaceAll("_", " ") || "Unresolved"}</dd>
      </div>
      <div>
        <dt>Source revision</dt>
        <dd>{feature.revision}</dd>
      </div>
      {feature.height.value != null && (
        <div>
          <dt>Height</dt>
          <dd>
            {formatNumber(feature.height.value)} m ·{" "}
            {feature.height.state.replaceAll("_", " ")}
          </dd>
        </div>
      )}
      <div>
        <dt>Vertical reference</dt>
        <dd>{verticalReference || "Not supplied"}</dd>
      </div>
    </dl>
  );
}
export function BlockInspector({
  block,
  onClose,
  onImport,
}: {
  block: BlockController;
  onClose?: () => void;
  onImport: (packageId: string) => void;
}) {
  const { selected, preferences, dossier } = block;
  const mode = preferences.inspector;
  const properties = block.features.filter((f) => f.kind === "building");
  const utils = block.features.filter((f) => f.kind === "utility");
  const utility = selected?.kind === "utility" ? selected : null;
  const profile = utility ? utilityScene(utility) : null;
  const sources = dossier.data?.sources || [];
  const photos = sources.filter((s) => /\.(png|jpg|jpeg|webp)$/i.test(s.name));
  const parcels =
    selected?.kind === "parcel"
      ? [{ feature: selected, status: "selected" }]
      : dossier.data?.parcels || [];
  return (
    <aside className="v2-block-inspector" aria-label="Context inspector">
      <header className="v2-inspector-heading">
        <h2>
          {mode === "property"
            ? "Property"
            : mode.charAt(0).toUpperCase() + mode.slice(1)}
        </h2>
        <span>
          {selected && (
            <Button
              variant="ghost"
              icon="target"
              aria-label="Focus selection"
              onClick={() => block.navigate("focus")}
            />
          )}
          <Button
            variant="ghost"
            icon="close"
            aria-label="Close inspector"
            onClick={onClose}
          />
        </span>
      </header>
      <nav className="v2-inspector-tabs" aria-label="Inspector sections">
        {(["property", "parcel", "utility", "photos", "history"] as const).map(
          (item) => (
            <button
              key={item}
              aria-pressed={mode === item}
              onClick={() => block.setPreferences({ inspector: item })}
            >
              {item === "property"
                ? "Overview"
                : item.charAt(0).toUpperCase() + item.slice(1)}
            </button>
          ),
        )}
      </nav>
      <div className="v2-inspector-content">
        {mode === "property" &&
          (!selected ? (
            <EmptyState
              title="Select a property"
              description="Choose a building on the map or from the list."
              icon="building"
            />
          ) : (
            <>
              <div className="v2-property-summary">
                <div className="v2-summary-mark">
                  <Icon
                    name={selected.kind === "building" ? "building" : "map"}
                    size={28}
                  />
                </div>
                <Badge
                  tone={
                    selected.worldStatus === "synthetic" ? "warning" : "info"
                  }
                >
                  {selected.worldStatus}
                </Badge>
                <h2>{selected.name}</h2>
                <p>{selected.kind.replaceAll("_", " ")}</p>
              </div>
              <div className="v2-inspector-metrics">
                <div>
                  <small>Footprint</small>
                  <strong>
                    {formatNumber(selected.areaM2)}
                    <span> m²</span>
                  </strong>
                </div>
                <div>
                  <small>Recorded spaces</small>
                  <strong>
                    {dossier.data
                      ? dossier.data.records.filter((r) => r.kind === "space")
                          .length
                      : "—"}
                  </strong>
                </div>
              </div>
              <Metadata feature={selected} />
              {dossier.loading && <LoadingState label="Loading register" />}
              {dossier.error && (
                <ErrorState message={dossier.error} retry={dossier.reload} />
              )}
              <section className="v2-inspector-section">
                <h3>Evidence coverage</h3>
                {dossier.data?.missing.length ? (
                  <ul className="v2-coverage-list">
                    {dossier.data.missing.slice(0, 4).map((m) => (
                      <li key={m}>
                        <Icon name="info" size={15} />
                        {m}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {selected.kind === "building"
                      ? "Open the register to inspect source evidence."
                      : "Context feature from the recorded source."}
                  </p>
                )}
              </section>
            </>
          ))}
        {mode === "parcel" && (
          <>
            {!parcels.length ? (
              <EmptyState
                title="No linked parcel"
                description="Parcel boundaries require a supplied source and an evidenced association."
                icon="map"
              />
            ) : (
              parcels.map(({ feature, status }) => (
                <section key={feature.id} className="v2-inspector-section">
                  <div className="v2-rail-caption">
                    <h3>{feature.name}</h3>
                    <Badge
                      tone={status === "confirmed" ? "success" : "warning"}
                    >
                      {status}
                    </Badge>
                  </div>
                  <Metadata feature={feature} />
                  <Button
                    icon="target"
                    onClick={() => block.select(feature.id)}
                  >
                    Show parcel
                  </Button>
                </section>
              ))
            )}
            {selected?.kind === "parcel" && (
              <p className="v2-muted-note">
                Nearby buildings are not automatically linked to this parcel.
              </p>
            )}
          </>
        )}
        {mode === "utility" && (
          <>
            {!utility ? (
              <>
                <EmptyState
                  title={
                    utils.length ? "Choose a utility" : "No utility evidence"
                  }
                  description={
                    utils.length
                      ? "Select an alignment to inspect its supplied profile."
                      : "No utility alignment or surveyed levels have been supplied for this block."
                  }
                  icon="utility"
                />
                {utils.map((u) => (
                  <Button key={u.id} onClick={() => block.select(u.id)}>
                    {u.name}
                  </Button>
                ))}
              </>
            ) : (
              <>
                <div className="v2-rail-caption">
                  <h3>{utility.name}</h3>
                  <Badge tone={profile ? "info" : "warning"}>
                    {profile ? "Profile supplied" : "Depth unknown"}
                  </Badge>
                </div>
                <Metadata feature={utility} />
                <div className="v2-utility-section">
                  <AreaSection
                    selected={utility}
                    details={[]}
                    onSelect={() => {}}
                  />
                </div>
                <p className="v2-muted-note">
                  Visibility does not establish clearance. Collision checks
                  require compatible levels and supported geometry.
                </p>
              </>
            )}
          </>
        )}
        {mode === "photos" &&
          (!photos.length ? (
            <EmptyState
              title="No site photos"
              description="Linked source images appear here when supplied. No stock or generated imagery is used."
              icon="photo"
            />
          ) : (
            <div className="v2-photos">
              {photos.map((s) => (
                <a href={s.url} target="_blank" rel="noreferrer" key={s.id}>
                  <img src={s.url} alt={s.name} />
                  <strong>{s.name}</strong>
                  <small>Source revision {s.revision}</small>
                </a>
              ))}
            </div>
          ))}
        {mode === "history" && (
          <div className="v2-timeline">
            {(block.context.data?.packages || [])
              .filter(
                (p) =>
                  !selected || p.features.some((f) => f.id === selected.id),
              )
              .map((p) => (
                <article key={p.id}>
                  <span className="v2-timeline-dot" />
                  <small>
                    {new Date(p.createdAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </small>
                  <h3>{p.name}</h3>
                  <Badge tone={p.state === "COMMITTED" ? "success" : "warning"}>
                    {p.state.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                  <p>
                    {p.sourceRevisionIds.length} original sources · revision{" "}
                    {p.revision}
                  </p>
                  {p.state !== "COMMITTED" && (
                    <Button onClick={() => onImport(p.id)}>
                      Resume review
                    </Button>
                  )}
                </article>
              ))}
            {!block.context.data?.packages.length && (
              <EmptyState title="No recorded imports" icon="history" />
            )}
          </div>
        )}
      </div>
      {selected?.kind === "building" && (
        <footer className="v2-inspector-actions">
          <Link
            className="v2-button v2-button--primary"
            href={routes.register(selected.id, block.context.data?.area.id)}
          >
            <Icon name="register" />
            Open register
          </Link>
          <Link
            className="v2-button"
            href={routes.workspace(selected.id, block.context.data?.area.id)}
          >
            <Icon name="workspace" />
            Open workspace
          </Link>
        </footer>
      )}
      {!selected && !!properties.length && (
        <footer className="v2-inspector-actions">
          <Button onClick={() => block.select(properties[0].id)}>
            Select first property
          </Button>
        </footer>
      )}
    </aside>
  );
}
