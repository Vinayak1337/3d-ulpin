import { ArrowCounterClockwise, Cursor, Ruler, Scissors, Shovel, type Icon as PhosphorIcon } from '@phosphor-icons/react';
import type { Measurement, SceneTool } from '@ulpin/scene';
import { Icon } from '@ulpin/ui';
import type { ColourBy } from '../../state/selection';
import type { SpaceModel } from '../../model/building';
import styles from './MapSidebar.module.css';

type Colour = Exclude<ColourBy, 'auto'>;

/**
 * The map's left sidebar: the tools that act on the canvas, what the map is coloured by and, on a floor,
 * its spaces as a list (the keyboard alternative to clicking them). Facts about the selection live only
 * in the inspector on the right.
 */
export function MapSidebar({
  tool, underground, canSection, canUnderground, onTool, onUnderground, onReset,
  section, measurement, onClearMeasure,
  colour, colourOptions, onColour,
  floor, spaces, rightsColour, selectedSpaceId, onSelectSpace,
}: {
  tool: SceneTool; underground: boolean; canSection: boolean; canUnderground: boolean;
  onTool: (tool: SceneTool) => void; onUnderground: () => void; onReset: () => void;
  section: { value: number; max: number; onChange: (v: number) => void } | null;
  measurement: Measurement | null; onClearMeasure: () => void;
  colour: Colour; colourOptions: { value: Colour; label: string; disabled?: boolean }[]; onColour: (c: Colour) => void;
  floor: string | null; spaces: SpaceModel[]; rightsColour: (id: string) => string | null; selectedSpaceId: string | null; onSelectSpace: (s: SpaceModel) => void;
}) {
  const row = (pressed: boolean, label: string, icon: PhosphorIcon, key: string, onClick: () => void, disabled = false, hint?: string) => (
    <button type="button" className={styles.row} aria-pressed={pressed} disabled={disabled} onClick={onClick} title={hint ?? label} aria-keyshortcuts={key}>
      <Icon icon={icon} size={20} />
      <span className={styles.label}>{label}</span>
      <kbd className={styles.key}>{key}</kbd>
    </button>
  );
  return (
    <nav className={styles.sidebar} aria-label="Map tools">
      <div className={styles.group} role="toolbar" aria-label="Tools">
        {row(tool === 'select' && !underground, 'Select', Cursor, 'V', () => onTool('select'))}
        {row(tool === 'measure', 'Measure', Ruler, 'M', () => onTool(tool === 'measure' ? 'select' : 'measure'), false, 'Click two points')}
        {tool === 'measure' ? (
          <div className={styles.detail} role="status">
            {typeof measurement?.distanceM === 'number' ? (
              <>
                <span><b className="ul-num">{measurement.distanceM.toFixed(2)} m</b></span>
                <span className="ul-num">↔ {measurement.horizontalM!.toFixed(2)} · ↕ {Math.abs(measurement.verticalM!).toFixed(2)}</span>
                <button type="button" className={styles.link} onClick={onClearMeasure}>Clear</button>
              </>
            ) : <span>{measurement?.points.length === 1 ? 'Click the second point' : 'Click two points on the map'}</span>}
          </div>
        ) : null}
        {row(tool === 'section', 'Section', Scissors, 'X', () => onTool(tool === 'section' ? 'select' : 'section'), !canSection, canSection ? 'Cut the building at a height' : 'Select a building first')}
        {tool === 'section' && section ? (
          <label className={styles.detail}>
            <span>Cut at <b className="ul-num">{section.value.toFixed(1)} m</b></span>
            <input type="range" min={0.5} max={section.max} step={0.1} value={section.value} onChange={(e) => section.onChange(Number(e.target.value))} aria-label="Section height" />
          </label>
        ) : null}
        {row(underground, 'Underground', Shovel, 'U', onUnderground, !canUnderground, canUnderground ? 'Show what lies below' : 'Select a building first')}
        {row(false, 'Reset view', ArrowCounterClockwise, 'R', onReset)}
      </div>

      <div className={styles.group}>
        <h2 className={styles.heading}>Colour by</h2>
        <div role="radiogroup" aria-label="Colour by" className={styles.segments}>
          {colourOptions.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={colour === o.value} disabled={o.disabled} onClick={() => onColour(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>

      {floor && spaces.length ? (
        <div className={`${styles.group} ${styles.fill}`}>
          <h2 className={styles.heading}>{floor}</h2>
          <ul className={styles.spaces}>
            {spaces.map((s) => {
              const c = rightsColour(s.id);
              return (
                <li key={s.id}>
                  <button type="button" aria-current={s.id === selectedSpaceId || undefined} onClick={() => onSelectSpace(s)}>
                    <span className={styles.swatch} style={c ? { background: c } : undefined} />
                    {s.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}
