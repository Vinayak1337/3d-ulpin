// R9: REH9's migrate.mjs for the demo. The two commands of scripts/platform/demo.mjs migrate() (not exported), run
// from the demo's serving checkout at the roll commit, after both native processes stopped, with the demo's own
// settings read in this process by the product's readDemo and never printed. Around them, the API's own structural
// admission check (database-readiness.ts at the roll commit, read only) names what each step had to add and
// what is still missing after. Additive steps only (IF NOT EXISTS, or a widened check); no seed, no create, no
// reset. Output is redacted.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [root, name] = process.argv.slice(2);
if (name !== 'ulpin-demo') throw new Error('R9 migrates ulpin-demo only.');
const config = await import(pathToFileURL(join(root, 'scripts/platform/demo-config.mjs')));
const env = config.readDemo(name);
const preload = join(root, 'scripts/platform/isolated-env.cjs');
const readiness = join(dirname(fileURLToPath(import.meta.url)), 'readiness.ts');
function execute(file, args, childEnv) {
  try {
    return execFileSync(file, args, { cwd: root, env: config.safeEnvironment(childEnv), windowsHide: true,
      timeout: 300000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const text = String(error.stderr || error.stdout || '').slice(-6000);
    throw new Error(`failed (${error.status ?? 'timeout'}): ${config.redact(text, env)}`);
  }
}
const check = when => console.log(`readiness ${when}: ${config.redact(execute(process.execPath,
  ['--require', preload, '--import', 'tsx', readiness, root], env), env)}`);
console.log(`profile ${env.ULPIN_PROFILE}; project ${env.COMPOSE_PROJECT_NAME}; root ${root}`);
check('before');
console.log(config.redact(execute('cmd.exe', ['/d', '/s', '/c', 'pnpm db:migrate'],
  { ...env, NODE_OPTIONS: `--require "${preload.replaceAll('\\', '/')}"` }), env));
console.log(config.redact(execute(process.execPath, ['--require', preload, '--import', 'tsx',
  join(root, 'scripts/platform/demo-schema.ts')], env), env));
check('after');
