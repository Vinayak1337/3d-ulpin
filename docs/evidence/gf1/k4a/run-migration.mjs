import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readDemo, safeEnvironment, redact } from '../../../../scripts/platform/demo-config.mjs';

// Consume the established private configuration helper; never inspect or emit credentials.
const env = readDemo();
try {
  const output = execFileSync(process.execPath, ['--require', resolve('scripts/platform/isolated-env.cjs'),
    '--import', 'tsx', resolve('docs/evidence/gf1/k4a/check-migration.ts')], {
    env: safeEnvironment(env), timeout: 30000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(redact(output.trim(), env));
} catch (error) {
  console.error(redact(String(error.stderr ?? 'Registered migration runner failed.'), env));
  process.exitCode = 1;
}
