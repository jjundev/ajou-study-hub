import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { verificationProject } from '../verification-project.js';
import { writeReport, type BuildReport } from '../content/report.js';
import { inventory } from './bootstrap.js';
import { readCloudflareList } from './cloudflare-list.js';
import { cloudflareReader, readWorkerTarget, type ReadOptions } from './worker-target.js';
export type { ReadOptions } from './worker-target.js';
import { assertReleaseAllowed, sentinelPaths } from './guard.js';
export type DeploymentSettings={accountId:string;workerName:string;allowedEmail:string;accessAppId:string;productionUrl:string;previewUrls:string[]};
export type AccessSnapshot={accountId:string;workerName:string;accessAppId:string;allowedEmails:string[];workerWide:boolean;hasBypass:boolean;hosts:string[];freePlan:boolean;fingerprint:string;authDomain:string;otpProviderId:string};
export type ProtectionEvidence={version:2;method:'independent-identity-policy-and-nondisclosure';ownerIdentityHash:string;otherIdentityHash:string;policyChecksHash:string;accountId:string;workerName:string;accessAppId:string;checkedAt:string;settingsFingerprint:string;policyFingerprint:string;hosts:string[];anonymousBlocked:boolean;otherAccountBlocked:boolean;ownerAllowed:boolean;sentinelHashes:Record<string,string>};
type Obj=Record<string,any>;
const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
function stable(v:any):string{return JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v);}
function fail():never{throw Error('Cloudflare Access configuration could not be verified');}
export function validateSettings(v:unknown):asserts v is DeploymentSettings {
 if(!object(v)||Object.keys(v).sort().join(',')!=='accessAppId,accountId,allowedEmail,previewUrls,productionUrl,workerName'||!/^[a-f0-9]{32}$/.test(v.accountId)||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(v.workerName)||v.workerName!=='ajou-study-hub'||typeof v.accessAppId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.accessAppId)||typeof v.allowedEmail!=='string'||!/^\S+@[^\s@]+\.[^\s@]+$/.test(v.allowedEmail)||!Array.isArray(v.previewUrls)) fail();
 const urls=[v.productionUrl,...v.previewUrls];
 for(const s of urls){if(typeof s!=='string')fail();let u:URL;try{u=new URL(s);}catch{fail();}if(u!.protocol!=='https:'||u!.username||u!.password||u!.port||u!.pathname!=='/'||u!.search||u!.hash||u!.origin!==s||!u!.hostname.endsWith('.workers.dev'))fail();}
 if(new Set(urls).size!==urls.length)fail();
}
export function settingsFingerprint(settings:DeploymentSettings):string {validateSettings(settings);return hash(stable({...settings,previewUrls:[...settings.previewUrls].sort()}));}
export type AccessReadData={worker:Obj;apps:Obj[];policies:Record<string,Obj[]>;idps:Obj[];hosts:string[];subscriptions:Obj[];organization:Obj;exposure?:{subdomain:Obj;accountSubdomain:Obj;routes:Obj[]}};
function teamOrigin(authDomain:unknown):string{
 if(typeof authDomain!=='string'||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(authDomain))fail();
 return 'https://'+authDomain;
}
export function assertFreeSubscriptions(value:unknown):asserts value is Obj[]{
 // Workers Free is the documented default, not a separate subscription entry.
 // A complete account inventory must contain only the observed non-trial Teams
 // Free plan. Unknown/paid plans (even with a zero current price) fail closed.
 if(!Array.isArray(value)||value.length!==1)fail();
 const s=value[0];
 if(!object(s)||s.state!=='Paid'||s.price!==0||s.currency!=='USD'||s.trial!==null||!object(s.rate_plan))fail();
 const plan=s.rate_plan;
 if(plan.id!=='teams_free'||plan.public_name!=='Teams Free Base'||plan.currency!=='USD'||plan.scope!=='account'||plan.externally_managed!==false||plan.is_contract!==false)fail();
}
/** Strict subset of official cloudflare-typescript SelfHostedApplication/Policy/Worker.
 * Unknown policy rules and all overlapping hostname/path/preview apps fail closed. */
