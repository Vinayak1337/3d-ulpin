import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {putOriginal,sha256,closeStorageClient} from '../packages/server/src/infrastructure/storage';
const require=createRequire(new URL('../packages/server/package.json',import.meta.url));
const {S3Client}=require('@aws-sdk/client-s3');
async function configured(work:()=>Promise<void>){
  const names=['S3_ENDPOINT','S3_ACCESS_KEY','S3_SECRET_KEY'],prior=names.map(name=>process.env[name]);
  for(const name of names)process.env[name]=name==='S3_ENDPOINT'?'http://127.0.0.1:1':'memory-only-control';
  try{await work();}finally{names.forEach((name,i)=>{if(prior[i]===undefined)delete process.env[name];else process.env[name]=prior[i];});}
}

test('opt-in immutable publication is cancellable, exact, and only replays a verified precondition',()=>configured(async()=>{
  const old=S3Client.prototype.send,data=Buffer.from('bounded technical storage control'),calls:any[]=[];
  const controller=new AbortController();let precondition=false,stored=data,putError:unknown;
  S3Client.prototype.send=async function(command:any,options:any){
    calls.push({command,options});if(options?.abortSignal?.aborted)throw options.abortSignal.reason;
    if(command.constructor.name==='PutObjectCommand'){
      assert.equal(command.input.IfNoneMatch,'*');assert.equal(command.input.Metadata.sha256,sha256(data));
      assert.equal(options.abortSignal,controller.signal);if(putError)throw putError;
      if(precondition)throw {$metadata:{httpStatusCode:412}};return {};
    }
    return {Body:Readable.from([stored]),ContentLength:stored.length,ETag:'technical-etag'};
  };
  try{
    await putOriginal('cityjson-validation/technical/control',data,'application/json',controller.signal);
    precondition=true;await putOriginal('cityjson-validation/technical/control',data,'application/json',controller.signal);
    stored=Buffer.from('wrong');await assert.rejects(()=>putOriginal('cityjson-validation/technical/control',data,'application/json',controller.signal),(e:any)=>e.status===422);
    stored=Buffer.from(data);stored[0]^=1;await assert.rejects(()=>putOriginal('cityjson-validation/technical/control',data,'application/json',controller.signal),(e:any)=>e.status===422);
    putError=new Error('technical network failure');const before=calls.length;
    await assert.rejects(()=>putOriginal('cityjson-validation/technical/control',data,'application/json',controller.signal),putError as Error);
    assert.equal(calls.length,before+1); // No readObject/prior-success fallback on arbitrary failure.
    controller.abort(new Error('technical cancel'));const cancelled=calls.length;
    await assert.rejects(()=>putOriginal('cityjson-validation/technical/control',data,'application/json',controller.signal),/technical cancel/);
    assert.equal(calls.length,cancelled+1);
  }finally{S3Client.prototype.send=old;closeStorageClient();}
}));

test('legacy no-signal verification/error behavior is unchanged',()=>configured(async()=>{
  const old=S3Client.prototype.send,data=Buffer.from('legacy technical control');let failure=false,read=0;
  S3Client.prototype.send=async function(command:any,options:any){
    assert.equal(options,undefined);
    if(command.constructor.name==='PutObjectCommand'){if(failure)throw {$metadata:{httpStatusCode:412}};return {};}
    return {Body:{transformToByteArray:async()=>{read++;return data;}}};
  };
  try{
    await putOriginal('sources/technical/legacy',data,'application/json');assert.equal(read,1);
    failure=true;await assert.rejects(()=>putOriginal('sources/technical/legacy',data,'application/json'));assert.equal(read,1);
  }finally{S3Client.prototype.send=old;closeStorageClient();}
}));
