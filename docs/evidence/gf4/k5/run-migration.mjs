import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readDemo, safeEnvironment, redact } from '../../../../scripts/platform/demo-config.mjs';

// The K4a runner (docs/evidence/gf1/k4a/run-migration.mjs) for K5: the established private configuration
// helper supplies the demo environment; credentials are never inspected or emitted.
const env = readDemo();
try {
  const output = execFileSync(process.execPath, ['--require', resolve('scripts/platform/isolated-env.cjs'),
    '--import', 'tsx', resolve('docs/evidence/gf4/k5/apply-migration.ts')], {
    env: safeEnvironment(env), timeout: 30000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(redact(output.trim(), env));
} catch (error) {
  console.error(redact(String(error.stderr ?? 'Registered migration runner failed.'), env));
  process.exitCode = 1;
}