export function normalizeAccess(settings:DeploymentSettings,data:AccessReadData):AccessSnapshot {
 validateSettings(settings);
 const {worker,apps,policies,idps,hosts,subscriptions,organization}=data;
 if(!object(organization))fail();teamOrigin(organization.auth_domain);
 if(!object(worker)||worker.name!==settings.workerName||typeof worker.id!=='string'||!worker.id||worker.id===worker.name)fail();
 if(!Array.isArray(apps)||!Array.isArray(idps)||!Array.isArray(hosts)||!Array.isArray(subscriptions)||!subscriptions.length)fail();
 // Only the known zero-price, non-trial Free account subscription is accepted.
 // Empty lists, trials, missing billing fields and unrecognised plans cannot establish Free.
 assertFreeSubscriptions(subscriptions);
 const expected=[settings.productionUrl,...settings.previewUrls].sort();
 if(stable([...hosts].sort())!==stable(expected)||new Set(hosts).size!==hosts.length)fail();
 const app=apps.find(a=>a.id===settings.accessAppId);
 if(!app||app.type!=='self_hosted'||![false,undefined].includes(app.options_preflight_bypass)||!Array.isArray(app.destinations)||app.destinations.length!==1||app.destinations[0].type!=='worker'||app.destinations[0].worker_id!==worker.id||!Array.isArray(app.destinations[0].overrides??[])||(app.destinations[0].overrides??[]).length||app.domain||!Array.isArray(app.self_hosted_domains??[])||(app.self_hosted_domains??[]).length)fail();
 if(!Array.isArray(app.allowed_idps)||app.allowed_idps.length!==1||typeof app.allowed_idps[0]!=='string'||!app.allowed_idps[0]||!idps.some(i=>i.id===app.allowed_idps[0]&&i.type==='onetimepin'))fail();
 const list=policies[app.id];
 if(!Array.isArray(list)||list.length!==1)fail();
 const p=list[0]!;
 if(p.decision!=='allow'||!Array.isArray(p.include)||p.include.length!==1||!object(p.include[0])||Object.keys(p.include[0]).join()!=='email'||!object(p.include[0].email)||Object.keys(p.include[0].email).join()!=='email'||p.include[0].email.email!==settings.allowedEmail||!Array.isArray(p.exclude??[])||!Array.isArray(p.require??[])||(p.exclude??[]).length||(p.require??[]).length)fail();
 for(const other of apps){if(other.id===app.id)continue;
  const destinations=other.destinations??[];
  if(!Array.isArray(destinations)||!Array.isArray(other.self_hosted_domains??[]))fail();
  for(const d of destinations)if(!object(d)||(d.type==='public'&&typeof d.uri!=='string'))fail();
  // Reject any hostname/path application matching this Worker, including wildcards.
  const domains=[other.domain,...(other.self_hosted_domains??[]),...destinations.filter((d:Obj)=>d.type==='public').map((d:Obj)=>d.uri)].filter(Boolean);
  for(const domain of domains){if(typeof domain!=='string')fail(); const hostname=domain.replace(/^https:\/\//,'').split('/')[0]!;const regex=new RegExp('^'+hostname.split('*').map((s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$','i');if(hosts.some(h=>regex.test(new URL(h).hostname)))fail();}
  for(const d of destinations)if(!object(d)||!['public','private','via_mcp_server_portal','worker','preview_worker','all_workers','all_preview_workers'].includes(d.type)||(['worker','preview_worker'].includes(d.type)&&d.worker_id===worker.id))fail();
 }
 const fingerprint=hash(stable({worker,apps,policies,idps,hosts:expected,subscriptions,organization}));
 return {accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,allowedEmails:[settings.allowedEmail],workerWide:true,hasBypass:false,hosts:expected,freePlan:true,fingerprint,authDomain:organization.auth_domain,otpProviderId:app.allowed_idps[0]};
}
/** GET-only API; no auth bodies or Cloudflare error text escape this boundary. */
export async function readAccessData(settings:DeploymentSettings,options:ReadOptions={}):Promise<AccessReadData>{
 try{
 validateSettings(settings);
 const base=`/accounts/${settings.accountId}`;
 const get=cloudflareReader(options);
 const list=(path:string,mode:'paged'|'single'|'single-complete'='paged')=>readCloudflareList(get,path,mode);
 const target=await readWorkerTarget(settings,options);
 const apps=await list(base+'/access/apps');const policies:Record<string,Obj[]>={};
 for(const app of apps){if(typeof app.id!=='string')fail();policies[app.id]=await list(base+'/access/apps/'+encodeURIComponent(app.id)+'/policies');}
 const idps=await list(base+'/access/identity_providers','single'),subscriptions=await list(base+'/subscriptions','single-complete');
 const organization=(await get(base+'/access/organizations')).result;
 if(!object(organization))fail();
 return {...target,apps,policies,idps,subscriptions,organization};
 }catch{throw Error('Cloudflare Access read failed; protection remains unverified');}
}
/** Compatibility path retains the full legacy fingerprint and manual v2 contract. */
export async function readAccessSnapshot(settings:DeploymentSettings,options:ReadOptions={}):Promise<AccessSnapshot>{
 try{return normalizeAccess(settings,await readAccessData(settings,options));}
 catch{throw Error('Cloudflare Access read failed; protection remains unverified');}
}
export type VerifyOptions=ReadOptions&{testProjectRoot?:string;reportPath?:string};
type ProbeResponse={status():number;headers():Record<string,string>;body():Promise<Buffer>;json():Promise<any>};
type ProbeRequest={get(url:string,options:{maxRedirects:number}):Promise<ProbeResponse>};
/** Browser cookie scoping supplies the existing team session. No explicit cookie/token
 * header is copied from a Worker or a caller-provided URL to the identity service. */
export type IndependentIdentity={email:string;userId:string};
export async function readIndependentIdentity(request:ProbeRequest,authDomain:string,accountId:string,otpProviderId?:string):Promise<IndependentIdentity>{
 try{
 const response=await request.get(teamOrigin(authDomain)+'/cdn-cgi/access/get-identity',{maxRedirects:0});
 if(response.status()!==200)fail();const identity=await response.json();
 if(!object(identity)||identity.account_id!==accountId||typeof identity.user_uuid!=='string'||!identity.user_uuid||typeof identity.email!=='string'||!/^\S+@[^\s@]+\.[^\s@]+$/.test(identity.email)||identity.service_token_id)fail();
 // Some real OTP user responses omit service_token_status. Only a provider ID
 // confirmed by the live protected application's OTP configuration can substitute
 // for that absent field. Explicit true/null/string values still fail closed.
 if(otpProviderId!==undefined&&(!/^[a-zA-Z0-9_-]{1,128}$/.test(otpProviderId)||!object(identity.idp)||identity.idp.id!==otpProviderId||identity.idp.type!=='onetimepin'))fail();
 if(identity.service_token_status!==false&&(Object.hasOwn(identity,'service_token_status')||otpProviderId===undefined))fail();
 return {email:identity.email,userId:identity.user_uuid};
 }catch{throw Error('Independent Access identity could not be verified');}
}
/** Compatibility wrapper; the full verifier also binds the independent user UUID. */
export async function readVerifiedIdentity(request:ProbeRequest,authDomain:string,accountId:string,otpProviderId?:string):Promise<string>{
 return (await readIndependentIdentity(request,authDomain,accountId,otpProviderId)).email;
}
/** Live policy evaluation is supplemental to independently authenticated identity
 * and actual edge non-disclosure, never a substitute for either. */
export async function readPolicyDecision(settings:DeploymentSettings,identity:IndependentIdentity,expected:'success'|'fail',options:ReadOptions={}):Promise<string>{
 try{
 validateSettings(settings);const token=options.token??process.env.CLOUDFLARE_API_TOKEN;if(!token)fail();
 const url=new URL('https://api.cloudflare.com/client/v4/accounts/'+settings.accountId+'/access/apps/'+settings.accessAppId+'/user_policy_checks');
 url.searchParams.set('user_id',identity.userId);
 const response=await (options.fetch??fetch)(url.href,{headers:{Authorization:'Bearer '+token},redirect:'error'});
 if(!response.ok)fail();const value=await response.json();
 if(!object(value)||value.success!==true||(value.errors!==undefined&&(!Array.isArray(value.errors)||value.errors.length))||!object(value.result))fail();
 const {app_state:app,user_identity:user}=value.result;
 if(!object(app)||app.app_uid!==settings.accessAppId||app.status!==expected||!Array.isArray(app.policies)||app.policies.length!==1||app.policies[0]?.decision!=='allow'||app.policies[0]?.status!==expected)fail();
 if(!object(user)||user.account_id!==settings.accountId||user.user_uuid!==identity.userId||user.email!==identity.email)fail();
 return hash(stable({accountId:settings.accountId,appId:settings.accessAppId,userId:identity.userId,email:identity.email,status:expected,policies:app.policies.map((p:Obj)=>({decision:p.decision,status:p.status}))}));
 }catch{throw Error('Independent Access policy decision could not be verified');}
}
/** Used only after matching live policy denial to this independent identity.
 * A target login redirect alone is insufficient: finish the trusted redirect chain
 * and inspect the actual terminal login/denial response for sentinel leakage. */
export async function verifyPolicyBoundNonDisclosure(request:ProbeRequest,target:string,authDomain:string,expected:Uint8Array):Promise<boolean>{
 try{
 const trustedTeam=teamOrigin(authDomain),targetUrl=new URL(target),targetOrigin=targetUrl.origin;let current=target;
 if(targetUrl.protocol!=='https:'||targetUrl.username||targetUrl.password||targetUrl.port)return false;
 for(let step=0;step<8;step++){
  const r=await request.get(current,{maxRedirects:0}),body=Buffer.from(await r.body());
  if(body.includes(Buffer.from(expected)))return false;
  if(r.status()===403)return recognizedAccessDenial({status:r.status(),headers:r.headers(),body},expected,current);
  if(r.status()===200){const url=new URL(current),text=body.toString('utf8');return url.origin===trustedTeam&&url.pathname==='/cdn-cgi/access/login/'+targetUrl.hostname&&!!r.headers()['cf-ray']&&/Cloudflare Access/i.test(text)&&/Send login code/i.test(text)&&/type=["']email["']/i.test(text);}
  if(![302,303,307,308].includes(r.status())||!r.headers().location)return false;
  let next:URL;try{next=new URL(r.headers().location!,current);}catch{return false;}
  if(next.protocol!=='https:'||next.username||next.password||![trustedTeam,targetOrigin].includes(next.origin))return false;
  current=next.href;
 }
 return false;
 }catch{return false;}
}
/** An independently verified team session must actually finish the target authorization
 * flow. Its initial anonymous-style login redirect is not evidence of a policy denial. */
export async function verifyOtherAccountDenial(request:ProbeRequest,target:string,authDomain:string,expected:Uint8Array):Promise<boolean>{
 try{
 const trustedTeam=teamOrigin(authDomain),targetUrl=new URL(target),targetOrigin=targetUrl.origin;let current=target;
 if(targetUrl.protocol!=='https:'||targetUrl.username||targetUrl.password||targetUrl.port)return false;
 for(let step=0;step<8;step++){
  const r=await request.get(current,{maxRedirects:0}),body=await r.body();
  if(r.status()===403)return recognizedAccessDenial({status:r.status(),headers:r.headers(),body},expected,current);
  if(body.includes(Buffer.from(expected))||![302,303,307,308].includes(r.status())||!r.headers().location)return false;
  let next:URL;try{next=new URL(r.headers().location!,current);}catch{return false;}
  if(next.protocol!=='https:'||next.username||next.password||![trustedTeam,targetOrigin].includes(next.origin))return false;
  current=next.href;
 }
 return false;
 }catch{return false;}
}
export function recognizedAccessDenial(response:{status:number;headers:Record<string,string>;body:Uint8Array},expected:Uint8Array,url:string,authDomain?:string):boolean{
 const body=Buffer.from(response.body);if(body.includes(Buffer.from(expected)))return false;
 const location=response.headers.location;
 if([302,303,307].includes(response.status)&&location){try{const u=new URL(location,url);return !!authDomain&&u.origin===teamOrigin(authDomain)&&!u.username&&!u.password&&u.pathname.startsWith('/cdn-cgi/access/login');}catch{return false;}}
 return response.status===403&&!!response.headers['cf-ray']&&/Cloudflare Access|Access denied/i.test(body.toString('utf8'));
}
/** Invalidation happens before settings, auth state, bootstrap, or network reads. */
export async function verifyProtection(settings?:DeploymentSettings,options:VerifyOptions={}):Promise<ProtectionEvidence>{
 const root=await verificationProject(options.testProjectRoot),proof=resolve(root,'.reports/access-evidence.json');
 await writeReport({passed:false,status:'running',checkedAt:new Date().toISOString()},proof,[resolve(root,'dist')],root);
 try{
 if(options.reportPath&&resolve(root,options.reportPath)!==proof)fail();
 settings??=JSON.parse(await readFile(resolve(root,'.local/deployment.json'),'utf8'));validateSettings(settings);
 const snapshot=await readAccessSnapshot(settings,options);
 const manifest=JSON.parse(await readFile(resolve(root,'.reports/bootstrap-build.json'),'utf8')) as BuildReport;
 if(!Array.isArray(manifest.sources)||manifest.sources.length||!Array.isArray(manifest.inputs)||manifest.inputs.length)fail();
 const outputs=await inventory(resolve(root,'.generated/bootstrap'));if(stable(outputs)!==stable(manifest.outputs)||hash(outputs.map(f=>`${f.path}\0${f.sha256}\n`).join(''))!==manifest.bundleHash)fail();
 const sentinelHashes:Record<string,string>={};for(const path of sentinelPaths){const f=outputs.find(f=>f.path===path);if(!f)fail();sentinelHashes[path]=f.sha256;}
 // Separate browser contexts; state never leaves ignored local storage and is never logged.
 let ownerIdentityHash='',otherIdentityHash='',policyChecksHash='';
 const browser=await chromium.launch();try{
 const owner=await browser.newContext({storageState:resolve(root,'.local/auth/owner.json')}),other=await browser.newContext({storageState:resolve(root,'.local/auth/other.json')}),anonymous=await browser.newContext();
 const ownerIdentity=await readIndependentIdentity(owner.request,snapshot.authDomain,settings.accountId,snapshot.otpProviderId),otherIdentity=await readIndependentIdentity(other.request,snapshot.authDomain,settings.accountId,snapshot.otpProviderId);
 if(ownerIdentity.email!==settings.allowedEmail||otherIdentity.email===settings.allowedEmail||ownerIdentity.userId===otherIdentity.userId)fail();
 const confirmedSettings=settings;
 const policyChecks=async()=>hash(stable([await readPolicyDecision(confirmedSettings,ownerIdentity,'success',options),await readPolicyDecision(confirmedSettings,otherIdentity,'fail',options)]));
 ownerIdentityHash=hash(stable(ownerIdentity));otherIdentityHash=hash(stable(otherIdentity));policyChecksHash=await policyChecks();
 for(const host of snapshot.hosts){
  for(const path of sentinelPaths){const url=host+'/'+path.split('/').map(encodeURIComponent).join('/');const expected=await readFile(resolve(root,'.generated/bootstrap',path));
   const good=await owner.request.get(url,{maxRedirects:0});if(good.status()!==200||!Buffer.from(await good.body()).equals(expected))fail();
   const denied=await anonymous.request.get(url,{maxRedirects:0});if(!recognizedAccessDenial({status:denied.status(),headers:denied.headers(),body:await denied.body()},expected,url,snapshot.authDomain))fail();
   if(!await verifyPolicyBoundNonDisclosure(other.request,url,snapshot.authDomain,expected))fail();
  }
 }
 const finalOwner=await readIndependentIdentity(owner.request,snapshot.authDomain,settings.accountId,snapshot.otpProviderId),finalOther=await readIndependentIdentity(other.request,snapshot.authDomain,settings.accountId,snapshot.otpProviderId);
 if(stable(finalOwner)!==stable(ownerIdentity)||stable(finalOther)!==stable(otherIdentity)||await policyChecks()!==policyChecksHash)fail();
 }finally{await browser.close();}
 // Re-read after probes: a concurrent policy/hostname/plan change invalidates this run.
 const current=await readAccessSnapshot(settings,options);if(current.fingerprint!==snapshot.fingerprint)fail();
 const evidence:ProtectionEvidence={version:2,method:'independent-identity-policy-and-nondisclosure',ownerIdentityHash,otherIdentityHash,policyChecksHash,accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,checkedAt:new Date().toISOString(),settingsFingerprint:settingsFingerprint(settings),policyFingerprint:snapshot.fingerprint,hosts:snapshot.hosts,anonymousBlocked:true,otherAccountBlocked:true,ownerAllowed:true,sentinelHashes};
 assertReleaseAllowed({settings,snapshot,evidence});await writeReport(evidence,proof,[resolve(root,'dist')],root);return evidence;
 }catch{throw Error('Access verification failed; protection evidence is invalid');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void(async()=>{if(process.argv.length!==2)fail();await verifyProtection();console.log('Access protection verified');})().catch(()=>{console.error('Access verification failed; protection evidence is invalid');process.exitCode=1;});
