import { readdirSync } from 'node:fs';
import { containers, run, save, evidence } from './audit.mjs';

// REH7 Part 0: the machine booted at 2026-10-18 13:30:17 IST and Docker Desktop was not running; its run folder held
// four stale socket entries. Before starting it once, both socket folders were renamed aside in one step (nothing
// deleted), as REH6 did. Names only; nothing in either folder was opened.
const local = process.env.LOCALAPPDATA.split(String.fromCharCode(92)).join('/');
save('docker-recovery.json', {
  at: new Date().toISOString(),
  bootedLocal: '2026-10-18 13:30:17 +05:30',
  dockerProcessesBefore: 'none (tasklist: only the Windows service wslservice.exe)',
  renamedAside: ['%LOCALAPPDATA%/Docker/run -> run-stale-reh7-20261018',
    '%LOCALAPPDATA%/docker-secrets-engine -> docker-secrets-engine.saved-reh7-20261018'],
  staleEntriesByName: readdirSync(`${local}/Docker/run-stale-reh7-20261018`).sort(),
  started: { command: '%LOCALAPPDATA%/Programs/DockerDesktop/Docker Desktop.exe (once)',
    atUtc: '2026-10-18T08:04:29Z' },
  engineAnsweredWithinSeconds: 2,
  resetChosen: false,
  engine: run('docker ps --format "{{.Names}} {{.State}}"', evidence, 20000),
  volumes: run('docker volume ls --format "{{.Name}}"', evidence, 20000).output,
  containers: { 'ulpin-demo': containers('ulpin-demo'), 'ulpin-reh-02': containers('ulpin-reh-02') },
});
