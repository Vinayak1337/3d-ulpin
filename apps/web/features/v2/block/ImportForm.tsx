"use client";
import { useState, type FormEvent } from "react";
import type { MapArea, ImportPackage } from "@ulpin/contracts";
import { Button, Icon } from "../shared/ui";
export default function ImportForm({
  area,
  busy,
  onImport,
}: {
  area?: MapArea;
  busy: boolean;
  onImport: (operation: () => Promise<ImportPackage>) => void;
}) {
  const [kind, setKind] = useState("building"),
    [columns, setColumns] = useState<string[]>([]),
    [filename, setFilename] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (name: string) =>
      String(form.get(name) || "") || undefined;
    const mapping = {
      idField: form.get("idField"),
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
    <form onSubmit={submit} className="v2-import-form">
      <label className="v2-dropzone">
        <Icon name="upload" size={28} />
        <strong>{filename || "Choose a geographic source"}</strong>
        <span>GeoJSON · ArcGIS JSON · GeoPackage · Shapefile ZIP</span>
        <input
          required
          aria-label="Original GIS file"
          type="file"
          name="file"
          accept=".json,.geojson,.gpkg,.zip"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setFilename(file?.name || "");
            setColumns([]);
            if (
              file &&
              /\.(geojson|json)$/i.test(file.name) &&
              file.size < 16 * 1024 * 1024
            ) {
              try {
                const parsed = JSON.parse(await file.text());
                const keys = new Set<string>();
                for (const feature of (parsed.features || []).slice(0, 20))
                  Object.keys(
                    feature.properties || feature.attributes || {},
                  ).forEach((key) => keys.add(key));
                setColumns([...keys]);
              } catch {
                /* Server will report source validation errors. */
              }
            }
          }}
        />
      </label>
      <datalist id="v2-import-columns">
        {columns.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="v2-form-grid">
        <label>
          Format
          <select name="format">
            <option value="geojson">GeoJSON</option>
            <option value="arcgis">ArcGIS JSON</option>
            <option value="gpkg">GeoPackage</option>
            <option value="shapefile_zip">Shapefile ZIP</option>
          </select>
        </label>
        <label>
          Source CRS
          <input
            name="sourceCrs"
            defaultValue="EPSG:4326"
            required
            pattern="EPSG:[0-9]+"
          />
        </label>
        <label>
          Dataset namespace
          <input name="namespace" placeholder="Provider / dataset" required />
        </label>
        <label>
          Block / package name
          <input name="name" placeholder="Name this source package" required />
        </label>
        <label>
          Stable ID column
          <input
            name="idField"
            list="v2-import-columns"
            placeholder="property_id"
            required
          />
        </label>
        <label>
          Name column
          <input
            name="nameField"
            list="v2-import-columns"
            placeholder="Optional"
          />
        </label>
        <label>
          Feature type
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="building">Building</option>
            <option value="parcel">Parcel</option>
            <option value="road">Road</option>
            <option value="public_land">Public land</option>
            <option value="utility">Utility</option>
          </select>
        </label>
        <label>
          Geometry meaning
          <select name="geometryRole">
            <option value="unknown">Not established by source</option>
            <option value="observed_ground_occupation">
              Observed ground occupation
            </option>
            <option value="observed_roof_projection">Roof projection</option>
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
          World status
          <select name="worldStatus">
            <option value="observed">Observed source</option>
            <option value="planned">Planned</option>
            <option value="hypothetical">Hypothetical</option>
            <option value="synthetic">Synthetic test data</option>
          </select>
        </label>
        <label>
          Destination
          <select name="destination">
            <option value="new">New block</option>
            {area && (
              <option value="current">
                {area.name} · revision {area.revision}
              </option>
            )}
          </select>
        </label>
      </div>
      <details className="v2-form-details">
        <summary>Height and source options</summary>
        <div className="v2-form-grid">
          <label>
            Layer name
            <input name="layer" placeholder="For multi-layer packages" />
          </label>
          <label>
            Height column
            <input name="heightField" list="v2-import-columns" />
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
            <input name="heightMeaning" placeholder="As stated by the source" />
          </label>
          <label>
            Vertical reference
            <input name="levelReference" placeholder="Source benchmark" />
          </label>
        </div>
      </details>
      {kind === "utility" && (
        <details className="v2-form-details" open>
          <summary>Utility profile</summary>
          <div className="v2-form-grid">
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
                <input name={name} list="v2-import-columns" />
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
      <div className="v2-form-footer">
        <span>
          <Icon name="info" size={15} />
          Original bytes are retained before review.
        </span>
        <Button type="submit" variant="primary" icon="upload" disabled={busy}>
          {busy ? "Reading source…" : "Import & preview"}
        </Button>
      </div>
    </form>
  );
}
