import { validateSettings, type DeploymentSettings } from './access.js';
import { exactKeys, isRecord } from './access-policy.js';
import { readCloudflareList } from './cloudflare-list.js';

export type RecoveryTarget={accountId:string;workerId:string;workerName:'ajou-study-hub-recovery-test';productionUrl:string};
type Target={accountId:string;workerId:string;workerName:string;productionUrl:string};
const emptySource='export default {fetch(){return new Response("recovery-test");}};';
function fail():never{throw Error('Endpoint recovery could not be verified');}

/** All response bodies and the entire operation have hard bounds. There are no retries. */
function client(request:typeof fetch,token:string){
 if(!token||/[\r\n]/.test(token))fail();
 const signal=AbortSignal.timeout(60_000);
 async function read(url:string,init:RequestInit):Promise<{response:Response;text:string;bytes:Buffer}>{
  const response=await request(url,{...init,redirect:'error',signal});
  if(response.redirected||response.status>=300&&response.status<400||response.headers.has('location'))fail();
  const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>1024*1024))fail();
  const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>1024*1024)fail();chunks.push(chunk.value);}}finally{await reader.cancel();}
  const bytes=Buffer.concat(chunks);return {response,bytes,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
 }
 async function api(path:string,method='GET',body?:unknown){
  const {response,text}=await read('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)fail();const envelope:unknown=JSON.parse(text);
  if(!isRecord(envelope)||envelope.success!==true||!Array.isArray(envelope.errors)||envelope.errors.length||!Object.hasOwn(envelope,'result'))fail();
  return envelope;
 }
 return {api,async source(path:string){
  const r=await read('https://api.cloudflare.com/client/v4'+path,{headers:{Authorization:'Bearer '+token}});
  if(!r.response.ok||r.response.headers.get('content-type')!=='application/javascript'||r.response.headers.get('content-disposition')!=='attachment; filename="index.js"')fail();
  return r.bytes;
 },
  // Never pass API headers, tokens, cookies, or credentials to a Worker.
  probe:(url:string)=>read(url,{method:'GET',credentials:'omit',cache:'no-store'})};
}
function validateTarget(target:Target):void{
 if(!/^[a-f0-9]{32}$/.test(target.accountId)||typeof target.workerId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(target.workerId)||target.workerId===target.workerName)fail();
 const u=new URL(target.productionUrl);
 if(u.origin!==target.productionUrl||u.protocol!=='https:'||u.username||u.password||u.port||!new RegExp('^'+target.workerName+'\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.workers\\.dev$').test(u.hostname))fail();
}
type Client=ReturnType<typeof client>;
const script=(t:Target)=>`/accounts/${t.accountId}/workers/scripts/${t.workerName}`;
async function inspect(t:Target,c:Client,enabled:boolean):Promise<void>{
 const base=`/accounts/${t.accountId}`;
 const workers=await readCloudflareList(c.api,base+'/workers/workers');
 const matching=workers.filter(w=>w.name===t.workerName);
 if(matching.length!==1||matching[0]!.id!==t.workerId)fail();
 const worker=(await c.api(base+'/workers/workers/'+encodeURIComponent(t.workerId))).result;
 if(!isRecord(worker)||worker.id!==t.workerId||worker.name!==t.workerName||!isRecord(worker.references)||!Array.isArray(worker.references.domains)||worker.references.domains.length)fail();
 const sub=(await c.api(script(t)+'/subdomain')).result;
 if(!isRecord(sub)||sub.enabled!==enabled||sub.previews_enabled!==false)fail();
 const account=(await c.api(base+'/workers/subdomain')).result;
 if(!isRecord(account)||typeof account.subdomain!=='string'||t.productionUrl!==`https://${t.workerName}.${account.subdomain}.workers.dev`)fail();
 const zones=await readCloudflareList(c.api,'/zones?account.id='+t.accountId);
 for(const zone of zones){
  if(typeof zone.id!=='string'||!/^[a-f0-9]{32}$/.test(zone.id))fail();
  const routes=await readCloudflareList(c.api,'/zones/'+zone.id+'/workers/routes','single');
  if(routes.some(r=>r.script===t.workerName))fail();
 }
}
async function observeDisabled(t:Target,c:Client):Promise<void>{
 await inspect(t,c,false);
 const probe=await c.probe(t.productionUrl);
 // A login/denial page, generic 404, network failure or timeout is not withdrawal proof.
 if(probe.response.status!==404||!/^error code: 1003\s*$/.test(probe.text))fail();
}
async function empty(t:Target,c:Client):Promise<void>{
 const settings=(await c.api(script(t)+'/settings')).result;
 if(!isRecord(settings)||!Array.isArray(settings.bindings)||settings.bindings.length||Object.hasOwn(settings,'assets'))fail();
 if(!(await c.source(script(t))).equals(Buffer.from(emptySource,'utf8')))fail();
 const probe=await c.probe(t.productionUrl);if(probe.response.status!==200||probe.text!=='recovery-test')fail();
}
/** Production has no restore operation. Caller must supply the separately approved immutable ID. */
export async function disableEndpoint(settings:DeploymentSettings,expectedWorkerId:string,request:typeof fetch,token:string):Promise<void>{
 try{
  validateSettings(settings);if(settings.previewUrls.length)fail();
  const t:Target={accountId:settings.accountId,workerName:settings.workerName,productionUrl:settings.productionUrl,workerId:expectedWorkerId};validateTarget(t);
  const c=client(request,token);await inspect(t,c,true);
  await c.api(script(t)+'/subdomain','POST',{enabled:false,previews_enabled:false});await observeDisabled(t,c);
 }catch{fail();}
}
/** Rehearsal intentionally supports only an exact, material-free source. Multipart/unknown formats block. */
export async function rehearseRecovery(target:RecoveryTarget,request:typeof fetch,token:string):Promise<{disabledConfirmed:boolean;restoredConfirmed:boolean}>{
 try{
  exactKeys(target,['accountId','workerId','workerName','productionUrl']);if(target.workerName!=='ajou-study-hub-recovery-test')fail();
  const t=structuredClone(target);validateTarget(t);const c=client(request,token);
  await inspect(t,c,true);await empty(t,c);
  await c.api(script(t)+'/subdomain','POST',{enabled:false,previews_enabled:false});await observeDisabled(t,c);
  // Never restore in finally: any uncertain disable result requires operator investigation.
  await c.api(script(t)+'/subdomain','POST',{enabled:true,previews_enabled:false});await inspect(t,c,true);await empty(t,c);
  return {disabledConfirmed:true,restoredConfirmed:true};
 }catch{fail();}
}
