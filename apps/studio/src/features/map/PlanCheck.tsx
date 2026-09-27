import { useEffect, useRef, useState } from 'react';
import type { MultiPolygon } from '@ulpin/scene';
import { Button } from '@ulpin/ui';
import styles from './PlanCheck.module.css';

export interface MapPlanCheck {
  areaId: string;
  classification: 'Illustrative';
  scenario: 'conflicts' | 'match';
  officialApproval: false;
  checked: number;
  total: number;
  skipped: { buildingId: string; reason: string }[];
  plan: MultiPolygon;
  findings: { buildingId: string; name: string; outside: MultiPolygon; outsideAreaM2: number; heightM: number }[];
  outsideAreaM2: number;
  bounds: [number, number, number, number];
  method: string;
  limitation: string;
}

/** User-authorized simulation, isolated from recorded findings and official source geometry. */
export function PlanCheck({ areaId, result, onResult }: { areaId: string; result: MapPlanCheck | null; onResult: (value: MapPlanCheck | null) => void }) {
  const [scenario, setScenario] = useState(result?.scenario ?? 'conflicts');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function compare() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null); onResult(null);
    try {
      const response = await fetch(`/api/demo/areas/${encodeURIComponent(areaId)}/plan-check?scenario=${scenario}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Comparison failed');
      if (data.areaId !== areaId || data.classification !== 'Illustrative' || data.officialApproval !== false) throw new Error('Invalid simulation response');
      onResult(data);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Comparison failed');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className={styles.panel} aria-label="Area plan check">
    <select aria-label="Plan scenario" value={scenario} disabled={busy} onChange={e => { setScenario(e.target.value as 'conflicts' | 'match'); onResult(null); setError(null); }}>
      <option value="conflicts">Simulated plan</option>
      <option value="match">Matching plan</option>
    </select>
    <div className={styles.actions}>
      <Button variant="primary" disabled={busy} onClick={() => void compare()}>{busy ? 'Comparing…' : 'Compare map'}</Button>
      {result ? <Button variant="ghost" onClick={() => onResult(null)}>Clear</Button> : null}
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </section>;
}
