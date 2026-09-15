"use client";
import Link from "next/link";
import { useState } from "react";
import type { MapArea, AreaContext } from "@ulpin/contracts";
import { useResource } from "../shared/hooks";
import { useV2Store } from "../shared/store";
import { routes } from "../shared/routes";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
} from "../shared/ui";
import MapPlan from "./MapPlan";
import DataTools from "./DataTools";
import "./home.css";
import "./data-tools.css";
export default function BlockHome() {
  const areas = useResource<MapArea[]>("/areas"),
    recentArea = useV2Store((s) => s.selectedAreaId);
  const [query, setQuery] = useState(""),
    [toolsOpen, setToolsOpen] = useState(false);
  const selected =
    areas.data?.find((a) => a.id === recentArea) ||
    areas.data?.find((a) => a.reference) ||
    areas.data?.[0];
  const preview = useResource<AreaContext>(
    selected ? `/areas/${selected.id}/context` : null,
  );
  const list = (areas.data || []).filter((a) =>
    `${a.name} ${a.administrativeUnits.map((unit) => unit.name).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <main className="v2-home">
      <div className="v2-home-topline">
        <p className="v2-eyebrow">Your spatial workspace</p>
        <span>
          <Icon name="history" size={14} />
          Saved data, ready to continue
        </span>
      </div>
      <section className="v2-home-hero">
        <div className="v2-home-intro">
          <span className="v2-home-kicker">
            <i />
            CONNECTED PROPERTY RECORDS
          </span>
          <h1>
            See the block.
            <br />
            Understand the property.
          </h1>
          <p>
            One place for the map, the register and the evidence behind every
            detail.
          </p>
          <div className="v2-home-hero-actions">
            {selected ? (
              <Link
                className="v2-button v2-button--primary"
                href={routes.block(selected.id)}
              >
                <Icon name="map" />
                Open block
                <Icon name="arrow" size={15} />
              </Link>
            ) : (
              <Button
                variant="primary"
                icon="upload"
                onClick={() => setToolsOpen(true)}
              >
                Import a block
              </Button>
            )}
            <Link
              className="v2-button v2-button--ghost"
              href={routes.register()}
            >
              Find a register
              <Icon name="arrow" size={15} />
            </Link>
          </div>
          <div className="v2-home-trust">
            <span>
              <Icon name="document" size={15} />
              Source linked
            </span>
            <span>
              <Icon name="history" size={15} />
              Revision preserved
            </span>
            <span>
              <Icon name="check" size={15} />
              Review before recording
            </span>
          </div>
        </div>
        <div className="v2-home-preview">
          {preview.data ? (
            <>
              <MapPlan
                features={preview.data.features}
                extent={preview.data.area.extent}
                interactive={false}
              />
              <div className="v2-preview-chip">
                <Icon name="map" />
                <div>
                  <strong>{preview.data.area.name}</strong>
                  <span>
                    {preview.data.features.length} recorded features · actual
                    source geometry
                  </span>
                </div>
                <Badge>Saved block</Badge>
              </div>
            </>
          ) : preview.error ? (
            <EmptyState
              title="Preview unavailable"
              description="Choose a block below to retry."
              icon="map"
            />
          ) : (
            <LoadingState label="Loading saved geometry" />
          )}
        </div>
      </section>
      <div className="v2-home-shortcuts">
        <Link href={routes.register()}>
          <span className="v2-shortcut-icon">
            <Icon name="register" size={23} />
          </span>
          <div>
            <h2>Property register</h2>
            <p>Floors, spaces and their evidence</p>
          </div>
          <Icon name="arrow" />
        </Link>
        <Link href={routes.workspace()}>
          <span className="v2-shortcut-icon v2-shortcut-icon--blue">
            <Icon name="workspace" size={23} />
          </span>
          <div>
            <h2>Plan workspace</h2>
            <p>Prepare, measure and review details</p>
          </div>
          <Icon name="arrow" />
        </Link>
        <button onClick={() => setToolsOpen(true)}>
          <span className="v2-shortcut-icon v2-shortcut-icon--amber">
            <Icon name="upload" size={23} />
          </span>
          <div>
            <h2>Bring your sources</h2>
            <p>Import GIS or open a saved snapshot</p>
          </div>
          <Icon name="arrow" />
        </button>
      </div>
      <section className="v2-block-library">
        <header>
          <div>
            <h2>
              Your blocks <Badge>{areas.data?.length || 0}</Badge>
            </h2>
            <p>Open a saved area to inspect its properties.</p>
          </div>
          <div className="v2-library-actions">
            <div className="v2-search-input">
              <Icon name="search" size={16} />
              <input
                placeholder="Search blocks"
                aria-label="Search saved blocks"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button icon="plus" onClick={() => setToolsOpen(true)}>
              Import block
            </Button>
          </div>
        </header>
        {areas.error && (
          <ErrorState message={areas.error} retry={areas.reload} />
        )}{" "}
        {areas.loading && !areas.data ? (
          <LoadingState label="Loading blocks" />
        ) : !list.length ? (
          <EmptyState
            title={query ? "No matching blocks" : "Start with a source"}
            description={
              query
                ? "Try another area name."
                : "Import your geographic source or choose a saved snapshot."
            }
            icon="map"
            action={
              !query && (
                <Button onClick={() => setToolsOpen(true)}>Import block</Button>
              )
            }
          />
        ) : (
          <div className="v2-block-table">
            <div className="v2-block-table-heading">
              <span>Block / area</span>
              <span>Coordinate reference</span>
              <span>Revision</span>
              <span />
            </div>
            {list.map((area) => (
              <Link key={area.id} href={routes.block(area.id)}>
                <span className="v2-block-table-name">
                  <span className="v2-block-thumb">
                    <Icon name="layers" size={24} />
                  </span>
                  <span>
                    <strong>{area.name}</strong>
                    <small>
                      {area.administrativeUnits
                        .map((a) => a.name)
                        .join(" / ") || "Local source area"}
                    </small>
                  </span>
                </span>
                <span className="v2-reference-cell">
                  {area.reference?.analysisCrs || "Not established"}
                  <small>
                    {area.reference ? "Local metre frame" : "Import required"}
                  </small>
                </span>
                <Badge>r{area.revision}</Badge>
                <Icon name="arrow" />
              </Link>
            ))}
          </div>
        )}
      </section>
      <footer className="v2-home-footer">
        <span>3D ULPIN · Local officer workspace</span>
        <a href={routes.legacy}>
          Previous interface <Icon name="external" size={13} />
        </a>
      </footer>
      <DataTools
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        onChanged={() => void areas.reload()}
      />
    </main>
  );
}
