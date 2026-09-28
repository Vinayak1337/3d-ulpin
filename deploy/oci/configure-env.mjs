/** Server-owned settings only. Existing infrastructure/provider credentials stay untouched. */
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {userInfo} from 'node:os';
const root='/opt/ulpin/shared';
await mkdir(root,{recursive:true,mode:0o700});
const update=async(name,values)=>{
  const path=`${root}/${name}`;let lines=[];try{lines=(await readFile(path,'utf8')).split('\n')}catch{}
  const managed=new Set(Object.keys(values));
  lines=lines.filter(line=>line&&(!line.includes('=')||!managed.has(line.slice(0,line.indexOf('=')))));
  lines.push(...Object.entries(values).map(([key,value])=>`${key}=${value}`));
  await writeFile(path,lines.join('\n')+'\n',{mode:0o600});
};
const user=userInfo();
await update('runtime.env',{API_PORT:3188,API_ALLOWED_ORIGINS:'http://127.0.0.1:3188',ULPIN_LOCAL_OPERATOR_SUBJECT:`local-os:${user.uid}:${user.username}`,ULPIN_LOOPBACK_PORTS:'3188',ULPIN_MODEL_GATEWAY_ENABLED:'0'});
await update('demo.env',{ULPIN_HOSTED_DEMO:'1',ULPIN_DEMO_IMPORT:'1',ULPIN_DEMO_PORT:3190,ULPIN_DEMO_MAX_JOBS:24,ULPIN_DEMO_DIR:`${root}/nyc-jobs`,ULPIN_DEMO_BOOTSTRAP:`${root}/bootstrap.json`,ULPIN_DEMO_PYTHON:`${root}/demo-venv/bin/python`});
console.log('Hosted runtime settings prepared; infrastructure credentials preserved; paid provider dispatch disabled.');
