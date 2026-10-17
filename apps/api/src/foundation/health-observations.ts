import type { SchemaObject } from '@nestjs/swagger';

export type DependencyObservation =
  | { status: 'observed'; source: 'processor-readiness'; reason: null }
  | { status: 'unobserved'; source: 'processor-readiness'; reason: 'processor-unavailable' | 'invalid-readiness' };

type ProcessorReadiness = { ok: boolean; redis: boolean; worker: boolean };

export const dependencyObservationSchema: SchemaObject = {
  type: 'object', required: ['status', 'source', 'reason'], properties: {
    status: { type: 'string', enum: ['observed', 'unobserved'] },
    source: { type: 'string', enum: ['processor-readiness'], description: 'Reported by the processor readiness endpoint; no independent API probe.' },
    reason: { type: 'string', nullable: true, enum: ['processor-unavailable', 'invalid-readiness', null] },
  },
};

function validReadiness(value: unknown): value is ProcessorReadiness {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Partial<ProcessorReadiness>;
  return typeof body.ok === 'boolean' && typeof body.redis === 'boolean' && typeof body.worker === 'boolean'
    && body.ok === (body.redis && body.worker);
}

/** A failed/invalid processor probe cannot establish Redis or worker health. */
export function processorHealthObservations(probe: PromiseSettledResult<unknown>) {
  const readiness = probe.status === 'fulfilled' && validReadiness(probe.value) ? probe.value : null;
  const observation: DependencyObservation = readiness
    ? { status: 'observed', source: 'processor-readiness', reason: null }
    : { status: 'unobserved', source: 'processor-readiness',
      reason: probe.status === 'rejected' ? 'processor-unavailable' : 'invalid-readiness' };
  return {
    services: { processor: readiness !== null, redis: readiness?.redis === true, worker: readiness?.worker === true },
    serviceObservations: { redis: observation, worker: observation },
  };
}
