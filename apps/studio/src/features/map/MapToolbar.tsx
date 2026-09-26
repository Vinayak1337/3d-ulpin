import { ArrowCounterClockwise, Cursor, Ruler, Scissors, Shovel } from '@phosphor-icons/react';
import { Icon } from '@ulpin/ui';
import type { SceneTool } from '@ulpin/scene';
import styles from './MapWorkspace.module.css';

/**
 * Tools that act on the map, and nothing else: Select, Measure (two points: distance, horizontal and
 * vertical), Section (horizontal cut through the selected building), Underground; then Reset view.
 */
export function MapToolbar({ tool, underground, canUnderground, canSection, onTool, onUnderground, onReset }: {
  tool: SceneTool; underground: boolean; canUnderground: boolean; canSection: boolean;
  onTool: (tool: SceneTool) => void; onUnderground: () => void; onReset: () => void;
}) {
  const btn = (pressed: boolean, label: string, icon: typeof Cursor, onClick: () => void, disabled = false, title = label) => (
    <button type="button" className="ul-tool" aria-pressed={pressed} aria-label={label} title={title} disabled={disabled} onClick={onClick}>
      <Icon icon={icon} />
    </button>
  );
  return (
    <div className={`ul-maptools ${styles.toolbar}`} role="toolbar" aria-label="Map tools">
      {btn(tool === 'select' && !underground, 'Select', Cursor, () => onTool('select'))}
      {btn(tool === 'measure', 'Measure', Ruler, () => onTool(tool === 'measure' ? 'select' : 'measure'), false, 'Measure: click two points')}
      {btn(tool === 'section', 'Section', Scissors, () => onTool(tool === 'section' ? 'select' : 'section'), !canSection, canSection ? 'Section: cut the building at a height' : 'Section: select a building first')}
      {btn(underground, 'Underground', Shovel, onUnderground, !canUnderground, canUnderground ? 'Underground' : 'Underground: select a building first')}
      <span className="ul-tool-sep" />
      {btn(false, 'Reset view', ArrowCounterClockwise, onReset)}
    </div>
  );
}
