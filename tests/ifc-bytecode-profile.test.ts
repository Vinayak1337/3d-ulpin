import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,copyFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ifcConfig} from '../packages/server/src/modules/usp/ingestion/ifc-config';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Reviewer cache control adapted into a fresh private protocol scope. Never
// execute the inventory skeleton, alter shared caches or change retained sources.
const python='C:/Users/kvina/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const parent=process.env.ULPIN_IFC_CORRECTION_ROOT??'E:/BhuAayam-data/task-data/desktop-ifc-native/api-checks/ifc-02-corrections';
const available=process.platform==='win32'&&existsSync(python)&&existsSync(parent);
const fixtureScript=String.raw`
from pathlib import Path
import hashlib,json,sys,importlib.util,importlib._bootstrap_external as be
root,scope=Path(sys.argv[1]),Path(sys.argv[2])
ns={'__name__':'profile_control','__file__':str(root/'scripts/usp/ifc/profile.py')}
exec(compile((root/'scripts/usp/ifc/profile.py').read_bytes(),ns['__file__'],'exec'),ns)
runtime,environment=scope/'runtime',scope/'environment'
runtime.mkdir();site=environment/'Lib/site-packages';site.mkdir(parents=True)
for name in ns['RUNTIME_NAMES']:
 target=runtime/name
 if name in ('DLLs','Lib'):target.mkdir()
 else:target.write_bytes(b'inventory placeholder; never executed')
source=site/'pin_probe.py';source.write_bytes(b"value = 'PINNED_SOURCE'\n")
cache=Path(importlib.util.cache_from_source(str(source)));cache.parent.mkdir()
header=(int(source.stat().st_mtime),source.stat().st_size)
cache.write_bytes(be._code_to_timestamp_pyc(compile(source.read_bytes(),str(source),'exec'),*header))
forged=scope/'forged-cache.bin';forged.write_bytes(be._code_to_timestamp_pyc(compile("value = 'UNPINNED_CACHE'\n",str(source),'exec'),*header))
profile={'schemaVersion':'ifc-python-profile/2','platform':'windows-x86_64','cachePolicy':'verified_bytecode_read_no_write',
 'repositoryRoot':str(root),'python':str(runtime/'python.exe'),'environmentRoot':str(environment),'scratchRoot':str(scope),
 'files':ns['inventory'](runtime/'python.exe',environment)}
ns['verify'](profile)
path=scope/'profile.json';data=(json.dumps(profile,indent=2)+'\n').encode();path.write_bytes(data)
assert any(f['path'].endswith('.pyc') for f in profile['files'])
# A repository cache is also inventoried, including case variants on Windows.
repo=scope/'repository'
for name in ns['REPOSITORY_SOURCES']:
 target=repo/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((root/name).read_bytes())
before=ns['inventory'](runtime/'python.exe',environment,repo)
repo_cache=repo/'scripts/usp/ifc/__PYCACHE__/profile.cpython-312.pyc';repo_cache.parent.mkdir();repo_cache.write_bytes(forged.read_bytes())
after=ns['inventory'](runtime/'python.exe',environment,repo)
assert before!=after and any(f['path'].endswith('profile.cpython-312.pyc') for f in after)
print(json.dumps({'profile':str(path),'profileSha256':hashlib.sha256(data).hexdigest(),'cache':str(cache),'forged':str(forged),
 'source':str(source),'repositoryCacheInventoried':True}))
`;
const verifyScript=String.raw`
from pathlib import Path
import json,sys
root,profile=Path(sys.argv[1]),Path(sys.argv[2])
ns={'__name__':'profile_control','__file__':str(root/'scripts/usp/ifc/profile.py')}
exec(compile((root/'scripts/usp/ifc/profile.py').read_bytes(),ns['__file__'],'exec'),ns)
try:ns['verify'](json.loads(profile.read_bytes()))
except ValueError as error:assert str(error)=='profile_changed';print('CACHE_DRIFT_DENIED')
else:raise AssertionError('changed executable cache was accepted')
`;

test('parent config and wrapper profile reject changed executable cache before loading; old profiles stay frozen',{skip:!available},()=>{
  const root=new URL('../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),scope=mkdtempSync(join(parent,'cache-control-')),
    f=JSON.parse(execFileSync(python,['-I','-S','-B','-c',fixtureScript,root,scope],{encoding:'utf8'}));
  const names=['ULPIN_IFC_PROFILE','ULPIN_IFC_PROFILE_SHA256'],previous=names.map(n=>process.env[n]);
  process.env.ULPIN_IFC_PROFILE=f.profile;process.env.ULPIN_IFC_PROFILE_SHA256=f.profileSha256;
  try{
    const config=ifcConfig(),source=sha256(readFileSync(f.source)),pinned=readFileSync(f.cache);
    assert.equal(config.pins.profileSha256,f.profileSha256);assert.equal(f.repositoryCacheInventoried,true);
    copyFileSync(f.forged,f.cache);
    assert.throws(()=>ifcConfig(),(e:any)=>e.status===503&&e.code==='IFC_TOOL_CHANGED');
    assert.equal(execFileSync(python,['-I','-S','-B','-c',verifyScript,root,f.profile],{encoding:'utf8'}).trim(),'CACHE_DRIFT_DENIED');
    assert.equal(sha256(readFileSync(f.source)),source);writeFileSync(f.cache,pinned);assert.equal(ifcConfig().pins.profileSha256,f.profileSha256);
    const old=join(parent,'..','profile.json'),oldBytes=readFileSync(old);process.env.ULPIN_IFC_PROFILE=old;process.env.ULPIN_IFC_PROFILE_SHA256=sha256(oldBytes);
    assert.throws(()=>ifcConfig(),(e:any)=>e.status===503);assert.deepEqual(readFileSync(old),oldBytes);
    console.log(JSON.stringify({cacheControlScope:scope,sourceUnchanged:true,parentDeniedBeforeSpawn:true,wrapperDenied:true,oldProfileUnchanged:true}));
  }finally{names.forEach((n,i)=>{if(previous[i]===undefined)delete process.env[n];else process.env[n]=previous[i];});}
});

test('wrapper adapter makes the accepted CLI child refuse cache writes without editing CLI bytes',{skip:!available},()=>{
  const root=new URL('../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
  const script=String.raw`
from pathlib import Path
import sys,subprocess
root=Path(sys.argv[1]);ns={'__name__':'wrapper_control','__file__':str(root/'scripts/usp/ifc/server.py')}
exec(compile((root/'scripts/usp/ifc/server.py').read_bytes(),ns['__file__'],'exec'),ns)
child=ns['VerifiedCacheSubprocess'](sys.executable).Popen([sys.executable,'-I','-S','-c','import sys;print(sys.dont_write_bytecode)'],stdout=subprocess.PIPE)
out=child.communicate(timeout=5)[0];assert child.returncode==0 and out.strip()==b'True'
print('CHILD_CACHE_WRITES_DISABLED')
`;
  assert.equal(execFileSync(python,['-I','-S','-B','-c',script,root],{encoding:'utf8'}).trim(),'CHILD_CACHE_WRITES_DISABLED');
});
