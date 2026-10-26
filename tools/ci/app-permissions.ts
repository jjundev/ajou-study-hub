import { createPrivateKey, sign } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verificationProject } from '../verification-project.js';
import { writeReport } from '../content/report.js';

type Obj=Record<string,unknown>;
type Role={role:'reader'|'dispatch'|'ledger';appId:number;installationId:number;repositories:string[];permissions:Record<string,string>};
const account='jjundev',origin='https://api.github.com';
const roles:Role[]=[
 {role:'reader',appId:5478307,installationId:175423301,repositories:['jjundev/ajou-nonhoesil','jjundev/ajou-life-science','jjundev/ajou-electronic-circuits-2','jjundev/ajou-jagual','jjundev/ajou-ml-basics'],permissions:{contents:'read',metadata:'read'}},
 {role:'dispatch',appId:5478852,installationId:175430013,repositories:['jjundev/ajou-study-hub'],permissions:{actions:'write',metadata:'read'}},
 {role:'ledger',appId:5478953,installationId:175431663,repositories:['jjundev/ajou-study-hub-state'],permissions:{contents:'write',metadata:'read'}},
];
type RoleProof={role:Role['role'];account:string;appId:number;slug:string;installationId:number;requestedRepositories:string[];requestedPermissions:Record<string,string>;observedRepositories:string[];observedPermissions:Record<string,string>|null;expiresAt:string|null;exchangeOutcome:'not-attempted'|'unknown'|'issued';identityVerified:boolean;scopeVerified:boolean;revokeStatus:number|null;revokedProbeStatus:number|null;verified:boolean};
export type AppPermissionsReport={version:1;checkedAt:string;verified:false;rolesVerified:boolean;stateActionsDisabled:false;code:string;roles:RoleProof[];limitations:string[]};
const record=(v:unknown):v is Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function fail():never{throw Error('GitHub App permission proof remains unverified');}
function exactPermissions(v:unknown,expected:Record<string,string>):boolean{
 return record(v)&&Object.keys(v).length===Object.keys(expected).length&&Object.entries(expected).every(([k,value])=>v[k]===value);
}
function exactNames(v:unknown,expected:string[]):boolean{
 return Array.isArray(v)&&v.length===expected.length&&new Set(v).size===v.length&&v.every(name=>typeof name==='string'&&expected.includes(name));
}
const slug=(r:Role)=>`ajou-study-hub-${r.role}-jjundev`;
async function readReceipt(root:string,r:Role):Promise<void>{
 const local=resolve(root,'.local'),path=resolve(local,`github-${r.role}-app.json`);
 for(const p of [local,path])if((await lstat(p)).isSymbolicLink()||await realpath(p)!==p)fail();
 const file=await open(path,'r');
 try{
  const stat=await file.stat();if(!stat.isFile()||stat.size>16384)fail();
  const bytes=Buffer.alloc(16385);let size=0;
  for(;;){const chunk=await file.read(bytes,size,bytes.length-size,null);size+=chunk.bytesRead;if(size>16384)fail();if(!chunk.bytesRead)break;}
  const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
  // Only the authoritative public projection is trusted. Receipt UI observations
  // (including historical token-test flags) cannot establish a live API proof.
  if(!record(value)||value.version!==1||value.account!==account||value.appId!==r.appId||value.installationId!==r.installationId||value.slug!==slug(r)||value.repositorySelection!=='selected'||!exactNames(value.repositories,r.repositories)||!exactPermissions(value.permissions,r.permissions)||value.keyStore!==`.local/github-${r.role}-key.dpapi`)fail();
 }finally{await file.close();}
}
function jwt(pem:string,r:Role):string{
 const key=createPrivateKey(pem);if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)fail();
 const now=Math.floor(Date.now()/1000),encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:now-60,exp:now+540,iss:String(r.appId)});
 return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url');
}
type Reply={status:number;safe:boolean;value:unknown;link:string|null};
/** Each role has its own bounded budget, including reserved cleanup requests. */
function api(request:typeof fetch,r:Role){
 let count=0;
 return async(path:string,credential:string,method='GET',body?:unknown):Promise<Reply>=>{
  const url=new URL(origin+path);
  const allowed=method==='GET'&&(path==='/app'||path===`/app/installations/${r.installationId}`||/^\/installation\/repositories\?per_page=100&page=[1-5]$/.test(path))||method==='POST'&&path===`/app/installations/${r.installationId}/access_tokens`||method==='DELETE'&&path==='/installation/token';
  if(!allowed||url.origin!==origin||url.username||url.password||url.hash||++count>12)fail();
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   return await Promise.race([
    (async()=>{
     const response=await request(url.href,{method,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',Authorization:'Bearer '+credential,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual',credentials:'omit',signal:controller.signal});
     const length=response.headers.get('content-length');
     const safe=!response.redirected&&!(response.status>=300&&response.status<400)&&!response.headers.has('location')&&(length===null||/^\d+$/.test(length)&&Number(length)<=1048576)&&(!response.url||new URL(response.url).origin===origin);
     const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
     if(reader)try{
      for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1048576)fail();chunks.push(part.value);}
     }finally{void reader.cancel().catch(()=>{});}
     let value:unknown=null;
     try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{/* Never expose a raw response or parser error. */}
     return {status:response.status,safe,value,link:response.headers.get('link')};
    })(),
    new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('GitHub App permission proof remains unverified'));},10000);}),
   ]);
  }catch{fail();}finally{clearTimeout(timer);controller.abort();}
 };
}
function validReply(reply:Reply,status:number):Obj{
 if(!reply.safe||reply.status!==status||!record(reply.value))fail();return reply.value;
}
function repositoryNames(value:unknown,allowed:string[]):string[]{
 if(!Array.isArray(value))fail();
 const names=value.map(repo=>{
  if(!record(repo)||typeof repo.full_name!=='string'||!allowed.includes(repo.full_name)||repo.name!==repo.full_name.split('/')[1]||!record(repo.owner)||repo.owner.login!==account||repo.private!==true||!Number.isSafeInteger(repo.id)||Number(repo.id)<=0)fail();
  return repo.full_name;
 });
 if(new Set(names).size!==names.length)fail();return names;
}
/** Validate pagination links, then reconstruct the next URL without forwarding data. */
function hasNext(link:string|null,page:number):boolean{
 if(link===null)return false;
 if(link.length>4096)fail();let next=false;const rels=new Set<string>();
 for(const entry of link.split(',')){
  const match=/^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(entry);if(!match||rels.has(match[2]))fail();rels.add(match[2]);
  const url=new URL(match[1]),p=Number(url.searchParams.get('page'));
  if(url.origin!==origin||url.pathname!=='/installation/repositories'||url.username||url.password||url.hash||url.searchParams.size!==2||url.searchParams.get('per_page')!=='100'||!Number.isInteger(p)||p<1||p>5)fail();
  if(match[2]==='next'){if(p!==page+1)fail();next=true;}
 }
 return next;
}
async function proveRole(r:Role,pem:string,request:typeof fetch):Promise<RoleProof>{
 const proof:RoleProof={role:r.role,account,appId:r.appId,slug:slug(r),installationId:r.installationId,requestedRepositories:[...r.repositories],requestedPermissions:{...r.permissions},observedRepositories:[],observedPermissions:null,expiresAt:null,exchangeOutcome:'not-attempted',identityVerified:false,scopeVerified:false,revokeStatus:null,revokedProbeStatus:null,verified:false};
 const call=api(request,r);let token:string|undefined;
 try{
  const auth=jwt(pem,r),app=validReply(await call('/app',auth),200);
  if(app.id!==r.appId||app.slug!==slug(r)||!record(app.owner)||app.owner.login!==account||!exactPermissions(app.permissions,r.permissions))fail();
  const installation=validReply(await call(`/app/installations/${r.installationId}`,auth),200);
  if(installation.id!==r.installationId||installation.app_id!==r.appId||!record(installation.account)||installation.account.login!==account||installation.repository_selection!=='selected'||installation.suspended_at!==null||!exactPermissions(installation.permissions,r.permissions))fail();
  proof.identityVerified=true;
  proof.exchangeOutcome='unknown';
  const exchanged=await call(`/app/installations/${r.installationId}/access_tokens`,auth,'POST',{repositories:r.repositories.map(name=>name.split('/')[1]),permissions:r.permissions});
  // Recover a usable issued credential before validating status, permissions,
  // expiry or redirect headers so all recoverable outcomes reach the finally.
  if(record(exchanged.value)&&typeof exchanged.value.token==='string'&&/^[\x21-\x7e]{1,8192}$/.test(exchanged.value.token)){
   token=exchanged.value.token;proof.exchangeOutcome='issued';
  }
  const value=validReply(exchanged,201);if(!token)fail();
  if(!exactPermissions(value.permissions,r.permissions)||value.repository_selection!=='selected')fail();
  proof.observedPermissions={...r.permissions};
  const expires=typeof value.expires_at==='string'?Date.parse(value.expires_at):NaN,now=Date.now();
  if(!Number.isFinite(expires)||expires<=now||expires>now+3600000)fail();
  proof.expiresAt=new Date(expires).toISOString();
  if(!exactNames(repositoryNames(value.repositories,r.repositories),r.repositories))fail();
  const names:string[]=[];let completed=false;
  for(let page=1;page<=5;page++){
   const reply=await call(`/installation/repositories?per_page=100&page=${page}`,token),inventory=validReply(reply,200);
   if(inventory.total_count!==r.repositories.length)fail();
   const listed=repositoryNames(inventory.repositories,r.repositories);
   if(!listed.length||listed.length>100)fail();names.push(...listed);
   if(new Set(names).size!==names.length||names.length>r.repositories.length)fail();
   const next=hasNext(reply.link,page);
   if(!next){if(!exactNames(names,r.repositories))fail();completed=true;break;}
   if(names.length>=r.repositories.length)fail();
  }
  if(!completed)fail();
  proof.observedRepositories=r.repositories.filter(name=>names.includes(name));proof.scopeVerified=true;
 }catch{/* Intentionally discard raw response/parser/network/key errors. */}
 finally{
  if(token){
   try{const result=await call('/installation/token',token,'DELETE');if(result.safe)proof.revokeStatus=result.status;}catch{/* Always attempt the independent revoked-token probe. */}
   try{const result=await call('/installation/repositories?per_page=100&page=1',token);if(result.safe)proof.revokedProbeStatus=result.status;}catch{/* No retry; an unknown outcome cannot verify revocation. */}
  }
  token=undefined;
 }
 proof.verified=proof.identityVerified&&proof.scopeVerified&&proof.revokeStatus===204&&proof.revokedProbeStatus===401;
 return proof;
}

