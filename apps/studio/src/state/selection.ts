/**
 * The Studio selection: {mode, building, level, space, finding, view, render, colourBy, panel}
 * (mockup reference "Interaction model"). The URL is its source of truth (H99), so saved links reopen
 * the same view: /studio/areas/:areaId?feature=&mode=&level=&record=&finding=&colour=&panel=
 * (older links with view= and render= still open; those parameters are ignored).
 */
export type MapMode = 'area' | 'building' | 'level' | 'findings' | 'underground';
/** `auto` follows the mode: Rights on a level, Utilities underground, None elsewhere. */
export type ColourBy = 'auto' | 'none' | 'rights' | 'utilities' | 'height';
export type LeftPanel = 'layers' | 'spaces' | 'sources' | 'checks' | null;
const PANELS: Exclude<LeftPanel, null>[] = ['layers', 'spaces', 'sources', 'checks'];

export interface Selection {
  mode: MapMode;
  buildingId: string | null;
  levelId: string | null;
  spaceId: string | null;
  findingId: string | null;
  colourBy: ColourBy;
  panel: LeftPanel;
}

const MODES: MapMode[] = ['area', 'building', 'level', 'findings', 'underground'];

export function readSelection(params: URLSearchParams): Selection {
  const buildingId = params.get('feature');
  const requested = params.get('mode') as MapMode | null;
  const levelId = params.get('level');
  let mode: MapMode = requested && MODES.includes(requested) ? requested : buildingId ? 'area' : 'area';
  if (mode !== 'area' && !buildingId) mode = 'area';
  if (mode === 'level' && !levelId) mode = 'building';
  return {
    mode,
    buildingId,
    levelId: mode === 'level' ? levelId : null,
    spaceId: mode === 'level' ? params.get('record') : null,
    findingId: mode === 'findings' ? params.get('finding') : null,
    colourBy: (['none', 'rights', 'utilities', 'height'] as const).find((c) => c === params.get('colour')) ?? 'auto',
    panel: PANELS.find((p) => p === params.get('panel')) ?? null,
  };
}

export function writeSelection(selection: Selection, base = new URLSearchParams()): URLSearchParams {
  const params = new URLSearchParams(base);
  const set = (key: string, value: string | null | undefined, skip?: string) => {
    if (value && value !== skip) params.set(key, value); else params.delete(key);
  };
  set('feature', selection.buildingId);
  set('mode', selection.mode, 'area');
  set('level', selection.levelId);
  set('record', selection.spaceId);
  set('finding', selection.findingId);
  params.delete('view');
  params.delete('render');
  set('colour', selection.colourBy, 'auto');
  set('panel', selection.panel);
  return params;
}

export type SelectionEvent =
  | { type: 'pickBuilding'; id: string; levelId?: string }
  | { type: 'pickSpace'; id: string; levelId: string }
  | { type: 'pickGround' }
  | { type: 'selectBuilding'; id: string | null }
  | { type: 'exploreBuilding' }
  | { type: 'selectLevel'; id: string }
  | { type: 'selectSpace'; id: string | null }
  | { type: 'openFindings'; findingId?: string | null }
  | { type: 'openUnderground' }
  | { type: 'leaveMode' }
  | { type: 'escape' };

/** The Colour by in effect: `auto` follows the mode. */
export function effectiveColour(s: Selection): Exclude<ColourBy, 'auto'> {
  if (s.colourBy !== 'auto') return s.colourBy;
  return s.mode === 'level' ? 'rights' : s.mode === 'underground' ? 'utilities' : 'none';
}

/** The interaction table as a pure transition, so the map, lists, inspector and keyboard agree. */
export function transition(s: Selection, event: SelectionEvent): Selection {
  const clear = { levelId: null, spaceId: null, findingId: null };
  switch (event.type) {
    case 'pickBuilding':
      if (s.mode === 'area' && s.buildingId === event.id) return { ...s, mode: 'building', ...clear };
      // In building mode a click on one of its storeys opens that floor.
      if (s.mode === 'building' && s.buildingId === event.id && event.levelId) return { ...s, mode: 'level', levelId: event.levelId, spaceId: null, findingId: null };
      if (s.mode === 'underground' || s.mode === 'findings') return { ...s, buildingId: event.id, ...clear, findingId: null };
      return { ...s, mode: s.mode === 'area' ? 'area' : 'building', buildingId: event.id, ...clear };
    case 'pickSpace':
      return { ...s, mode: 'level', levelId: event.levelId, spaceId: event.id, findingId: null };
    case 'pickGround':
      if (s.mode === 'level') return s.spaceId ? { ...s, spaceId: null } : s;
      if (s.mode === 'area' || s.mode === 'building') return { ...s, mode: 'area', buildingId: null, ...clear };
      return s;
    case 'selectBuilding':
      return { ...s, mode: 'area', buildingId: event.id, ...clear };
    case 'exploreBuilding':
      return s.buildingId ? { ...s, mode: 'building', ...clear } : s;
    case 'selectLevel':
      return s.buildingId ? { ...s, mode: 'level', levelId: event.id, spaceId: null, findingId: null } : s;
    case 'selectSpace':
      return s.mode === 'level' ? { ...s, spaceId: event.id } : s;
    case 'openFindings':
      return s.buildingId ? { ...s, mode: 'findings', levelId: null, spaceId: null, findingId: event.findingId ?? null } : s;
    case 'openUnderground':
      return s.buildingId ? { ...s, mode: 'underground', ...clear } : s;
    case 'leaveMode':
      return s.buildingId ? { ...s, mode: 'building', ...clear } : { ...s, mode: 'area', ...clear };
    case 'escape':
      // Unwind one step: space → level → building → area → clear.
      if (s.mode === 'level' && s.spaceId) return { ...s, spaceId: null };
      if (s.mode === 'level' || s.mode === 'findings' || s.mode === 'underground') return { ...s, mode: 'building', ...clear };
      if (s.mode === 'building') return { ...s, mode: 'area', ...clear };
      return s.buildingId ? { ...s, buildingId: null } : s;
  }
}
