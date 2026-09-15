"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AreaContext } from "@ulpin/contracts";
import { Dialog, Icon, LoadingState, EmptyState, ErrorState } from "./ui";
import { useDebouncedValue, useResource } from "./hooks";
import { useActiveRecents } from "./useActiveRecents";
import { useOfficerStore } from "./store";
import {
  searchTargets,
  searchTargetRoute,
  type ResolveMatch,
  type SearchTarget,
} from "./search-targets";
export type { ResolveMatch } from "./search-targets";

export function SearchDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const settled = useDebouncedValue(query.trim()),
    editing = settled !== query.trim();
  const result = useResource<{ status: string; matches: ResolveMatch[] }>(
    open && settled
      ? `/resolve?identifier=${encodeURIComponent(settled)}`
      : null,
  );
  const recent = useActiveRecents(open),
    selectedArea = useOfficerStore((state) => state.selectedAreaId);
  const membership = useResource<AreaContext>(
    open && settled && selectedArea
      ? `/areas/${encodeURIComponent(selectedArea)}/context`
      : null,
  );
  const router = useRouter(),
    pathname = usePathname();
  const family = pathname.includes("workspace")
    ? "workspace"
    : pathname.includes("register")
      ? "register"
      : "block";
  const verifiedMembership = membership.data
    ? {
        areaId: membership.data.area.id,
        featureIds: membership.data.features.map((feature) => feature.id),
      }
    : undefined;
  function navigate(target: SearchTarget) {
    onClose();
    router.push(searchTargetRoute(target, family));
  }
  return (
    <Dialog open={open} onClose={onClose} title="Find a property">
      <div className="ui-search-input">
        <Icon name="search" />
        <input
          autoFocus
          aria-label="Property identifier"
          placeholder="Address, property ID or source ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={150}
        />
        <kbd>↵</kbd>
      </div>
      {!editing && result.error && (
        <ErrorState message={result.error} retry={result.reload} />
      )}
      {(editing || result.loading) && (
        <LoadingState label="Searching loaded records" />
      )}
      {!editing && !settled ? (
        <div className="ui-search-results">
          <p className="ui-eyebrow">Recently opened</p>
          {recent.map((property) => (
            <button
              key={property.buildingId}
              onClick={() =>
                navigate({
                  id: property.buildingId,
                  areaId: property.areaId,
                  kind: "building",
                  name: property.name,
                  identifier: property.identifier,
                })
              }
            >
              <Icon name="building" />
              <span>
                <strong>{property.name}</strong>
                <small>{property.identifier}</small>
              </span>
              <Icon name="arrow" />
            </button>
          ))}
          {!recent.length && (
            <EmptyState
              title="Your next property starts here"
              description="Search an identifier from loaded data, or choose a building on the block map."
              icon="search"
            />
          )}
        </div>
      ) : (
        !editing &&
        result.data && (
          <div className="ui-search-results">
            {result.data.matches.map((match, index) => {
              const targets = searchTargets(
                match,
                selectedArea,
                verifiedMembership,
              );
              return (
                <div key={index}>
                  {targets.length > 1 && (
                    <p>
                      This record is linked to multiple buildings. Choose the
                      property to open.
                    </p>
                  )}
                  {targets.map((target) => (
                    <button
                      key={`${target.kind}:${target.id || target.areaId}`}
                      onClick={() => navigate(target)}
                    >
                      <Icon
                        name={target.kind === "building" ? "building" : "map"}
                      />
                      <span>
                        <strong>{target.recordName || target.name}</strong>
                        {target.recordName && <small>{target.name}</small>}
                        <small>{target.identifier}</small>
                      </span>
                      <Icon name="arrow" />
                    </button>
                  ))}
                  {!targets.length && (
                    <p>This record has no linked block property.</p>
                  )}
                </div>
              );
            })}
            {!result.data.matches.length && (
              <EmptyState
                title="No matching property"
                description="Check the identifier or open a block to browse its properties."
                icon="search"
              />
            )}
          </div>
        )
      )}
    </Dialog>
  );
}