/** Local-only role evidence. This deliberately cannot issue AutomationReadiness. */
export async function runAppPermissionsOperator(args:string[],env:NodeJS.ProcessEnv,request:typeof fetch=fetch):Promise<AppPermissionsReport>{
 const keys=roles.map(r=>{const name=`STUDY_HUB_${r.role.toUpperCase()}_PRIVATE_KEY`,key=env[name];delete env[name];return key;});
 if(env.CI!==undefined||args.length||keys.some(key=>!key||key.length>32768))fail();
 const root=await verificationProject(),path=resolve(root,'.reports/github-app-permissions.json');
 const report:AppPermissionsReport={version:1,checkedAt:new Date().toISOString(),verified:false,rolesVerified:false,stateActionsDisabled:false,code:'GITHUB_APP_PERMISSIONS_RUNNING',roles:[],limitations:[
  'State Actions disabled cannot be inspected with these minimal App permissions: GET /repos/jjundev/ajou-study-hub-state/actions/permissions requires Administration:read. Separate authorized read-only evidence is required.',
  'Token metadata and exact private repository inventory prove role scope; no write probes or repository/ref changes are performed. App registration visibility and other account installations are not attested.',
  'Expiry is checked against the documented one-hour bound; natural expiration is not awaited. Unknown exchange outcomes may leave an unrecoverable token until provider expiry; exchanges are never retried.',
  'This role-only report cannot establish readiness.permissions: separate ledger nonforce/read-back and Cloudflare proofs remain required.',
 ]};
 await writeReport(report,path,[resolve(root,'dist')],root);
 try{
  for(const r of roles)await readReceipt(root,r);
  // Validate every key before issuing even the first token.
  for(let i=0;i<roles.length;i++)jwt(keys[i]!,roles[i]);
  for(let i=0;i<roles.length;i++)report.roles.push(await proveRole(roles[i],keys[i]!,request));
  report.rolesVerified=report.roles.length===3&&report.roles.every(r=>r.verified);
 }catch{/* Safe, fixed report only; no raw error, body or credentials. */}
 finally{keys.fill(undefined);report.checkedAt=new Date().toISOString();report.code=report.rolesVerified?'APP_ROLES_VERIFIED_STATE_ACTIONS_UNVERIFIED':'GITHUB_APP_PERMISSIONS_UNVERIFIED';await writeReport(report,path,[resolve(root,'dist')],root);}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 runAppPermissionsOperator(process.argv.slice(2),process.env).then(report=>{process.stdout.write(report.rolesVerified?'App roles verified; state Actions and overall permissions remain unverified.\n':'GitHub App permission proof remains unverified.\n');process.exitCode=report.verified?0:1;}).catch(()=>{process.stderr.write('GitHub App permission proof remains unverified.\n');process.exitCode=1;});
}
