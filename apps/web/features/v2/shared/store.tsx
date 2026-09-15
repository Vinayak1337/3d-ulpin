"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { FeatureKind } from "@ulpin/contracts";

export type RecentProperty = {
  buildingId: string;
  areaId: string;
  name: string;
  identifier: string;
  areaName?: string;
};
export type MapPreferences = {
  mode: "3d" | "2d";
  labels: boolean;
  underground: boolean;
  hiddenLayers: FeatureKind[];
  inspector: "property" | "parcel" | "utility" | "photos" | "history";
  rail: "layers" | "properties";
  findingsOpen: boolean;
};
export const defaultMapPreferences: MapPreferences = {
  mode: "3d",
  labels: false,
  underground: false,
  hiddenLayers: [],
  inspector: "property",
  rail: "properties",
  findingsOpen: false,
};
export type V2State = {
  selectedAreaId: string | null;
  selectedBuildingId: string | null;
  areaName: string;
  recentProperties: RecentProperty[];
  mapPreferences: Record<string, MapPreferences>;
  hydrated: boolean;
  selectProperty: (property: RecentProperty) => void;
  selectBlock: (areaId: string, areaName?: string) => void;
  clearSelection: () => void;
  setMapPreferences: (areaId: string, patch: Partial<MapPreferences>) => void;
};
/** One store per V2 layout; no request-shared mutable server singleton. */
export function createV2Store() {
  return createStore<V2State>((set) => ({
    selectedAreaId: null,
    selectedBuildingId: null,
    areaName: "",
    recentProperties: [],
    mapPreferences: {},
    hydrated: false,
    selectProperty: (property) =>
      set((state) => ({
        selectedAreaId: property.areaId,
        selectedBuildingId: property.buildingId,
        areaName:
          property.areaName ||
          (state.selectedAreaId === property.areaId ? state.areaName : ""),
        recentProperties: [
          property,
          ...state.recentProperties.filter(
            (p) => p.buildingId !== property.buildingId,
          ),
        ].slice(0, 12),
      })),
    selectBlock: (areaId, areaName = "") =>
      set((state) => ({
        selectedAreaId: areaId,
        areaName,
        selectedBuildingId:
          state.selectedAreaId === areaId ? state.selectedBuildingId : null,
      })),
    clearSelection: () => set({ selectedBuildingId: null }),
    setMapPreferences: (areaId, patch) =>
      set((state) => ({
        mapPreferences: {
          ...state.mapPreferences,
          [areaId]: {
            ...defaultMapPreferences,
            ...state.mapPreferences[areaId],
            ...patch,
          },
        },
      })),
  }));
}
const Context = createContext<StoreApi<V2State> | null>(null);
export const v2NavigationStorageKey = "ulpin:v2:navigation:1";
type SavedNavigation = Pick<
  V2State,
  "selectedAreaId" | "selectedBuildingId" | "areaName" | "recentProperties"
>;
const navigationText = (value: unknown, limit = 500): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= limit;
function uniqueRecent(properties: RecentProperty[]) {
  const result: RecentProperty[] = [],
    seen = new Set<string>();
  for (const property of properties) {
    if (seen.has(property.buildingId)) continue;
    seen.add(property.buildingId);
    result.push(property);
    if (result.length === 12) break;
  }
  return result;
}
/** Browser storage is untrusted. Project only supported, renderable navigation fields. */
export function parseV2Navigation(raw: string | null): SavedNavigation {
  const empty: SavedNavigation = {
    selectedAreaId: null,
    selectedBuildingId: null,
    areaName: "",
    recentProperties: [],
  };
  if (!raw || raw.length > 1024 * 1024) return empty;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      (value.version !== undefined && value.version !== 1) ||
      !Array.isArray(value.recentProperties)
    )
      return empty;
    const recent: RecentProperty[] = [];
    for (const item of value.recentProperties.slice(0, 1000)) {
      if (
        !item ||
        typeof item !== "object" ||
        ![item.buildingId, item.areaId, item.identifier].every((text) =>
          navigationText(text, 150),
        ) ||
        !navigationText(item.name)
      )
        continue;
      recent.push({
        buildingId: item.buildingId,
        areaId: item.areaId,
        identifier: item.identifier,
        name: item.name,
        ...(navigationText(item.areaName) ? { areaName: item.areaName } : {}),
      });
    }
    const recentProperties = uniqueRecent(recent);
    const selectedAreaId = navigationText(value.selectedAreaId, 150)
      ? value.selectedAreaId
      : null;
    const selected = recentProperties.find(
      (property) =>
        property.buildingId === value.selectedBuildingId &&
        property.areaId === selectedAreaId,
    );
    return {
      selectedAreaId,
      selectedBuildingId: selected?.buildingId || null,
      areaName: selected?.areaName || "",
      recentProperties,
    };
  } catch {
    return empty;
  }
}
/** Route selection may happen before the provider's passive effect; saved navigation cannot replace it. */
export function hydrateV2Store(store: StoreApi<V2State>, raw: string | null) {
  const saved = parseV2Navigation(raw),
    current = store.getState();
  const selection =
    current.selectedAreaId !== null || current.selectedBuildingId !== null
      ? {}
      : {
          selectedAreaId: saved.selectedAreaId,
          selectedBuildingId: saved.selectedBuildingId,
          areaName: saved.areaName,
        };
  store.setState({
    ...selection,
    recentProperties: uniqueRecent([
      ...current.recentProperties,
      ...saved.recentProperties,
    ]),
    hydrated: true,
  });
}
export function V2StoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createV2Store);
  useEffect(() => {
    // Deliberately retain only navigation in this browser tab, never dossier or evidence data.
    try {
      hydrateV2Store(store, sessionStorage.getItem(v2NavigationStorageKey));
    } catch {
      hydrateV2Store(store, null);
    }
    return store.subscribe((state) => {
      try {
        sessionStorage.setItem(
          v2NavigationStorageKey,
          JSON.stringify({
            version: 1,
            recentProperties: state.recentProperties,
            selectedAreaId: state.selectedAreaId,
            selectedBuildingId: state.selectedBuildingId,
          }),
        );
      } catch {
        /* Navigation works without storage. */
      }
    });
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useV2Store<T>(selector: (state: V2State) => T): T {
  const store = useContext(Context);
  if (!store) throw new Error("V2StoreProvider is required");
  return useStore(store, selector);
}
