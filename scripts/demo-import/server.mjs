/** Standalone, loopback-only transport for the explicitly enabled hosted demonstration. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { studioDemoImport } from './plugin.mjs';

if(process.env.ULPIN_HOSTED_DEMO!=='1'||process.env.ULPIN_DEMO_IMPORT!=='1')throw new Error('Hosted demo must be explicitly enabled.');
const port=Number(process.env.ULPIN_DEMO_PORT??3190);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid demo port.');
const middleware=[];
const server=createServer(async(req,res)=>{
  const host=req.headers.host;
  if(host!==`127.0.0.1:${port}`&&host!==`localhost:${port}`){res.writeHead(403);res.end('Forbidden');return;}
  if(req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403);res.end('Forbidden');return;}
  if(req.method==='GET'&&req.url==='/healthz'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"ok":true,"profile":"hosted-demo"}');return;
  }
  if(req.method==='GET'&&req.url==='/api/demo/bootstrap'){
    try{
      const bytes=await readFile(process.env.ULPIN_DEMO_BOOTSTRAP);
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(bytes);
    }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end('{"message":"Hosted datasets are not prepared"}');}
    return;
  }
  let index=0;
  const next=()=>{const fn=middleware[index++];if(fn){Promise.resolve(fn(req,res,next)).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});}else{res.writeHead(404,{'Content-Type':'application/json'});res.end('{"message":"Not found"}');}};
  next();
});
server.requestTimeout=120_000;
await studioDemoImport().configureServer({middlewares:{use(fn){middleware.push(fn);}},httpServer:server});
server.listen(port,'127.0.0.1',()=>console.log(`Hosted demo transport ready on 127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();server.closeAllConnections();});
