import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {projectRoot,repositoryMode,repositoryEnvironment} from '../repo-env.mjs';
import {loadBundle,installBundle,verifyBundle} from './bundle.mjs';
const root=projectRoot(),require=createRequire(resolve(root,'apps/web/package.json'));
const command=process.argv[2];
if(!['check','install','verify'].includes(command)||process.argv.length!==3)throw Error('Use pnpm data:uttam:check, data:uttam:install, or data:uttam:verify');
let pool,s3;
try{
  const bundle=await loadBundle(resolve(root,'data-bundles/uttam-nagar'));
  if(command==='check')console.log(`PASS Uttam Nagar bundle: ${bundle.manifest.areas.length} areas, ${bundle.manifest.tables.reduce((n,t)=>n+t.rows,0)} rows, ${bundle.manifest.objects.length} original files; all checksums valid.`);
  else{
    if(!repositoryMode())throw Error('This dataset installer requires REPO_DATA=true in the project .env. It never selects or replaces a linked database.');
    const env=repositoryEnvironment(),{Pool}=require('pg'),sdk=require('@aws-sdk/client-s3');
    pool=new Pool({connectionString:env.DATABASE_URL,connectionTimeoutMillis:5000});
    s3=new sdk.S3Client({endpoint:env.S3_ENDPOINT,region:env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:env.S3_ACCESS_KEY,secretAccessKey:env.S3_SECRET_KEY}});
    const client=await pool.connect();
    try{
      const result=command==='install'?await installBundle(client,s3,sdk,env,bundle):await verifyBundle(client,s3,sdk,env,bundle);
      console.log(result.alreadyInstalled?'Already installed. Local changes preserved; no records overwritten.':'PASS Saved Uttam Nagar data and original files verified.');
      console.log(JSON.stringify(result,null,2));
      console.log('Open http://127.0.0.1:3000/delhi after pnpm start.');
    }finally{client.release();}
  }
}catch(error){console.error(error.code==='ECONNREFUSED'?'Database unavailable. Start Docker Desktop and run pnpm repo:init first.':error.message);process.exitCode=1;}
finally{await pool?.end();s3?.destroy();}
