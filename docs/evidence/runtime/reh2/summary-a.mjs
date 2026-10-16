import { readFileSync } from 'node:fs';
import { demo, evidence, gpu, machine, save, serving } from './audit.mjs';

// Part A in one place: each step's exit and seconds, the doctor's PASS/FAIL lines, the GPU compute processes
// before and after start against the rehearsal's own processes, and the demo's two doctors.
const read = name => JSON.parse(readFileSync(`${evidence}/${name}`, 'utf8'));
const pids = receipt => receipt.output.slice(1).map(line => Number(line.split(',')[0])).filter(Boolean);
const before = read('before.json');
const steps = [1, 2, 3, 4, 5, 6].map(n => {
  const value = read(`step-${n}.json`);
  return { step: n, command: value.receipt.command.join(''), exit: value.receipt.exit,
    seconds: value.receipt.seconds };
});
const doctor = read('step-6.json').receipt.output;
const rehearsal = machine(serving).processes;
const now = gpu();
const gpuBefore = pids(before.gpu);
const gpuAfterStart = pids(read('step-5.json').gpu);
const gpuNow = pids(now);
const own = rehearsal.map(row => row.pid);
const demoAfter = read('demo-part-a.json');
save('part-a.json', {
  at: new Date().toISOString(), commit: before.stagingCommit, steps,
  doctor: { pass: doctor.filter(line => line.startsWith('PASS')).length,
    fail: doctor.filter(line => line.startsWith('FAIL')), last: doctor.at(-1) },
  partBCanRun: doctor.every(line => !line.startsWith('FAIL')),
  rehearsalProcesses: rehearsal, rehearsalListeners: read('step-6.json').state.listeners.map(row => row.LocalPort),
  gpu: { reading: 'nvidia-smi compute apps; WDDM reports used memory N/A, so the test is by process id',
    before: gpuBefore.length, afterStart: gpuAfterStart.length, now: gpuNow.length,
    newSinceBefore: gpuNow.filter(pid => !gpuBefore.includes(pid)),
    rehearsalPidsHoldingGpu: own.filter(pid => gpuAfterStart.includes(pid) || gpuNow.includes(pid)) },
  demo: { checkout: demo, commitBefore: before.baseline.commit, commitAfter: demoAfter.commit,
    processesBefore: before.baseline.machine.processes, processesAfter: demoAfter.machine.processes,
    doctorExitBefore: before.baseline.doctor.exit, doctorExitAfter: demoAfter.doctor.exit,
    healthAfter: demoAfter.health, matchesBaseline: demoAfter.matchesBaseline },
});
console.log(readFileSync(`${evidence}/part-a.json`, 'utf8'));
