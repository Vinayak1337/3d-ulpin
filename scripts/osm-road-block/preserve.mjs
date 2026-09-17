import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {repositoryEnvironment,projectRoot} from '../repo-env.mjs';
const root=projectRoot(),require=createRequire(resolve(root,'apps/web/package.json'));
const {Pool}=require('pg'),env=repositoryEnvironment(false,root);
const pool=new Pool({connectionString:env.DATABASE_URL});
const file=resolve(root,'.runtime/uttam-nagar-before-rows.json');
const hash=x=>createHash('sha256').update(x).digest('hex');
try{
  const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys' ORDER BY tablename")).rows;
  const observed={at:new Date().toISOString(),tables:[]};
  for(const {tablename:name} of tables){
    const rows=(await pool.query(`SELECT row_to_json(t)::text AS body FROM public."${name}" t`)).rows.map(r=>hash(r.body)).sort();
    observed.tables.push({name,rows});
  }
  if(process.argv[2]==='before'){
    if(existsSync(file))throw Error('Baseline exists. Refusing to replace preservation evidence.');
    await writeFile(file,JSON.stringify(observed));
    console.log('Saved immutable before-import row fingerprints:',observed.tables.reduce((n,t)=>n+t.rows.length,0),'rows');
  }else{
    const before=JSON.parse(await readFile(file,'utf8'));
    const changes=[];
    for(const old of before.tables){
      const now=observed.tables.find(t=>t.name===old.name);const counts=new Map();
      for(const h of now?.rows||[])counts.set(h,(counts.get(h)||0)+1);
      let missing=0;for(const h of old.rows){if(!counts.get(h))missing++;else counts.set(h,counts.get(h)-1);}
      changes.push({table:old.name,before:old.rows.length,after:now?.rows.length||0,missingOrChangedOriginalRows:missing});
    }
    const report={result:changes.every(t=>t.missingOrChangedOriginalRows===0)?'PASS':'FAIL',baselineAt:before.at,verifiedAt:observed.at,tables:changes};
    await writeFile(resolve(root,'.runtime/uttam-nagar-preservation.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    if(report.result==='FAIL')process.exitCode=1;
  }
}finally{await pool.end();}
