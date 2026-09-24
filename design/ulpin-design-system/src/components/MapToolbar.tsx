import { useState } from 'react';
import { Icon, type IconName } from './Icon';
import { SegmentedControl } from './SegmentedControl';

export type MapTool = 'select' | 'measure-distance' | 'measure-area' | 'section' | 'impact' | 'underground';

const TOOLS: Array<{ id: MapTool; label: string; icon: IconName }> = [
  { id: 'select', label: 'Select', icon: 'crosshair' },
  { id: 'measure-distance', label: 'Measure distance', icon: 'ruler' },
  { id: 'measure-area', label: 'Measure area', icon: 'selection-background' },
  { id: 'section', label: 'Section cut', icon: 'scissors' },
  { id: 'impact', label: 'Impact screening', icon: 'shovel' },
  { id: 'underground', label: 'Underground', icon: 'stack' },
];

export interface MapToolbarProps {
  /** Active tool (controlled). */
  tool?: MapTool;
  defaultTool?: MapTool;
  onToolChange?: (tool: MapTool) => void;
  /** Tools the current role may not use are left out. */
  hiddenTools?: MapTool[];
  /** 3D or 2D. */
  view?: '3D' | '2D';
  onViewChange?: (view: '3D' | '2D') => void;
  /** Model (lit massing) or Volumes (exact prisms). Omit to hide the toggle. */
  render?: 'Model' | 'Volumes';
  onRenderChange?: (render: 'Model' | 'Volumes') => void;
  onResetCamera?: () => void;
}

/**
 * The floating top-left tool cluster: scene tools, then view toggles, then Reset camera. Icon-only tools carry `aria-label` and a tooltip.
 */
export function MapToolbar({
  tool,
  defaultTool = 'select',
  onToolChange,
  hiddenTools = [],
  view = '3D',
  onViewChange,
  render,
  onRenderChange,
  onResetCamera,
}: MapToolbarProps) {
  const [inner, setInner] = useState<MapTool>(defaultTool);
  const current = tool ?? inner;
  return (
    <div className="ul-maptools" role="toolbar" aria-label="Map tools">
      {TOOLS.filter((t) => !hiddenTools.includes(t.id)).map((t) => (
        <button
          key={t.id}
          type="button"
          className="ul-tool"
          aria-pressed={t.id === current}
          aria-label={t.label}
          title={t.label}
          onClick={() => {
            setInner(t.id);
            onToolChange?.(t.id);
          }}
        >
          <Icon name={t.icon} />
        </button>
      ))}
      <span className="ul-tool-sep" />
      <SegmentedControl
        aria-label="View"
        options={[
          { value: '3D', label: '3D' },
          { value: '2D', label: '2D' },
        ]}
        defaultValue={view}
        onChange={(v) => onViewChange?.(v as '3D' | '2D')}
      />
      {render && (
        <>
          <span className="ul-tool-sep" />
          <SegmentedControl
            aria-label="Render"
            options={[
              { value: 'Model', label: 'Model' },
              { value: 'Volumes', label: 'Volumes' },
            ]}
            defaultValue={render}
            onChange={(v) => onRenderChange?.(v as 'Model' | 'Volumes')}
          />
        </>
      )}
      <span className="ul-tool-sep" />
      <button type="button" className="ul-tool" aria-label="Reset camera" title="Reset camera" onClick={onResetCamera}>
        <Icon name="arrow-counter-clockwise" />
      </button>
    </div>
  );
}
