/** Unchanged official public page. Outputs hashes/counts only, never contact details. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { redactDerivative, redactDocumentViews, redactPrivateText } from '../../../apps/web/lib/server/usp/ingest/redact';
import { callNous } from '../../../apps/web/lib/server/officer-ai-provider';
const file=process.argv[2];assert(file);
const bytes=await readFile(file),hash=(input:Uint8Array|string)=>createHash('sha256').update(input).digest('hex');
assert.equal(hash(bytes),'9e89cc4b8633f2156e6518ef5db9e5dc3e480e498e0c0cebb47f1edced4b690f');
const parser=`import sys,json
from html.parser import HTMLParser
class Visible(HTMLParser):
 def __init__(self): super().__init__(); self.depth=0; self.parts=[]
 def handle_starttag(self,tag,attrs):
  if tag in ['script','style']: self.depth+=1
 def handle_endtag(self,tag):
  if tag in ['script','style']: self.depth=max(0,self.depth-1)
 def handle_data(self,data):
  if not self.depth and data.strip(): self.parts.append(data)
v=Visible();v.feed(sys.stdin.read());print(json.dumps(v.parts))`;
const nodes=JSON.parse(execFileSync('python3',['-c',parser],{input:bytes,encoding:'utf8',maxBuffer:2*1024*1024})) as string[];
const contacts=nodes.filter(node=>/\[at\]/i.test(node));
assert.equal(contacts.length,1,'Pinned official page must contain its published obfuscated contact');
const text=contacts[0],redacted=redactPrivateText(text);
assert(redacted.includes('[redacted email]'),'Official contact must be masked');assert(!redacted.includes('[at]'));
assert.equal(redactPrivateText(redacted),redacted);
assert.equal(redactDocumentViews({parts:[{text}]}).parts[0].text,redacted);
assert(!JSON.stringify(redactDerivative({questions:[text]})).includes('[at]'));
process.env.ULPIN_ALLOW_NON_INDIA_PROVIDER='1';delete process.env.ULPIN_RELEASE_PROFILE;process.env.NOUS_API_KEY='transport-control-token';
let fakeRequests=0;
const result=await callNous('control',[{role:'user',content:text}],(async(_url,init)=>{
  fakeRequests++;assert(!String(init?.body).includes('[at]'),'Provider-bound contact leaked');
  return Response.json({choices:[{message:{content:JSON.stringify({candidates:[],questions:[text]})}}],upstreamEcho:text});
}) as typeof fetch);
assert(!JSON.stringify(result).includes('[at]'),'Returned/persistable provider derivative leaked');
assert.equal(hash(await readFile(file)),hash(bytes));
console.log(JSON.stringify({status:'PASSED',sourceUrl:'https://www.data.gov.in/connect-with-us/',sourceSha256:hash(bytes),sourceBytes:bytes.length,
  provenance:'Official OGD public contact page; unchanged HTML. Published institutional contact only, no private identity record.',
  permission:'Page visibly carries Government Open Data License - India notice; no training/testing of a model, live egress or source republication.',
  visibleNodes:nodes.length,officialContactNodes:contacts.length,boundaries:['text','historic-preview','response','provider-request','persistable-provider-output'],fakeTransportRequests:fakeRequests,physicalProviderRequests:0,
  unqualified:['Aadhaar real positive/negative','VID','PAN','Indian mobile','free-prose names','image visual PII','EXIF-bearing official image']}));
