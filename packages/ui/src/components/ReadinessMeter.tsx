export type ReadinessValue = number | 'unknown';
export interface ReadinessDimension {
  name: string;
  value: ReadinessValue;
  label?: string;
}

/** Readiness for one named task in its dimensions. Unknown is hatched and blocks an all-clear. No overall score. */
export function ReadinessMeter({ task, dimensions }: { task: string; dimensions: ReadinessDimension[] }) {
  return (
    <div className="ul-ready" role="group" aria-label={`Readiness for ${task}`}>
      <span className="ul-ready__task">Ready to {task.charAt(0).toLowerCase()}{task.slice(1)}</span>
      {dimensions.map((dimension) => (
        <div key={dimension.name} className="ul-ready__row">
          <span>{dimension.name}</span>
          <span className="ul-ready__bar" aria-hidden="true">
            {dimension.value === 'unknown'
              ? <span className="ul-ready__fill ul-ready__fill--unknown" />
              : <span className="ul-ready__fill" style={{ width: `${Math.round(dimension.value * 100)}%` }} />}
          </span>
          <span>{dimension.label ?? (dimension.value === 'unknown' ? 'Unknown' : dimension.value >= 1 ? 'Ready' : 'Not ready')}</span>
        </div>
      ))}
    </div>
  );
}
