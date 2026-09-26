/**
 * The Studio selection: {mode, building, level, space, finding, view, render, colourBy, panel}
 * (mockup reference "Interaction model"). The URL is its source of truth (H99), so saved links reopen
 * the same view: /studio/areas/:areaId?feature=&mode=&level=&record=&finding=&view=&render=&colour=&panel=
 */
export type MapMode = 'area' | 'building' | 'level' | 'findings' | 'underground';
export type ColourBy = 'none' | 'rights';
export type LeftPanel = 'layers' | null;

export interface Selection {
  mode: MapMode;
  buildingId: string | null;
  levelId: string | null;
  spaceId: string | null;
  findingId: string | null;
  view: '3d' | '2d';
  render: 'model' | 'volumes';
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
    view: params.get('view') === '2d' ? '2d' : '3d',
    render: params.get('render') === 'volumes' ? 'volumes' : 'model',
    colourBy: params.get('colour') === 'rights' ? 'rights' : 'none',
    panel: params.get('panel') === 'layers' ? 'layers' : null,
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
  set('view', selection.view, '3d');
  set('render', selection.render, 'model');
  set('colour', selection.colourBy, 'none');
  set('panel', selection.panel);
  return params;
}

export type SelectionEvent =
  | { type: 'pickBuilding'; id: string }
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

/** The interaction table as a pure transition, so the map, lists, inspector and keyboard agree. */
export function transition(s: Selection, event: SelectionEvent): Selection {
  const clear = { levelId: null, spaceId: null, findingId: null };
  switch (event.type) {
    case 'pickBuilding':
      if (s.mode === 'area' && s.buildingId === event.id) return { ...s, mode: 'building', ...clear };
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
