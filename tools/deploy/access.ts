import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { verificationProject } from '../verification-project.js';
import { writeReport, type BuildReport } from '../content/report.js';
import { inventory } from './bootstrap.js';
import { assertReleaseAllowed, sentinelPaths } from './guard.js';
export type DeploymentSettings={accountId:string;workerName:string;allowedEmail:string;accessAppId:string;productionUrl:string;previewUrls:string[]};
export type AccessSnapshot={accountId:string;workerName:string;accessAppId:string;allowedEmails:string[];workerWide:boolean;hasBypass:boolean;hosts:string[];freePlan:boolean;fingerprint:string};
export type ProtectionEvidence={accountId:string;workerName:string;accessAppId:string;checkedAt:string;settingsFingerprint:string;policyFingerprint:string;hosts:string[];anonymousBlocked:boolean;otherAccountBlocked:boolean;ownerAllowed:boolean;sentinelHashes:Record<string,string>};
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
export type AccessReadData={worker:Obj;apps:Obj[];policies:Record<string,Obj[]>;idps:Obj[];hosts:string[];subscriptions:Obj[]};
export function assertFreeSubscriptions(value:unknown):asserts value is Obj[]{
 if(!Array.isArray(value)||!value.length||!value.every(s=>object(s)&&s.state==='Provisioned'&&s.price===0&&object(s.rate_plan)&&typeof s.rate_plan.id==='string'&&['Workers Free','Zero Trust Free'].includes(s.rate_plan.public_name)))fail();
 const plans=new Set(value.map(s=>s.rate_plan.public_name));if(!plans.has('Workers Free')||!plans.has('Zero Trust Free'))fail();
}
/** Strict subset of official cloudflare-typescript SelfHostedApplication/Policy/Worker.
 * Unknown policy rules and all overlapping hostname/path/preview apps fail closed. */
