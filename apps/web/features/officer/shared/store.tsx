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
import { SpatialDataProvider } from "@/features/spatial/data/Provider";
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
  inspector: "property" | "floors" | "evidence" | "parcel" | "utility" | "photos" | "history";
  rail: "layers" | "properties";
  findingsOpen: boolean;
  opacity?:Partial<Record<FeatureKind,number>>;
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
export type OfficerState = {
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
/** One store per officer layout; no request-shared mutable server singleton. */
export function createOfficerStore() {
  return createStore<OfficerState>((set) => ({
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
const Context = createContext<StoreApi<OfficerState> | null>(null);
export const mapSettingsStorageKey='ulpin:studio:saved-map-settings:1';
export function parseSavedMapSettings(raw:string|null):Record<string,MapPreferences>{
 const out:Record<string,MapPreferences>={};if(!raw||raw.length>150000)return out;
 try{const value=JSON.parse(raw);if(value?.version!==1||!Array.isArray(value.areas))return out;
  for(const entry of value.areas.slice(0,64)){
   if(!entry||typeof entry.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,150}$/.test(entry.id)||['constructor','prototype','__proto__'].includes(entry.id)||!entry.preferences)continue;
   const p=entry.preferences,kinds=['building','parcel','road','utility','public_land'];
   const opacity=Object.fromEntries(Object.entries(p.opacity??{}).filter(([k,v])=>kinds.includes(k)&&typeof v==='number'&&Number.isFinite(v)&&v>=.05&&v<=1));
   out[entry.id]={...defaultMapPreferences,mode:p.mode==='2d'?'2d':'3d',labels:p.labels===true,underground:p.underground===true,hiddenLayers:Array.isArray(p.hiddenLayers)?p.hiddenLayers.filter((x:unknown)=>typeof x==='string'&&kinds.includes(x)):[],inspector:['property','floors','evidence','parcel','utility','photos','history'].includes(p.inspector)?p.inspector:'property',rail:p.rail==='layers'?'layers':'properties',findingsOpen:p.findingsOpen===true,opacity};
  }
 }catch{}return out;
}
export const navigationStorageKey = "ulpin:v2:navigation:1";
type SavedNavigation = Pick<
  OfficerState,
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
export function parseOfficerNavigation(raw: string | null): SavedNavigation {
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
export function hydrateOfficerStore(
  store: StoreApi<OfficerState>,
  raw: string | null,
) {
  const saved = parseOfficerNavigation(raw),
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
export function OfficerStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createOfficerStore);
  useEffect(() => {
    // Deliberately retain only navigation in this browser tab, never dossier or evidence data.
    try {
      hydrateOfficerStore(store, sessionStorage.getItem(navigationStorageKey));
      store.setState(s=>({mapPreferences:{...parseSavedMapSettings(localStorage.getItem(mapSettingsStorageKey)),...s.mapPreferences}}));
    } catch {
      hydrateOfficerStore(store, null);
    }
    return store.subscribe((state) => {
      try {
        sessionStorage.setItem(
          navigationStorageKey,
          JSON.stringify({
            version: 1,
            recentProperties: state.recentProperties,
            selectedAreaId: state.selectedAreaId,
            selectedBuildingId: state.selectedBuildingId,
          }),
        );
        localStorage.setItem(mapSettingsStorageKey,JSON.stringify({version:1,areas:Object.entries(state.mapPreferences).slice(-64).map(([id,preferences])=>({id,preferences}))}));
      } catch {
        /* Navigation works without storage. */
      }
    });
  }, [store]);
  return <Context.Provider value={store}><SpatialDataProvider>{children}</SpatialDataProvider></Context.Provider>;
}
export function useOfficerStore<T>(selector: (state: OfficerState) => T): T {
  const store = useContext(Context);
  if (!store) throw new Error("OfficerStoreProvider is required");
  return useStore(store, selector);
}
