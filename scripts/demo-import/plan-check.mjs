/** Isolated area-wide illustrative comparison. No registry, originals or job state are written. */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export async function compareSimulatedPlan(job, scenario) {
  if (job.state !== 'READY_FOR_REVIEW') throw new Error('Wait for the import to finish');
  if (!['conflicts', 'match'].includes(scenario)) throw new Error('Unknown simulation scenario');
  if (job.area.reference?.analysisCrs !== 'EPSG:32618') throw new Error('This simulation requires the NYC metre frame');
  const interpreter = process.env.ULPIN_DEMO_PYTHON ?? join(homedir(), '.codex/task-data/nyc-10013-multimodal/venv/bin/python');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(interpreter, ['-u', fileURLToPath(new URL('./plan-check.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Plan comparison timed out')); }, 20000);
    child.stdout.on('data', b => { output += b; if (output.length > 16_000_000) { child.kill(); reject(new Error('Comparison output too large')); } });
    child.stderr.on('data', b => { error = (error + b).slice(-1000); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); if (code !== 0) return reject(new Error(error || 'Plan comparison failed')); try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid comparison response')); } });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ features: job.features.filter(f => f.kind === 'building'), scenario }));
  });
  return {
    ...result, areaId: job.area.id, scenario, classification: 'Illustrative', officialApproval: false,
    reference: job.area.reference,
    sources: job.sources.filter(s => !s.format || s.format === 'geojson').map(s => ({ id: s.id, name: s.name, sha256: s.hash })),
    geometrySha256: createHash('sha256').update(JSON.stringify(job.features.filter(f => f.kind === 'building').map(f => ({ id: f.id, geometry: f.geometry })))).digest('hex'),
    method: scenario === 'match' ? 'Every plan footprint equals its source footprint' : 'Area-wide simulated plan: every 40th building (sorted by ID) clipped to 80% of its east-west extent; all other footprints match',
    limitation: 'Simulated area plan; not an official approval or a finding of encroachment. Compared against source-derived massing, not an independent as-built survey.',
  };
}
