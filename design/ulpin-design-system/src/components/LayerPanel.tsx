import { useState, type CSSProperties } from 'react';
import { Icon } from './Icon';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';
import { Toggle } from './Toggle';

export interface Layer {
  id: string;
  label: string;
  /** Swatch fill as a token reference, e.g. "var(--map-building)". */
  color?: string;
  /** Outline-only swatch (parcels). */
  outline?: boolean;
  /** Hatched swatch (unknown or no data). */
  hatch?: boolean;
  visible?: boolean;
  /** No data for this layer: shows "No data" in ink-muted; stays toggleable. */
  noData?: boolean;
}

export interface LayerGroup {
  /** Context, Cadastre, Below ground, Evidence. */
  label: string;
  layers: Layer[];
}

export interface LayerPanelProps {
  /** Colour by options; only one at a time. Default None · Rights · Readiness. */
  colourByOptions?: string[];
  colourBy?: string;
  onColourByChange?: (mode: string) => void;
  groups: LayerGroup[];
  onToggle?: (layerId: string, visible: boolean) => void;
  style?: CSSProperties;
}

/**
 * The Layers view of the left rail (308px): a Colour by control, then layer groups with swatches and switches.
 */
export function LayerPanel({
  colourByOptions = ['None', 'Rights', 'Readiness'],
  colourBy,
  onColourByChange,
  groups,
  onToggle,
  style,
}: LayerPanelProps) {
  return (
    <Panel style={{ width: 308, ...style }} title="Layers" aside={<Icon name="stack" />} bodyPadding={8}>
      <div className="ul-group-label">Colour by</div>
      <SegmentedControl
        aria-label="Colour by"
        style={{ margin: '0 8px 6px' }}
        options={colourByOptions.map((o) => ({ value: o, label: o }))}
        defaultValue={colourBy ?? colourByOptions[0]}
        onChange={onColourByChange}
      />
      {groups.map((g) => (
        <div key={g.label}>
          <div className="ul-group-label">{g.label}</div>
          {g.layers.map((l) => (
            <LayerRow key={l.id} l={l} onToggle={onToggle} />
          ))}
        </div>
      ))}
    </Panel>
  );
}

function LayerRow({ l, onToggle }: { l: Layer; onToggle?: (id: string, v: boolean) => void }) {
  const [on, setOn] = useState(l.visible ?? true);
  const swatch: CSSProperties = l.outline
    ? { background: 'none', boxShadow: `inset 0 0 0 1.5px ${l.color ?? 'var(--map-parcel-line)'}` }
    : { backgroundColor: l.color ?? 'var(--map-building)' };
  return (
    <div className="ul-layer">
      <span className={l.hatch ? 'ul-swatch ul-hatch' : 'ul-swatch'} style={swatch} />
      <span className="ul-grow">
        {l.label} {l.noData && <span className="ul-muted">No data</span>}
      </span>
      <Toggle
        aria-label={l.label}
        checked={on}
        onChange={(v) => {
          setOn(v);
          onToggle?.(l.id, v);
        }}
      />
    </div>
  );
}
