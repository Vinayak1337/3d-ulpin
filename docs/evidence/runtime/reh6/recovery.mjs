import { readFileSync } from 'node:fs';
import { containers, demoDoctor, run, runtime, save, serving } from './audit.mjs';

// Part 0 of the REH6 resume: the lead's Docker recovery, recorded after it ran (steps and their words as printed),
// then the engine's containers and volumes by name and the demo's read-only doctor. Nothing is started here.
const reh5 = JSON.parse(readFileSync('../reh5/before.json', 'utf8'));
const volumes = run('docker volume ls --format "{{.Name}}"', serving).output.map(line => line.trim()).filter(Boolean);
const named = volumes.filter(name => !/^[a-f0-9]{64}$/.test(name)).sort();
const required = ['ulpin-demo', 'ulpin-reh-01', 'ulpin-reh-02']
  .flatMap(project => ['minio-data', 'postgres-data', 'redis-data'].map(volume => `${project}_${volume}`));
const doctor = demoDoctor();
save('docker-recovery.json', {
  at: new Date().toISOString(),
  steps: [
    { n: 1, atLocal: '2026-10-17T23:47:29+05:30', what: 'Get-Process Docker Desktop*, com.docker.*, docker',
      result: 'none running (Docker Desktop had exited after the earlier Quit): nothing to stop' },
    { n: 2, atLocal: '2026-10-17T23:47:38+05:30',
      what: 'one PowerShell command: Rename-Item %LOCALAPPDATA%/Docker/run to run-stale-20261017-2350 and '
        + '%LOCALAPPDATA%/docker-secrets-engine to docker-secrets-engine.saved-reh6-20261017',
      before: 'both sources present; neither target name present (no suffix needed)',
      result: 'run absent, run-stale-20261017-2350 present; docker-secrets-engine absent, '
        + 'docker-secrets-engine.saved-reh6-20261017 present. Nothing removed.' },
    { n: 3, atLocal: '2026-10-17T23:47:45+05:30', what: 'Start-Process Docker Desktop.exe once; poll docker ps',
      result: 'docker ps answered after 6.7 s; Docker Desktop, com.docker.backend and com.docker.build running' },
    { n: 4, what: 'docker ps by name; docker volume ls', result: 'below' },
  ],
  never: ['the dialog', 'Reset to factory defaults', 'wsl --unregister', 'deleting a folder or a .vhdx'],
  containers: { 'ulpin-demo': containers('ulpin-demo'), [runtime]: containers(runtime) },
  demoContainersAsReh5: JSON.stringify(containers('ulpin-demo').map(row => row.split(' ').slice(0, 3)))
    === JSON.stringify(reh5.baseline.containers.map(row => row.split(' ').slice(0, 3))),
  volumes: { count: volumes.length, countInReh5DemoDoctor: 23, anonymous: volumes.length - named.length, named,
    required, missing: required.filter(name => !named.includes(name)) },
  demoDoctorAfterPart0: doctor,
});
console.log(JSON.stringify({ volumes: volumes.length, missing: required.filter(n => !named.includes(n)),
  exit: doctor.doctor.exit, commit: doctor.commit, processes: doctor.machine.processes, health: doctor.health,
  fails: doctor.doctor.output.filter(line => line.startsWith('FAIL')) }, null, 1));
