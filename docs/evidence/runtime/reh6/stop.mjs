import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { containers, demoDoctor, run, runtime, save, serving } from './audit.mjs';

// REH6 stopped at its Docker start: Docker Desktop's backend crashed on a stale socket and offered Reset. This writes
// the start receipt (process names and the backend log's crash lines, words only) and the closing demo doctor,
// compared with the first one in commit and process ids. Nothing is clicked, started, stopped or removed here.
// The dialog was seen open at 23:44 IST with five Docker Desktop and two backend processes (tasklist).
const before = JSON.parse(readFileSync('before-docker-down.json', 'utf8')).baseline;
const log = `${process.env.LOCALAPPDATA}/Docker/log/host/com.docker.backend.exe.log`;
const lines = readFileSync(log, 'utf8').split(/\r?\n/).map((line, index) => ({ line: index + 1, text: line }))
  .filter(({ text }) => text.startsWith('[2026-10-17T18:1')
    && /backend cancelling|backend crashed|"actions"|"action":"Quit"|marlin stopped/.test(text))
  .map(({ line, text }) => ({ line, text: text.replace(/C:\/Users\/[^/]+\//g, '%USERPROFILE%/').slice(0, 330) }));
const tasks = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout.split(/\r?\n/)
  .filter(row => /docker/i.test(row)).map(row => row.split('","').slice(0, 2).join(' ').replace(/"/g, ''));
save('docker-start.json', {
  at: new Date().toISOString(),
  started: { command: '%LOCALAPPDATA%/Programs/DockerDesktop/Docker Desktop.exe (once)',
    atLocal: '2026-10-17 23:40:44 +05:30' },
  waited: 'docker ps polled about 3.5 minutes: the engine pipe dockerDesktopLinuxEngine never appeared',
  engine: run('docker ps', serving, 20000),
  dockerProcessesAtThisRead: tasks,
  backendLog: { file: '%LOCALAPPDATA%/Docker/log/host/com.docker.backend.exe.log', crashLines: lines },
  dialog: { title: 'An unexpected error occurred', actions: ['Quit', 'Reset to factory defaults'],
    clickedByThisRun: 'nothing',
    closed: 'Quit was chosen at 18:14:45Z (23:44:45 IST), not by this run; Reset was not chosen (crash lines)' },
  stopRule: 'The task: if Docker crashes on stale sockets or offers Reset to factory defaults, never Reset; stop.',
});
const after = demoDoctor();
after.matchesFirstInCommitAndProcessIds = after.commit === before.commit
  && JSON.stringify(after.machine.processes) === JSON.stringify(before.machine.processes);
after.rehearsalContainers = containers(runtime);
save('demo-final.json', after);
console.log(JSON.stringify({ crashLines: lines.length, tasks, exit: after.doctor.exit, commit: after.commit,
  processes: after.machine.processes, health: after.health, same: after.matchesFirstInCommitAndProcessIds,
  tail: after.doctor.output.slice(-6) }, null, 1));
