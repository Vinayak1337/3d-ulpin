import test from 'node:test';
import assert from 'node:assert/strict';
import { processorHealthObservations } from '../src/foundation/health-observations';

test('unavailable or malformed processor readiness leaves dependency health unobserved', () => {
  const unavailable = processorHealthObservations({ status: 'rejected', reason: new Error('Processor unavailable') });
  assert.deepEqual(unavailable.services, { processor: false, redis: false, worker: false });
  assert.deepEqual(unavailable.serviceObservations, {
    redis: { status: 'unobserved', source: 'processor-readiness', reason: 'processor-unavailable' },
    worker: { status: 'unobserved', source: 'processor-readiness', reason: 'processor-unavailable' },
  });
  for (const value of [null, {}, { ok: true, redis: 'true', worker: true }, { ok: false, redis: true, worker: true }]) {
    const malformed = processorHealthObservations({ status: 'fulfilled', value });
    assert.deepEqual(malformed.services, unavailable.services);
    assert.deepEqual(malformed.serviceObservations, {
      redis: { status: 'unobserved', source: 'processor-readiness', reason: 'invalid-readiness' },
      worker: { status: 'unobserved', source: 'processor-readiness', reason: 'invalid-readiness' },
    });
  }
});

test('valid explicit negatives remain observed and keep separate dependency booleans', () => {
  for (const value of [{ ok: false, redis: false, worker: false }, { ok: false, redis: true, worker: false }]) {
    const result = processorHealthObservations({ status: 'fulfilled', value });
    assert.deepEqual(result.services, { processor: true, redis: value.redis, worker: value.worker });
    assert.deepEqual(result.serviceObservations, {
      redis: { status: 'observed', source: 'processor-readiness', reason: null },
      worker: { status: 'observed', source: 'processor-readiness', reason: null },
    });
    assert.equal(Object.values(result.services).every(Boolean), false);
  }
});

test('valid positive readiness remains observed and healthy', () => {
  const result = processorHealthObservations({ status: 'fulfilled', value: { ok: true, redis: true, worker: true } });
  assert.deepEqual(result.services, { processor: true, redis: true, worker: true });
  assert.deepEqual(result.serviceObservations, {
    redis: { status: 'observed', source: 'processor-readiness', reason: null },
    worker: { status: 'observed', source: 'processor-readiness', reason: null },
  });
  assert.equal(Object.values(result.services).every(Boolean), true);
});
