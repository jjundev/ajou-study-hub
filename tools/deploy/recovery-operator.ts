import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verificationProject } from '../verification-project.js';
import { validateReportPath, writeReport } from '../content/report.js';
import { validateSettings, type DeploymentSettings } from './access.js';
import { assertAutomationAllowed, validateBaseline, type AutomationBaseline } from './access-baseline.js';
import { digest, exactKeys, isRecord, readAccessInspection, type AccessInspection } from './access-policy.js';
import { readCloudflareList } from './cloudflare-list.js';
import { rehearseRecovery, type RecoveryTarget } from './emergency-disable.js';
import { assertRecoverySource, recoverySource as source, recoverySourceLimit } from './recovery-source.js';

const name='ajou-study-hub-recovery-test';
const phases=['create-intent','owned','upload-intent','enable-intent','rehearsal-intent','staged-resume-intent','verified','unverified'] as const;
type Receipt={version:1;baselineHash:string;target:RecoveryTarget|null;phase:typeof phases[number];checkedAt:string;productionUnchanged:boolean;disabledConfirmed:boolean;restoredConfirmed:boolean};
function fail():never{throw Error('Recovery operation remains unverified');}
const identity=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
async function readJson(path:string):Promise<unknown>{
 const file=await open(path,'r');try{
  const stat=await file.stat();if(!stat.isFile()||stat.size>16384)fail();
  const buffer=Buffer.alloc(16385);let size=0;
  for(;;){const r=await file.read(buffer,size,buffer.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead;if(size>16384)fail();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)));
 }finally{await file.close();}
}
function owned(value:unknown,settings:DeploymentSettings,baseline:AutomationBaseline,url:string):asserts value is Receipt{
 exactKeys(value,['version','baselineHash','target','phase','checkedAt','productionUnchanged','disabledConfirmed','restoredConfirmed']);
 exactKeys(value.target,['accountId','workerId','workerName','productionUrl']);const t=value.target;
 if(value.version!==1||value.baselineHash!==digest(baseline)||
  !phases.includes(value.phase as Receipt['phase'])||value.phase==='create-intent'||
  typeof value.checkedAt!=='string'||!Number.isFinite(Date.parse(value.checkedAt))||new Date(value.checkedAt).toISOString()!==value.checkedAt||
  ![value.productionUnchanged,value.disabledConfirmed,value.restoredConfirmed].every(v=>typeof v==='boolean')||
  t.accountId!==settings.accountId||t.workerName!==name||!identity(t.workerId)||
  t.workerId===baseline.workerId||t.workerId===name||t.productionUrl!==url)fail();
}
/** Per-attempt HTTP boundary: bounded responses, fixed write allowlist, no retries or credential forwarding. */
function http(request:typeof fetch,account:string,url:string){
 const signal=AbortSignal.timeout(120_000),base=`/accounts/${account}`,script=base+'/workers/scripts/'+name;let count=0;
 const bounded:typeof fetch=async(input,init)=>{
  const u=new URL(String(input)),method=init?.method??'GET',path=u.pathname.replace(/^\/client\/v4/,'');
  if(++count>1000||u.username||u.password)fail();
  if(u.origin==='https://api.cloudflare.com'){
   if(!u.pathname.startsWith('/client/v4/')||method!=='GET'&&!(method==='POST'&&(path===base+'/workers/workers'||path===script+'/subdomain')||method==='PUT'&&path===script))fail();
  }else if(u.origin!==url||method!=='GET'||new Headers(init?.headers).has('Authorization')||new Headers(init?.headers).has('Cookie')||init?.credentials!=='omit')fail();
  const r=await request(input,{...init,redirect:'error',signal,credentials:'omit'});
  if(r.redirected||r.status>=300&&r.status<400||r.headers.has('location'))fail();
  const limit=method==='GET'&&path===script?recoverySourceLimit:1048576;
  const length=r.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))fail();
  const reader=r.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader)try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>limit)fail();chunks.push(chunk.value);}}finally{await reader.cancel();}
  return new Response(Buffer.concat(chunks),{status:r.status,headers:r.headers});
 };
 return {bounded,base,script};
}
/** Explicit local operator command. It cannot create an AutomationReadiness or touch production writes. */
export async function runRecoveryOperator(args:string[],env:NodeJS.ProcessEnv,request:typeof fetch=fetch):Promise<void>{
 if(env.CI||args.length!==1||!['--create-empty-rehearsal','--verify-existing-rehearsal','--resume-owned-staged-rehearsal'].includes(args[0]!)||!env.CLOUDFLARE_API_TOKEN||/[\r\n]/.test(env.CLOUDFLARE_API_TOKEN))fail();
 const token=env.CLOUDFLARE_API_TOKEN,root=await verificationProject(),dist=resolve(root,'dist'),receiptPath=resolve(root,'.reports/recovery-target.json'),resultPath=resolve(root,'.reports/recovery-result.json'),lockPath=resolve(root,'.reports/recovery-operation.lock');
 await mkdir(resolve(root,'.reports'),{recursive:true});
 for(const path of [receiptPath,resultPath,lockPath])await validateReportPath(path,[dist],root);
 const lock=await open(lockPath,'wx',0o600);
 let receipt:Receipt|undefined,before:AccessInspection|undefined,settings:DeploymentSettings|undefined,baseline:AutomationBaseline|undefined,attempted=false,success=false,productionUnchanged=false;
 const persist=async()=>{if(receipt)await writeReport(receipt,receiptPath,[dist],root);};
 try{
  await writeReport({verified:false,productionUnchanged:false,code:'RECOVERY_RUNNING'},resultPath,[dist],root);
  const settingsValue=await readJson(resolve(root,'.local/deployment.json'));validateSettings(settingsValue);settings=settingsValue;
  const baselineValue=await readJson(resolve(root,'.reports/automation-baseline.json'));validateBaseline(baselineValue);baseline=baselineValue;
  if(settings.previewUrls.length)fail();
  const host=new URL(settings.productionUrl).hostname,match=/^ajou-study-hub\.([a-z0-9-]+)\.workers\.dev$/.exec(host);if(!match)fail();
  const url=`https://${name}.${match[1]}.workers.dev`,c=http(request,settings.accountId,url);request=c.bounded;
  before=await readAccessInspection(settings,{fetch:request,token});assertAutomationAllowed(settings,before,baseline);
  const api=async(path:string,method='GET',body?:unknown)=>{
   const multipart=body instanceof FormData;
   const response=await request('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+token,...(body===undefined||multipart?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:multipart?body:JSON.stringify(body)})});
   if(!response.ok)fail();const value:unknown=await response.json();if(!isRecord(value)||value.success!==true||!Object.hasOwn(value,'errors')||value.errors!==null&&(!Array.isArray(value.errors)||value.errors.length)||!Object.hasOwn(value,'result'))fail();return value;
  };
  const verifyOwned=async(target:RecoveryTarget,enabled:boolean,withSource:boolean)=>{
   const workers=await readCloudflareList(api,c.base+'/workers/workers'),matching=workers.filter(w=>w.name===name);
   if(matching.length!==1||matching[0].id!==target.workerId)fail();
   const worker=(await api(c.base+'/workers/workers/'+encodeURIComponent(target.workerId))).result;
   if(!isRecord(worker)||worker.id!==target.workerId||worker.name!==name||worker.logpush!==false||
    !isRecord(worker.observability)||worker.observability.enabled!==false||
    !Array.isArray(worker.tail_consumers)||worker.tail_consumers.length||
    !isRecord(worker.references)||!Array.isArray(worker.references.domains)||
    Object.values(worker.references).some(v=>!Array.isArray(v)||v.length))fail();
   const sub=(await api(c.script+'/subdomain')).result;if(!isRecord(sub)||sub.enabled!==enabled||sub.previews_enabled!==false)fail();
   const subdomain=(await api(c.base+'/workers/subdomain')).result;if(!isRecord(subdomain)||url!==`https://${name}.${subdomain.subdomain}.workers.dev`)fail();
   const zones=await readCloudflareList(api,'/zones?account.id='+target.accountId);
   for(const zone of zones){if(typeof zone.id!=='string'||!/^[a-f0-9]{32}$/.test(zone.id))fail();if((await readCloudflareList(api,'/zones/'+zone.id+'/workers/routes','single')).some(r=>r.script===name))fail();}
   if(withSource){
    const config=(await api(c.script+'/settings')).result;
    // The immutable Worker read above must explicitly prove observability disabled in this check.
    // Settings may omit the field, but a present value never overrides that proof.
    if(!isRecord(config)||config.compatibility_date!=='2026-10-24'||
     !Array.isArray(config.bindings)||config.bindings.length||Object.hasOwn(config,'assets')||config.logpush!==false||
     Object.hasOwn(config,'observability')&&(!isRecord(config.observability)||config.observability.enabled!==false)||
     !Array.isArray(config.tail_consumers)||config.tail_consumers.length||
     config.compatibility_flags!==undefined&&(!Array.isArray(config.compatibility_flags)||config.compatibility_flags.length))fail();
    const raw=await request('https://api.cloudflare.com/client/v4'+c.script,{headers:{Authorization:'Bearer '+token}});
    await assertRecoverySource(raw);
   }
  };
  if(args[0]==='--create-empty-rehearsal'){
   // Any existing receipt, even an unknown creation outcome, blocks a second creation.
   try{const existing=await open(receiptPath,'r');await existing.close();fail();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if((await readCloudflareList(api,c.base+'/workers/workers')).some(w=>w.name===name))fail();
   receipt={version:1,baselineHash:digest(baseline),target:null,phase:'create-intent',checkedAt:new Date().toISOString(),productionUnchanged:false,disabledConfirmed:false,restoredConfirmed:false};await persist();attempted=true;
   const created=(await api(c.base+'/workers/workers','POST',{name,logpush:false,observability:{enabled:false},subdomain:{enabled:false,previews_enabled:false},tail_consumers:[]})).result;
   if(!isRecord(created)||created.name!==name||!identity(created.id)||created.id===baseline.workerId||created.id===name)fail();
   receipt.target={accountId:settings.accountId,workerId:created.id,workerName:name,productionUrl:url};receipt.phase='owned';await persist();
   await verifyOwned(receipt.target,false,false);
   const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:'index.js',compatibility_date:'2026-10-24',bindings:[],logpush:false,observability:{enabled:false},tail_consumers:[]})],{type:'application/json'}));form.set('index.js',new Blob([source],{type:'application/javascript+module'}),'index.js');
   receipt.phase='upload-intent';await persist();await api(c.script,'PUT',form);await verifyOwned(receipt.target,false,true);
   receipt.phase='enable-intent';await persist();await api(c.script+'/subdomain','POST',{enabled:true,previews_enabled:false});
  }else{
   const value=await readJson(receiptPath);owned(value,settings,baseline,url);
   if(args[0]==='--resume-owned-staged-rehearsal'){
    // Only the legacy failed-staging shape is eligible for this explicit reconciliation.
    if(value.phase!=='unverified'||value.productionUnchanged!==true||value.disabledConfirmed!==false||value.restoredConfirmed!==false)fail();
    receipt=value;attempted=true;
    await verifyOwned(receipt.target!,false,true);
    // Retain this non-resumable marker through every subsequent failure or unknown write.
    receipt.phase='staged-resume-intent';receipt.productionUnchanged=false;await persist();
    await api(c.script+'/subdomain','POST',{enabled:true,previews_enabled:false});
   }else{
    receipt=value;attempted=true;
    receipt.disabledConfirmed=false;receipt.restoredConfirmed=false;receipt.productionUnchanged=false;receipt.phase='rehearsal-intent';await persist();
    // Existing verification remains enabled-only, with no stage repair or initial enable.
    await verifyOwned(receipt.target!,true,true);
   }
  }
  if(receipt.phase!=='staged-resume-intent')receipt.phase='rehearsal-intent';
  receipt.disabledConfirmed=false;receipt.restoredConfirmed=false;receipt.productionUnchanged=false;await persist();
  const result=await rehearseRecovery(receipt.target!,request,token);
  await verifyOwned(receipt.target!,true,true);
  receipt.disabledConfirmed=result.disabledConfirmed;receipt.restoredConfirmed=result.restoredConfirmed;success=true;
 }catch{success=false;}
 finally{
  if(before&&settings&&baseline)try{const after=await readAccessInspection(settings,{fetch:request,token});assertAutomationAllowed(settings,after,baseline);productionUnchanged=digest(after)===digest(before);}catch{productionUnchanged=false;}
  try{
   if(receipt&&attempted){
    if(success&&productionUnchanged)receipt.phase='verified';
    else if(!['enable-intent','rehearsal-intent','staged-resume-intent'].includes(receipt.phase))receipt.phase='unverified';
    receipt.productionUnchanged=productionUnchanged;receipt.checkedAt=new Date().toISOString();await persist();
   }
   await writeReport({verified:success&&productionUnchanged,productionUnchanged,code:success&&productionUnchanged?'RECOVERY_VERIFIED':'RECOVERY_UNVERIFIED'},resultPath,[dist],root);
  }finally{await lock.close();await unlink(lockPath);}
 }
 if(!success||!productionUnchanged)fail();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void runRecoveryOperator(process.argv.slice(2),process.env).then(()=>{console.log('Dedicated empty recovery rehearsal verified; automatic readiness remains separate');}).catch(()=>{console.error('Recovery operation remains unverified; inspect local safe receipt before any further action');process.exitCode=1;});
