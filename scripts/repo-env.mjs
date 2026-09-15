import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';

export function projectRoot(start = process.cwd()) {
  let dir = resolve(start);
  while (true) {
    const file = resolve(dir, 'package.json');
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).name === '3d-ulpin') return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Run this command inside the 3d-ulpin repository.');
    dir = parent;
  }
}
export function baseEnvironment(root = projectRoot()) {
  const file = resolve(root, '.env');
  return { ...(existsSync(file) ? parse(readFileSync(file)) : {}), ...process.env };
}
export function repositoryMode(value = baseEnvironment().REPO_DATA) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('REPO_DATA must be true or false.');
}
export function repositoryEnvironment(create = false, root = projectRoot()) {
  const file = resolve(root, '.runtime/repo-data.env');
  if (!existsSync(file)) {
    if (!create) throw new Error('Repository data is not initialized. Run pnpm repo:init first.');
    const secret = () => randomBytes(24).toString('hex');
    const password = secret();
    const env = {
      POSTGRES_DB: 'ulpin_repo', POSTGRES_USER: 'ulpin', POSTGRES_PASSWORD: password,
      DATABASE_URL: `postgresql://ulpin:${password}@127.0.0.1:15433/ulpin_repo`,
      POSTGRES_PORT: '15433', S3_PORT: '19010', S3_CONSOLE_PORT: '19011', REDIS_PORT: '16380', GEO_PORT: '18001',
      S3_ENDPOINT: 'http://127.0.0.1:19010', S3_ACCESS_KEY: 'ulpinrepo', S3_SECRET_KEY: secret(),
      S3_BUCKET: 'ulpin-repo', S3_REGION: 'us-east-1',
      GEO_URL: 'http://127.0.0.1:18001', GEO_SERVICE_TOKEN: secret(), REDIS_URL: 'redis://127.0.0.1:16380/0',
      COMPOSE_PROJECT_NAME: 'ulpin-repo',
    };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  }
  const stored = parse(readFileSync(file));
  const expected = { POSTGRES_DB: 'ulpin_repo', POSTGRES_PORT: '15433', S3_BUCKET: 'ulpin-repo', S3_ENDPOINT: 'http://127.0.0.1:19010', GEO_URL: 'http://127.0.0.1:18001', REDIS_URL: 'redis://127.0.0.1:16380/0', COMPOSE_PROJECT_NAME: 'ulpin-repo', S3_PORT: '19010', S3_CONSOLE_PORT: '19011', REDIS_PORT: '16380', GEO_PORT: '18001' };
  for (const [key, value] of Object.entries(expected)) {
    if (stored[key] !== value) throw new Error(`Repository environment has an unexpected ${key}; refusing to select a potentially shared service.`);
  }
  for (const key of ['POSTGRES_PASSWORD', 'POSTGRES_USER', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'GEO_SERVICE_TOKEN']) {
    if (!stored[key]) throw new Error(`Repository environment is missing ${key}.`);
  }
  const database = new URL(stored.DATABASE_URL);
  if (database.hostname !== '127.0.0.1' || database.port !== '15433' || database.pathname !== '/ulpin_repo' || decodeURIComponent(database.password) !== stored.POSTGRES_PASSWORD) {
    throw new Error('Repository database URL does not match the isolated database.');
  }
  return stored;
}
export function applyRepositoryEnvironment() {
  if (repositoryMode()) Object.assign(process.env, repositoryEnvironment());
}
