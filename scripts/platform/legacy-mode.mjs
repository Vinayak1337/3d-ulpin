// Existing linked/repository modes; never initialize missing private configuration.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot, repositoryMode, repositoryEnvironment } from '../repo-env.mjs';
const repo = repositoryMode();
const file = resolve(projectRoot(), repo ? '.runtime/repo-data.env' : '.env');
if (!existsSync(file)) {
  console.error('Existing profile configuration is missing. Recover its original file; never generate a new password for existing volumes.');
  process.exit(1);
}
if (repo) repositoryEnvironment(false);
console.log(process.argv[2] === 'project' ? repo ? 'ulpin-repo' : 'ulpin' : file);
