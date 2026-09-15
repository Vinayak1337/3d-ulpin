import { resolve } from 'node:path';
import { projectRoot, repositoryMode, repositoryEnvironment } from './repo-env.mjs';
const repo = repositoryMode();
if (repo) repositoryEnvironment(true);
if (process.argv[2] === 'project') console.log(repo ? 'ulpin-repo' : 'ulpin');
else console.log(resolve(projectRoot(), repo ? '.runtime/repo-data.env' : '.env'));
