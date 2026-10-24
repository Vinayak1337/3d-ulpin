// REH9: the two commands of scripts/platform/demo.mjs migrate() (not exported), run from the rehearsal's serving
// checkout at the roll commit with that rehearsal's own settings, read in this process by the product's readDemo
// for ulpin-reh-02 and never printed. The same wrapper R7 used for the demo, with the runtime named. Additive steps
// only (IF NOT EXISTS, or a widened check); no seed, no create, no reset. Output is redacted.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, name] = process.argv.slice(2);
if (name !== 'ulpin-reh-02') throw new Error('REH9 migrates ulpin-reh-02 only.');
const config = await import(pathToFileURL(join(root, 'scripts/platform/demo-config.mjs')));
const env = config.readDemo(name);
const preload = join(root, 'scripts/platform/isolated-env.cjs');
function execute(file, args, childEnv) {
  try {
    return execFileSync(file, args, { cwd: root, env: config.safeEnvironment(childEnv), windowsHide: true,
      timeout: 300000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const text = String(error.stderr || error.stdout || '').slice(-6000);
    throw new Error(`failed (${error.status ?? 'timeout'}): ${config.redact(text, env)}`);
  }
}
console.log(`profile ${env.ULPIN_PROFILE}; project ${env.COMPOSE_PROJECT_NAME}; root ${root}`);
console.log(config.redact(execute('cmd.exe', ['/d', '/s', '/c', 'pnpm db:migrate'],
  { ...env, NODE_OPTIONS: `--require "${preload.replaceAll('\\', '/')}"` }), env));
console.log(config.redact(execute(process.execPath, ['--require', preload, '--import', 'tsx',
  join(root, 'scripts/platform/demo-schema.ts')], env), env));
