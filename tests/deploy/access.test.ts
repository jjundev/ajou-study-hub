import { describe, it, expect } from 'vitest';
import { assertReleaseAllowed } from '../../tools/deploy/guard.js';
import { settingsFingerprint, validateSettings, normalizeAccess, readAccessSnapshot, verifyProtection, recognizedAccessDenial, readVerifiedIdentity, verifyOtherAccountDenial } from '../../tools/deploy/access.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const settings = {accountId:'a'.repeat(32),workerName:'ajou-study-hub',allowedEmail:'owner@example.test',accessAppId:'11111111-1111-1111-1111-111111111111',productionUrl:'https://ajou-study-hub.example.workers.dev',previewUrls:[]};
const app = {id:'11111111-1111-1111-1111-111111111111',type:'self_hosted',destinations:[{type:'worker',worker_id:'immutable-worker-id'}],allowed_idps:['otp-id'],options_preflight_bypass:false};
const policy = {id:'policy-id',decision:'allow',include:[{email:{email:settings.allowedEmail}}],exclude:[],require:[]};
export const fixture = () => ({organization:{auth_domain:'team.cloudflareaccess.com'},worker:{id:'immutable-worker-id',name:settings.workerName},apps:[structuredClone(app)],policies:{'11111111-1111-1111-1111-111111111111':[structuredClone(policy)]},idps:[{id:'otp-id',type:'onetimepin'}],hosts:[settings.productionUrl],subscriptions:[{state:'Provisioned',price:0,rate_plan:{id:'test-workers-free',public_name:'Workers Free'}},{state:'Provisioned',price:0,rate_plan:{id:'test-zero-trust-free',public_name:'Zero Trust Free'}}]});
const input = () => { const snapshot=normalizeAccess(settings,fixture()); return {settings,snapshot,evidence:{accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,checkedAt:new Date().toISOString(),settingsFingerprint:settingsFingerprint(settings),policyFingerprint:snapshot.fingerprint,hosts:snapshot.hosts,anonymousBlocked:true,otherAccountBlocked:true,ownerAllowed:true,sentinelHashes:{'catalog.json':'a'.repeat(64),'content/test/한글 공백.html':'b'.repeat(64),'content/test/.assets/x.png':'c'.repeat(64),'content/test/sentinel.pdf':'d'.repeat(64),'content/test/.pack/nested.html':'e'.repeat(64),'content/test/.assets/sentinel.woff2':'f'.repeat(64)}}}; };
describe('private upload protection',()=>{
 it('uses only API-confirmed canonical team identity origin and refuses credentials/untrusted domains',async()=>{
  const calls:string[]=[];const request={get:async(url:string,options:{maxRedirects:number})=>{calls.push(url);expect(options).toEqual({maxRedirects:0});return {status:()=>200,json:async()=>({email:'other@example.test',account_id:settings.accountId,user_uuid:'other-user',service_token_status:false}),headers:()=>({}),body:async()=>Buffer.from('')};}};
  expect(await readVerifiedIdentity(request,'team.cloudflareaccess.com',settings.accountId)).toBe('other@example.test');expect(calls).toEqual(['https://team.cloudflareaccess.com/cdn-cgi/access/get-identity']);
  for(const domain of ['https://team.cloudflareaccess.com','evil.test','team.cloudflareaccess.com.evil.test','owner:secret@team.cloudflareaccess.com','team.cloudflareaccess.com/path'])await expect(readVerifiedIdentity(request,domain,settings.accountId)).rejects.toThrow();expect(calls).toHaveLength(1);
 });
 it('does not treat an anonymous-style login redirect as a verified other-account denial',async()=>{const request={get:async()=>({status:()=>302,headers:()=>({location:'https://team.cloudflareaccess.com/cdn-cgi/access/login/app'}),body:async()=>Buffer.from('login'),json:async()=>({})})};expect(await verifyOtherAccountDenial(request,settings.productionUrl+'/catalog.json','team.cloudflareaccess.com',Buffer.from('sentinel'))).toBe(false);});
 it('refuses to follow other-account redirects outside exact confirmed team/target origins',async()=>{let count=0;const request={get:async()=>{count++;return {status:()=>302,headers:()=>({location:'https://untrusted.cloudflareaccess.com/steal'}),body:async()=>Buffer.from(''),json:async()=>({})};}};expect(await verifyOtherAccountDenial(request,settings.productionUrl+'/catalog.json','team.cloudflareaccess.com',Buffer.from('sentinel'))).toBe(false);expect(count).toBe(1);});
 it('accepts an independently verified other session only after a trusted target authorization denial',async()=>{const calls:string[]=[];const request={get:async(url:string,options:{maxRedirects:number})=>{calls.push(url);expect(options).toEqual({maxRedirects:0});return calls.length===1?{status:()=>302,headers:()=>({location:'https://team.cloudflareaccess.com/cdn-cgi/access/login/app'}),body:async()=>Buffer.from('redirect'),json:async()=>({})}:{status:()=>403,headers:()=>({'cf-ray':'synthetic'}),body:async()=>Buffer.from('Cloudflare Access denied'),json:async()=>({})};}};expect(await verifyOtherAccountDenial(request,settings.productionUrl+'/catalog.json','team.cloudflareaccess.com',Buffer.from('sentinel'))).toBe(true);expect(calls).toHaveLength(2);});
 it.each(['wrong-account','service-token','missing-user','redirect'])('rejects %s as independent identity proof',async kind=>{const request={get:async()=>({status:()=>kind==='redirect'?302:200,headers:()=>({}),body:async()=>Buffer.from(''),json:async()=>({email:'other@example.test',account_id:kind==='wrong-account'?'wrong':settings.accountId,user_uuid:kind==='missing-user'?'':'user',service_token_status:kind==='service-token'})})};await expect(readVerifiedIdentity(request,'team.cloudflareaccess.com',settings.accountId)).rejects.toThrow();});
 it('rejects missing independent witness and a login page rather than a target denial',async()=>{const missing={get:async()=>({status:()=>403,headers:()=>({}),body:async()=>Buffer.from(''),json:async()=>({})})};await expect(readVerifiedIdentity(missing,'team.cloudflareaccess.com',settings.accountId)).rejects.toThrow();const login={get:async()=>({status:()=>200,headers:()=>({}),body:async()=>Buffer.from('Login with email'),json:async()=>({})})};expect(await verifyOtherAccountDenial(login,settings.productionUrl,'team.cloudflareaccess.com',Buffer.from('sentinel'))).toBe(false);});
 it('does not leak identity/request errors or count network errors as other-account denial',async()=>{const request={get:async():Promise<never>=>{throw Error('SECRET_SESSION');}};await expect(readVerifiedIdentity(request,'team.cloudflareaccess.com',settings.accountId)).rejects.toThrow(/^Independent Access identity could not be verified$/);expect(await verifyOtherAccountDenial(request,settings.productionUrl,'team.cloudflareaccess.com',Buffer.from('sentinel'))).toBe(false);});
 it('accepts current exact single-owner worker-wide protection',()=>expect(()=>assertReleaseAllowed(input())).not.toThrow());
 it.each(['empty','domain','everyone','extra','bypass','require','override','preview','paid','unknown','unknown-plan','missing-product','otp'])('rejects %s policies or scope',kind=>{
  const f:any=fixture();
  if(kind==='empty') f.policies['11111111-1111-1111-1111-111111111111'][0].include=[];
  if(kind==='domain') f.policies['11111111-1111-1111-1111-111111111111'][0].include=[{email_domain:{domain:'example.test'}}];
  if(kind==='everyone') f.policies['11111111-1111-1111-1111-111111111111'][0].include=[{everyone:{}}];
  if(kind==='extra') f.policies['11111111-1111-1111-1111-111111111111'][0].include.push({email:{email:'other@example.test'}});
  if(kind==='bypass') f.policies['11111111-1111-1111-1111-111111111111'][0].decision='bypass';
  if(kind==='require') f.policies['11111111-1111-1111-1111-111111111111'][0].require=[{unknown:{}}];
  if(kind==='override') f.apps[0].destinations[0].overrides=[{behavior:'public',path_pattern:'/content/*'}];
  if(kind==='preview') f.apps[0].destinations[0].type='preview_worker';
  if(kind==='paid') f.subscriptions[0].price=5;
  if(kind==='unknown') f.apps[0].destinations[0].type='future';
  if(kind==='unknown-plan') f.subscriptions[0].rate_plan.public_name='Free';
  if(kind==='missing-product') f.subscriptions.pop();
  if(kind==='otp') f.idps[0].type='oauth';
  expect(()=>normalizeAccess(settings,f)).toThrow();
 });
 it.each(['other','expired','future','host','policy','settings','hash'])('rejects invalid %s evidence',kind=>{const x=input(); if(kind==='other')x.evidence.otherAccountBlocked=false;if(kind==='expired')x.evidence.checkedAt=new Date(Date.now()-86400001).toISOString();if(kind==='future')x.evidence.checkedAt=new Date(Date.now()+60000).toISOString();if(kind==='host')x.evidence.hosts=[];if(kind==='policy')x.evidence.policyFingerprint='changed';if(kind==='settings')x.settings={...settings,allowedEmail:'changed@example.test'};if(kind==='hash')x.evidence.sentinelHashes['catalog.json']='';expect(()=>assertReleaseAllowed(x)).toThrow();});
 it('refuses missing production, credentials, paths and duplicate URLs',()=>{for(const productionUrl of ['http://example.test','https://owner:secret@example.test','https://example.test/path'])expect(()=>validateSettings({...settings,productionUrl})).toThrow();expect(()=>validateSettings({...settings,previewUrls:[settings.productionUrl]})).toThrow();});
 it('refuses a Worker name substituted for immutable id',()=>{const f=fixture();f.apps[0]!.destinations[0]!.worker_id=settings.workerName;expect(()=>normalizeAccess(settings,f)).toThrow();});
 it.each(['path','wildcard','preview'])('rejects a more-specific %s app',kind=>{const f:any=fixture();f.apps.push(kind==='preview'?{id:'override',destinations:[{type:'preview_worker',worker_id:f.worker.id}]}:{id:'override',domain:kind==='path'?'ajou-study-hub.example.workers.dev/private/*':'*.workers.dev'});expect(()=>normalizeAccess(settings,f)).toThrow();});
 it('fails closed and redacts API error content',async()=>{await expect(readAccessSnapshot(settings,{token:'secret',fetch:async()=>{throw Error('SECRET_COOKIE');}})).rejects.toThrow(/^Cloudflare Access read failed; protection remains unverified$/);});
 it('reads official SDK response subset, resolves immutable ID, and rejects incomplete pagination',async()=>{
  const f=fixture();const calls:string[]=[];let missingPage=false;
  const request:typeof fetch=async(input)=>{const url=new URL(String(input));calls.push(url.pathname);let result:any;let collection=false;
   if(url.pathname.endsWith('/workers/workers')){result=[f.worker];collection=true;}
   else if(url.pathname.endsWith('/workers/workers/immutable-worker-id'))result={...f.worker,references:{domains:[]}};
   else if(url.pathname.endsWith('/scripts/ajou-study-hub/subdomain'))result={enabled:true,previews_enabled:false};
   else if(url.pathname.endsWith('/workers/subdomain'))result={subdomain:'example'};
   else if(url.pathname.endsWith('/zones')){result=[];collection=true;}
   else if(url.pathname.endsWith('/access/apps')){result=f.apps;collection=true;}
   else if(url.pathname.endsWith('/policies')){result=f.policies['11111111-1111-1111-1111-111111111111'];collection=true;}
   else if(url.pathname.endsWith('/identity_providers'))result=f.idps;
   else if(url.pathname.endsWith('/subscriptions'))result=f.subscriptions;
   else if(url.pathname.endsWith('/access/organizations'))result=f.organization;
   else throw Error('Unexpected test API path');
   return new Response(JSON.stringify({success:true,errors:[],result,...(collection&&!missingPage?{result_info:{page:1,total_pages:1}}:{})}));
  };
  expect((await readAccessSnapshot(settings,{fetch:request,token:'test-only'})).workerWide).toBe(true);expect(calls).toContain('/client/v4/accounts/'+settings.accountId+'/workers/workers/immutable-worker-id');missingPage=true;await expect(readAccessSnapshot(settings,{fetch:request,token:'test-only'})).rejects.toThrow();
 });
 it('invalidates canonical evidence before malformed settings/auth JSON is read',async()=>{const root=resolve('.generated/verification-tests',randomUUID());await mkdir(resolve(root,'.reports'),{recursive:true});await mkdir(resolve(root,'.local'),{recursive:true});const reportPath=resolve(root,'.reports/access-evidence.json');await writeFile(reportPath,JSON.stringify({ownerAllowed:true,otherAccountBlocked:true}));await writeFile(resolve(root,'.local/deployment.json'),'{SECRET_COOKIE');await expect(verifyProtection(undefined,{testProjectRoot:root,reportPath})).rejects.toThrow(/^Access verification failed; protection evidence is invalid$/);expect(JSON.parse(await readFile(reportPath,'utf8'))).toMatchObject({passed:false,status:'running'});});
 it.each([500,502,404,200,401])('does not mistake HTTP %s or sentinel leakage for Access denial',status=>expect(recognizedAccessDenial({status,headers:{'cf-ray':'synthetic'},body:Buffer.from('Access denied')},Buffer.from('sentinel'),'https://example.test')).toBe(false));
 it('requires recognized Access redirect/denial and rejects leaked sentinel body',()=>{const r={status:302,headers:{location:'https://team.cloudflareaccess.com/cdn-cgi/access/login/app'},body:Buffer.from('redirect')};expect(recognizedAccessDenial(r,Buffer.from('sentinel'),'https://example.test','team.cloudflareaccess.com')).toBe(true);expect(recognizedAccessDenial(r,Buffer.from('sentinel'),'https://example.test','wrong-team.cloudflareaccess.com')).toBe(false);expect(recognizedAccessDenial({...r,body:Buffer.from('sentinel')},Buffer.from('sentinel'),'https://example.test','team.cloudflareaccess.com')).toBe(false);});
});
