import { repositoryMode } from './repo-env.mjs';
try {
  const response = await fetch('http://127.0.0.1:3000/api/v1/health', { signal: AbortSignal.timeout(4000) });
  const body = await response.json();
  const expected = repositoryMode() ? 'repository' : 'linked';
  if ((body.dataMode || 'linked') !== expected) {
    console.error('The web app is running in another data mode. Stop its terminal with Ctrl+C, then run pnpm demo again. Both datasets are preserved.');
    process.exitCode = 2;
  } else process.exitCode = body.ok === true ? 0 : 1;
} catch { process.exitCode = 1; }
