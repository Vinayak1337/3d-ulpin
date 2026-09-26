export interface LegendItem {
  label: string;
  count?: number;
  color?: string;
  hatch?: boolean;
  line?: 'solid' | 'dash' | 'dot';
}
export interface LegendSection {
  title: string;
  items: LegendItem[];
}

/** Bottom-left legend for the active Colour by mode only. Unknown always has its own hatched entry. */
export function Legend({ sections }: { sections: LegendSection[] }) {
  return (
    <div className="ul-legend ul-float" role="group" aria-label="Legend">
      {sections.map((section) => (
        <div key={section.title} className="ul-legend__section">
          <span className="ul-legend__title">{section.title}</span>
          {section.items.map((item) => (
            <span key={item.label} className="ul-legend__item">
              {item.line ? (
                <span className={`ul-legend__line${item.line === 'solid' ? '' : ` ul-legend__line--${item.line}`}`} />
              ) : (
                <span className={`ul-swatch${item.hatch ? ' ul-hatch' : ''}`} style={{ backgroundColor: item.color }} />
              )}
              {item.label}{item.count === undefined ? '' : ` · ${item.count}`}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