export function normalizeAccess(settings:DeploymentSettings,data:AccessReadData):AccessSnapshot {
 validateSettings(settings);
 const {worker,apps,policies,idps,hosts,subscriptions}=data;
 if(!object(worker)||worker.name!==settings.workerName||typeof worker.id!=='string'||!worker.id||worker.id===worker.name)fail();
 if(!Array.isArray(apps)||!Array.isArray(idps)||!Array.isArray(hosts)||!Array.isArray(subscriptions)||!subscriptions.length)fail();
 // Only explicitly provisioned, zero-price subscriptions whose plan explicitly says Free.
 // Empty lists, trials, missing billing fields and unrecognised plans cannot establish Free.
 assertFreeSubscriptions(subscriptions);
 const expected=[settings.productionUrl,...settings.previewUrls].sort();
 if(stable([...hosts].sort())!==stable(expected)||new Set(hosts).size!==hosts.length)fail();
 const app=apps.find(a=>a.id===settings.accessAppId);
 if(!app||app.type!=='self_hosted'||![false,undefined].includes(app.options_preflight_bypass)||!Array.isArray(app.destinations)||app.destinations.length!==1||app.destinations[0].type!=='worker'||app.destinations[0].worker_id!==worker.id||!Array.isArray(app.destinations[0].overrides??[])||(app.destinations[0].overrides??[]).length||app.domain||!Array.isArray(app.self_hosted_domains??[])||(app.self_hosted_domains??[]).length)fail();
 if(!Array.isArray(app.allowed_idps)||app.allowed_idps.length!==1||!idps.some(i=>i.id===app.allowed_idps[0]&&i.type==='onetimepin'))fail();
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
 const fingerprint=hash(stable({worker,apps,policies,idps,hosts:expected,subscriptions}));
 return {accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,allowedEmails:[settings.allowedEmail],workerWide:true,hasBypass:false,hosts:expected,freePlan:true,fingerprint};
}
export type ReadOptions={fetch?:typeof fetch;token?:string};
/** GET-only API; no auth bodies or Cloudflare error text escape this boundary. */
export async function readAccessSnapshot(settings:DeploymentSettings,options:ReadOptions={}):Promise<AccessSnapshot>{
 try{
 validateSettings(settings);const token=options.token??process.env.CLOUDFLARE_API_TOKEN;if(!token)fail();const request=options.fetch??fetch;
 const base=`/accounts/${settings.accountId}`;
 async function get(path:string){const r=await request('https://api.cloudflare.com/client/v4'+path,{headers:{Authorization:`Bearer ${token}`},redirect:'error'});if(!r.ok)fail();const data:unknown=await r.json();if(!object(data)||data.success!==true||!('result'in data)||(Array.isArray(data.errors)&&data.errors.length))fail();return data;}
 async function list(path:string,paginated=true){let out:Obj[]=[];for(let page=1;page<=100;page++){const r=await get(path+(path.includes('?')?'&':'?')+`page=${page}&per_page=100`);if(!Array.isArray(r.result)||!r.result.every(object))fail();out.push(...r.result);if(!paginated){if(r.result_info&&(r.result_info.total_pages>1||r.result_info.cursor||r.result_info.cursors?.after))fail();return out;}const info=r.result_info;if(!object(info)||info.page!==page||!Number.isInteger(info.total_pages)||info.total_pages<0||info.total_pages>100||info.cursor||info.cursors?.after)fail();if(page>=info.total_pages)return out;}return fail();}
 const workers=await list(base+'/workers/workers');const selected=workers.filter(w=>w.name===settings.workerName);if(selected.length!==1)fail();
 const worker=(await get(base+'/workers/workers/'+encodeURIComponent(selected[0]!.id))).result;if(!object(worker)||worker.id!==selected[0]!.id||worker.name!==settings.workerName)fail();
 const sub=(await get(base+'/workers/scripts/'+settings.workerName+'/subdomain')).result;
 const accountSub=(await get(base+'/workers/subdomain')).result;
 // Initial deployment supports read-confirmed disabled preview URLs. Any enabled preview
 // fails closed until a complete preview/version/custom-route inventory is implemented.
 if(!object(sub)||sub.enabled!==true||sub.previews_enabled!==false||settings.previewUrls.length||!object(accountSub)||typeof accountSub.subdomain!=='string')fail();
 if(!object(worker.references)||!Array.isArray(worker.references.domains)||worker.references.domains.length)fail();
 // Zone route inventory: reject all target script routes; worker-wide scope still protects
 // them, but accepting an unprobed address would make evidence incomplete.
 const zones=await list('/zones?account.id='+settings.accountId);
 for(const zone of zones){if(typeof zone.id!=='string')fail();const routes=await list('/zones/'+zone.id+'/workers/routes',false);if(routes.some(r=>r.script===settings.workerName))fail();}
 const apps=await list(base+'/access/apps');const policies:Record<string,Obj[]>={};
 for(const app of apps){if(typeof app.id!=='string')fail();policies[app.id]=await list(base+'/access/apps/'+encodeURIComponent(app.id)+'/policies');}
 const idps=await list(base+'/access/identity_providers',false),subscriptions=await list(base+'/subscriptions',false);
 return normalizeAccess(settings,{worker,apps,policies,idps,subscriptions,hosts:[`https://${settings.workerName}.${accountSub.subdomain}.workers.dev`]});
 }catch{throw Error('Cloudflare Access read failed; protection remains unverified');}
}
export type VerifyOptions=ReadOptions&{testProjectRoot?:string;reportPath?:string};
export function recognizedAccessDenial(response:{status:number;headers:Record<string,string>;body:Uint8Array},expected:Uint8Array,url:string):boolean{
 const body=Buffer.from(response.body);if(body.includes(Buffer.from(expected)))return false;
 const location=response.headers.location;
 if([302,303,307].includes(response.status)&&location){try{const u=new URL(location,url);return u.protocol==='https:'&&u.hostname.endsWith('.cloudflareaccess.com')&&u.pathname.startsWith('/cdn-cgi/access/login');}catch{return false;}}
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
 const browser=await chromium.launch();try{
 const owner=await browser.newContext({storageState:resolve(root,'.local/auth/owner.json')}),other=await browser.newContext({storageState:resolve(root,'.local/auth/other.json')}),anonymous=await browser.newContext();
 for(const host of snapshot.hosts){
  const identities=[];for(const context of [owner,other]){const r=await context.request.get(host+'/cdn-cgi/access/get-identity',{maxRedirects:0});if(r.status()!==200)fail();const identity=await r.json();if(!object(identity)||typeof identity.email!=='string')fail();identities.push(identity.email);}
  if(identities[0]!==settings.allowedEmail||identities[1]===settings.allowedEmail||!/^\S+@[^\s@]+\.[^\s@]+$/.test(identities[1]))fail();
  for(const path of sentinelPaths){const url=host+'/'+path.split('/').map(encodeURIComponent).join('/');const expected=await readFile(resolve(root,'.generated/bootstrap',path));
   const good=await owner.request.get(url,{maxRedirects:0});if(good.status()!==200||!Buffer.from(await good.body()).equals(expected))fail();
   for(const context of [anonymous,other]){const r=await context.request.get(url,{maxRedirects:0});if(!recognizedAccessDenial({status:r.status(),headers:r.headers(),body:await r.body()},expected,url))fail();}
  }
 }
 }finally{await browser.close();}
 // Re-read after probes: a concurrent policy/hostname/plan change invalidates this run.
 const current=await readAccessSnapshot(settings,options);if(current.fingerprint!==snapshot.fingerprint)fail();
 const evidence:ProtectionEvidence={accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,checkedAt:new Date().toISOString(),settingsFingerprint:settingsFingerprint(settings),policyFingerprint:snapshot.fingerprint,hosts:snapshot.hosts,anonymousBlocked:true,otherAccountBlocked:true,ownerAllowed:true,sentinelHashes};
 assertReleaseAllowed({settings,snapshot,evidence});await writeReport(evidence,proof,[resolve(root,'dist')],root);return evidence;
 }catch{throw Error('Access verification failed; protection evidence is invalid');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void(async()=>{if(process.argv.length!==2)fail();await verifyProtection();console.log('Access protection verified');})().catch(()=>{console.error('Access verification failed; protection evidence is invalid');process.exitCode=1;});
