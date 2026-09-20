"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { MapArea, ImportPackage, GisInspection } from "@ulpin/contracts";
import { Button, Icon } from "../shared/ui";
import { useGisInspection } from "./useGisInspection";
const boundaries = [
  ["building:unknown", "Building boundaries · meaning not established"],
  [
    "building:observed_ground_occupation",
    "Buildings · observed ground outlines",
  ],
  ["building:observed_roof_projection", "Buildings · roof outlines"],
  [
    "building:approved_building_outline",
    "Buildings · source states approved outlines",
  ],
  ["parcel:recorded_parcel", "Parcels · recorded boundaries"],
  ["parcel:unknown", "Parcel boundaries · meaning not established"],
  ["road:road_surface", "Roads · physical surfaces"],
  ["road:public_road_land", "Roads · public road land"],
  ["public_land:public_land", "Public land boundaries"],
  ["utility:physical_utility", "Utilities · physical assets"],
  ["utility:unknown", "Utilities · meaning not established"],
];
const formats = {
  geojson: "GeoJSON",
  arcgis: "ArcGIS JSON",
  gpkg: "GeoPackage",
  shapefile_zip: "Shapefile ZIP",
};
export default function ImportForm({
  area,
  busy,
  onImport,
  initialFile,
  hideFileControls = false,
}: {
  area?: MapArea;
  initialFile?: File;
  hideFileControls?: boolean;
  busy: boolean;
  onImport: (operation: () => Promise<ImportPackage>) => void;
}) {
  const { file, metadata, reading, error, inspect, clear } = useGisInspection();
  const [kind, setKind] = useState("");
  const [role, setRole] = useState("");
  const [worldStatus, setWorldStatus] = useState("");
  const [destination, setDestination] = useState(area ? "current" : "new");
  const [title, setTitle] = useState("");
  const [namespace, setNamespace] = useState("");
  const [namespaceEdited, setNamespaceEdited] = useState(false);
  const [crs, setCrs] = useState("");
  const [idChoice, setIdChoice] = useState("");
  const [nameField, setNameField] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const columnsId = useId();
  const locked = busy || reading;
  const ready = Boolean(
    file &&
      metadata?.featureCount &&
      !locked &&
      !error &&
      kind &&
      role &&
      worldStatus &&
      crs &&
      idChoice &&
      title.trim() &&
      namespace.trim(),
  );
  const reason = reading
    ? "Reading available file details…"
    : !file
      ? "Choose a GIS source to continue."
      : error
        ? "Resolve the file error before continuing."
        : !metadata?.featureCount
          ? "Choose a source layer to continue."
          : !crs
            ? "Provide the source coordinate system."
            : !idChoice
              ? "Choose a complete, unique ID column."
              : !kind || !role || !worldStatus
                ? "Confirm what the boundaries represent and the source origin."
                : !title.trim() || !namespace.trim()
                  ? "Provide a title and dataset namespace."
                  : "";
  function apply(result: GisInspection, newFile: boolean) {
    setCrs(result.sourceCrs || "");
    setIdChoice(
      result.featureIdEligible
        ? "feature:"
        : result.suggestedIdField
          ? `field:${result.suggestedIdField}`
          : "",
    );
    setNameField(result.suggestedNameField || "");
    if (newFile) setTitle(result.suggestedTitle);
    if (newFile || !namespaceEdited) setNamespace(result.suggestedNamespace);
  }
  async function choose(next: File) {
    if (busy) return;
    setNamespaceEdited(false);
    setKind("");
    setRole("");
    setWorldStatus("");
    setTitle("");
    setNamespace("");
    setCrs("");
    setIdChoice("");
    setNameField("");
    const result = await inspect(next);
    if (result) apply(result, true);
  }
  useEffect(() => { if (initialFile) void choose(initialFile); }, [initialFile]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !file || !metadata) return;
    const form = new FormData(event.currentTarget);
    form.set("file", file);
    form.set("format", metadata.format);
    if (metadata.layer) form.set("layer", metadata.layer);
    const optional = (name: string) =>
      String(form.get(name) || "") || undefined;
    const mapping = {
      idField: idChoice === "feature:" ? undefined : idChoice.slice(6),
      nameField: optional("nameField"),
      kind,
      geometryRole: form.get("geometryRole"),
      heightField: optional("heightField"),
      heightUnit: form.get("heightUnit"),
      heightMeaning: optional("heightMeaning"),
      levelReference: optional("levelReference"),
      ...(kind === "utility" && optional("startLevelField")
        ? {
            utility: {
              startLevelField: optional("startLevelField"),
              endLevelField: optional("endLevelField"),
              levelUnit: form.get("utilityUnit"),
              levelMeaning: form.get("levelMeaning"),
              verticalReference: optional("utilityReference") || null,
              interpolation: "linear_endpoints",
              crossSection: optional("crossSection"),
              diameterField: optional("diameterField"),
              widthField: optional("widthField"),
              heightField: optional("utilityHeightField"),
              dimensionUnit: form.get("utilityUnit"),
            },
          }
        : {}),
    };
    form.set("mapping", JSON.stringify(mapping));
    if (area && form.get("destination") === "current") {
      form.set("areaId", area.id);
      form.set("expectedAreaRevision", String(area.revision));
    }
    onImport(async () => {
      const response = await fetch("/api/v1/import-packages", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "Source import failed.");
      return body;
    });
  }
  return (
    <form onSubmit={submit} className="ui-import-form">
      {!hideFileControls && <>
      <p className="ui-intake-intro">
        Add a GIS source. We will read its details and ask for what is missing.
      </p>
      <p className="ui-intake-context">
        Destination:{" "}
        {destination === "current" && area
          ? `${area.name} · ${area.dataKind === "demonstration" ? "Fictional demonstration" : area.dataKind === "mixed" ? "Mixed source origins" : "Saved block"}`
          : "New block"}
        . Change destination in advanced settings.
      </p>
      <label
        className={`ui-dropzone ${file ? "ui-dropzone-selected" : ""}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const next = event.dataTransfer.files[0];
          if (next && !locked) void choose(next);
        }}
      >
        <Icon name="upload" size={28} />
        <strong>
          {file ? "Choose another GIS source" : "Drop a GIS file here"}
        </strong>
        <span>
          GeoJSON · ArcGIS JSON · GeoPackage · Shapefile ZIP · up to 16 MiB
        </span>
        <input
          ref={input}
          aria-label="Original GIS file"
          type="file"
          accept=".json,.geojson,.gpkg,.zip"
          disabled={locked}
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) void choose(next);
          }}
        />
      </label>
      </>}
      <div aria-live="polite">
        {file && !hideFileControls && (
          <div className="ui-intake-file">
            <Icon name="document" />
            <div>
              <strong>{file.name}</strong>
              <span>
                {reading
                  ? "Reading file details…"
                  : metadata
                    ? `${formats[metadata.format]}${metadata.featureCount ? ` · ${metadata.featureCount} features` : ""}${metadata.layers.length ? ` · ${metadata.layers.length} ${metadata.layers.length === 1 ? "layer" : "layers"}` : ""}`
                    : "Details not read"}
              </span>
            </div>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                clear();
                if (input.current) input.current.value = "";
              }}
            >
              Remove
            </Button>
          </div>
        )}
        {error && (
          <div className="ui-intake-error" role="alert">
            <p>{error}</p>
            <Button
              disabled={locked}
              onClick={async () => {
                if (file) {
                  const result = await inspect(
                    file,
                    metadata?.layer || undefined,
                  );
                  if (result) apply(result, !title);
                }
              }}
            >
              Retry inspection
            </Button>
          </div>
        )}
      </div>
      {metadata && (
        <fieldset className="ui-intake-fields" disabled={locked}>
          {metadata.layers.length > 1 && (
            <label className="ui-intake-question">
              Which source layer should be imported?
              <select
                aria-label="Source layer"
                value={metadata.layer || ""}
                onChange={async (event) => {
                  if (file && event.target.value) {
                    const result = await inspect(file, event.target.value);
                    if (result) apply(result, false);
                  }
                }}
              >
                <option value="">Choose a layer…</option>
                {metadata.layers.map((layer) => (
                  <option key={layer}>{layer}</option>
                ))}
              </select>
              <small>
                Each layer is reviewed separately with its own meaning.
              </small>
            </label>
          )}
          {metadata.featureCount !== null && (
            <>
              <div className="ui-intake-detected">
                <Icon name="check" /> File type read
                {metadata.sourceCrs
                  ? ` · Coordinate system: ${metadata.sourceCrs}`
                  : " · Coordinate system needs input"}
                {metadata.layer ? ` · Layer: ${metadata.layer}` : ""}
              </div>
              <section
                className="ui-intake-questions"
                aria-label="Source details to confirm"
              >
                <h3>What does this source represent?</h3>
                <p>
                  File geometry alone cannot establish its meaning or origin.
                </p>
                <div className="ui-form-grid">
                  <label>
                    These boundaries represent
                    <select
                      required
                      value={kind && role ? `${kind}:${role}` : ""}
                      onChange={(event) => {
                        const [nextKind, nextRole] =
                          event.target.value.split(":");
                        setKind(nextKind || "");
                        setRole(nextRole || "");
                      }}
                    >
                      <option value="">Choose a boundary type…</option>
                      {boundaries.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                      {kind &&
                        role &&
                        !boundaries.some(
                          ([value]) => value === `${kind}:${role}`,
                        ) && (
                          <option value={`${kind}:${role}`}>
                            Custom classification · see advanced settings
                          </option>
                        )}
                    </select>
                  </label>
                  <label>
                    Source origin
                    <select
                      name="worldStatus"
                      required
                      value={worldStatus}
                      onChange={(event) => setWorldStatus(event.target.value)}
                    >
                      <option value="">Choose the source origin…</option>
                      <option value="observed">Observed source</option>
                      <option value="planned">Planned</option>
                      <option value="hypothetical">Hypothetical</option>
                      <option value="synthetic">
                        Synthetic demonstration / test
                      </option>
                    </select>
                  </label>
                  {!metadata.sourceCrs && (
                    <label>
                      Source coordinate system
                      <input
                        name="sourceCrs"
                        value={crs}
                        onChange={(event) => setCrs(event.target.value)}
                        placeholder="EPSG code from source documentation"
                        pattern="EPSG:[0-9]+"
                        required
                      />
                      <small>
                        No reference was declared. Use the source documentation;
                        coordinates are never guessed.
                      </small>
                    </label>
                  )}
                  {!metadata.suggestedIdField &&
                    !metadata.featureIdEligible && (
                      <label>
                        Stable ID column
                        <select
                          name="idField"
                          required
                          value={idChoice}
                          onChange={(event) => setIdChoice(event.target.value)}
                        >
                          <option value="">
                            Choose a complete, unique column…
                          </option>
                          {metadata.fields
                            .filter((field) => field.idEligible)
                            .map((field) => (
                              <option
                                key={field.name}
                                value={`field:${field.name}`}
                              >
                                {field.name}
                              </option>
                            ))}
                        </select>
                        <small>
                          {metadata.fields.some((field) => field.idEligible)
                            ? "More than one plausible ID, or no recognized ID name. Confirm the source identity."
                            : "No complete unique ID column was found. Add stable IDs to the source and choose it again."}
                        </small>
                      </label>
                    )}
                </div>
              </section>
              <datalist id={columnsId}>
                {metadata.fields.map((field) => (
                  <option key={field.name} value={field.name} />
                ))}
              </datalist>
              <details className="ui-form-details">
                <summary>Detected details and advanced settings</summary>
                <div className="ui-form-grid">
                  <label>
                    Boundary type
                    <select
                      name="kind"
                      required
                      value={kind}
                      onChange={(event) => setKind(event.target.value)}
                    >
                      <option value="">Choose a boundary type…</option>
                      <option value="building">Building</option>
                      <option value="parcel">Parcel</option>
                      <option value="road">Road</option>
                      <option value="public_land">Public land</option>
                      <option value="utility">Utility</option>
                    </select>
                  </label>
                  <label>
                    Geometry meaning
                    <select
                      name="geometryRole"
                      required
                      value={role}
                      onChange={(event) => setRole(event.target.value)}
                    >
                      <option value="">Choose the source meaning…</option>
                      <option value="unknown">Not established by source</option>
                      <option value="observed_ground_occupation">
                        Observed ground occupation
                      </option>
                      <option value="observed_roof_projection">
                        Roof projection
                      </option>
                      <option value="approved_building_outline">
                        Approved building outline
                      </option>
                      <option value="recorded_parcel">Recorded parcel</option>
                      <option value="public_road_land">Public road land</option>
                      <option value="road_surface">Road surface</option>
                      <option value="public_land">Public land</option>
                      <option value="physical_utility">Physical utility</option>
                    </select>
                  </label>
                  <label>
                    Block / package title
                    <input
                      name="name"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={150}
                      required
                    />
                  </label>
                  <label>
                    Destination
                    <select
                      name="destination"
                      value={destination}
                      onChange={(event) => setDestination(event.target.value)}
                    >
                      <option value="new">New block</option>
                      {area && (
                        <option value="current">
                          {area.name} · revision {area.revision}
                        </option>
                      )}
                    </select>
                  </label>
                  {metadata.sourceCrs && (
                    <label>
                      Source coordinate system
                      <input
                        name="sourceCrs"
                        value={crs}
                        onChange={(event) => setCrs(event.target.value)}
                        pattern="EPSG:[0-9]+"
                        required
                      />
                      <small>
                        {metadata.crsEvidence}. Conflicting overrides cannot
                        relabel the source.
                      </small>
                    </label>
                  )}
                  {(metadata.suggestedIdField ||
                    metadata.featureIdEligible) && (
                    <label>
                      Stable ID column
                      <select
                        name="idField"
                        value={idChoice}
                        onChange={(event) => setIdChoice(event.target.value)}
                        required
                      >
                        {metadata.featureIdEligible && (
                          <option value="feature:">
                            Feature ID · declared by GeoJSON
                          </option>
                        )}
                        {metadata.fields
                          .filter((field) => field.idEligible)
                          .map((field) => (
                            <option
                              key={field.name}
                              value={`field:${field.name}`}
                            >
                              {field.name}
                            </option>
                          ))}
                      </select>
                      <small>
                        Complete and unique across all {metadata.featureCount}{" "}
                        features.
                      </small>
                    </label>
                  )}
                  <label>
                    Name column
                    <select
                      name="nameField"
                      value={nameField}
                      onChange={(event) => setNameField(event.target.value)}
                    >
                      <option value="">Use boundary type and source ID</option>
                      {metadata.fields
                        .filter(
                          (field) => field.complete && field.name.length <= 80,
                        )
                        .map((field) => (
                          <option key={field.name}>{field.name}</option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Dataset namespace
                    <input
                      name="namespace"
                      value={namespace}
                      onChange={(event) => {
                        setNamespace(event.target.value);
                        setNamespaceEdited(true);
                      }}
                      maxLength={150}
                      required
                    />
                    <small>
                      Generated from original bytes and retained on retries.
                      Reuse an existing dataset namespace only for an
                      intentional source revision.
                    </small>
                  </label>
                  <label>
                    Height column
                    <input name="heightField" list={columnsId} />
                  </label>
                  <label>
                    Height unit
                    <select name="heightUnit">
                      <option value="m">Metres</option>
                      <option value="ft">Feet</option>
                    </select>
                  </label>
                  <label>
                    Height meaning
                    <input
                      name="heightMeaning"
                      placeholder="As stated by the source"
                    />
                  </label>
                  <label>
                    Vertical reference
                    <input
                      name="levelReference"
                      placeholder="Source benchmark"
                    />
                  </label>
                </div>
              </details>
              {kind === "utility" && (
                <details className="ui-form-details" open>
                  <summary>Utility profile</summary>
                  <div className="ui-form-grid">
                    {[
                      ["startLevelField", "Start level column"],
                      ["endLevelField", "End level column"],
                      ["utilityReference", "Vertical reference"],
                      ["diameterField", "Diameter column"],
                      ["widthField", "Width column"],
                      ["utilityHeightField", "Section height column"],
                    ].map(([name, label]) => (
                      <label key={name}>
                        {label}
                        <input name={name} list={columnsId} />
                      </label>
                    ))}
                    <label>
                      Units
                      <select name="utilityUnit">
                        <option value="m">Metres</option>
                        <option value="ft">Feet</option>
                      </select>
                    </label>
                    <label>
                      Level meaning
                      <select name="levelMeaning">
                        <option value="centre">Centre level</option>
                        <option value="invert">Invert level</option>
                        <option value="crown">Crown level</option>
                      </select>
                    </label>
                    <label>
                      Cross section
                      <select name="crossSection">
                        <option value="">Unknown</option>
                        <option value="circular">Circular</option>
                        <option value="rectangular">Rectangular</option>
                      </select>
                    </label>
                  </div>
                </details>
              )}
            </>
          )}
        </fieldset>
      )}
      <div className="ui-form-footer">
        <span>
          <Icon name="info" size={15} />
          Original files will be retained unchanged when you continue.
        </span>
        <div className="ui-intake-continue">
          <Button type="submit" variant="primary" disabled={!ready}>
            {busy ? "Preparing review…" : "Continue to review"}
          </Button>
          <small>{reason || "Changes are reviewed before recording."}</small>
        </div>
      </div>
    </form>
  );
}
