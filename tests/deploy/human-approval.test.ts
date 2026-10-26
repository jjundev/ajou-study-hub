import { expect, it, vi } from 'vitest';
import { assertReleaseAllowed, sentinelPaths } from '../../tools/deploy/guard.js';
import { settingsFingerprint } from '../../tools/deploy/access.js';
import { verifyProduction } from '../../tools/deploy/human-approval.js';
import { chromium } from '@playwright/test';
const settings={accountId:'a'.repeat(32),workerName:'ajou-study-hub',allowedEmail:'owner@example.test',accessAppId:'11111111-1111-1111-1111-111111111111',productionUrl:'https://ajou-study-hub.example.workers.dev',previewUrls:[]};
it('preserves manual v2 identity and 24-hour guard independently of automation approval',()=>{
 const snapshot={accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,allowedEmails:[settings.allowedEmail],workerWide:true,hasBypass:false,hosts:[settings.productionUrl],freePlan:true,fingerprint:'a'.repeat(64),authDomain:'team.cloudflareaccess.com',otpProviderId:'otp-id'};
 const evidence={version:2 as const,method:'independent-identity-policy-and-nondisclosure' as const,ownerIdentityHash:'1'.repeat(64),otherIdentityHash:'2'.repeat(64),policyChecksHash:'3'.repeat(64),accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,checkedAt:new Date().toISOString(),settingsFingerprint:settingsFingerprint(settings),policyFingerprint:snapshot.fingerprint,hosts:snapshot.hosts,anonymousBlocked:true,otherAccountBlocked:true,ownerAllowed:true,sentinelHashes:Object.fromEntries(sentinelPaths.map(p=>[p,'b'.repeat(64)]))};
 expect(()=>assertReleaseAllowed({settings,snapshot,evidence})).not.toThrow();
 expect(()=>assertReleaseAllowed({settings,snapshot,evidence:{...evidence,checkedAt:new Date(Date.now()-86400001).toISOString()}})).toThrow();
 expect(()=>assertReleaseAllowed({settings,snapshot,evidence:{...evidence,otherIdentityHash:evidence.ownerIdentityHash}})).toThrow();
});
it('rejects bootstrap and malformed manifests before any browser session is read',async()=>{
 const launch=vi.spyOn(chromium,'launch').mockRejectedValue(new Error('Must not launch'));
 try{
  for(const manifest of [null,{}, {createdAt:new Date().toISOString(),sources:[],inputs:[],outputs:[],issues:[],bundleHash:'a'.repeat(64)}])await expect(verifyProduction(settings,manifest as any,'owner.json','other.json')).rejects.toThrow();
  expect(launch).not.toHaveBeenCalled();
 }finally{launch.mockRestore();}
});
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import * as policy from '../../tools/deploy/access-policy.js';
import { inventory } from '../../tools/deploy/bootstrap.js';
import type { Browser } from '@playwright/test';
const project=vi.hoisted(()=>({root:''}));
vi.mock('../../tools/verification-project.js',()=>({verificationProject:async()=>{if(!project.root)throw Error('No isolated project');return project.root;}}));
it.each(['success','trusted-login','anonymous-generic-403','other-generic-403','redirect-generic-403','redirect-leak','wrong-login-host','missing-login-marker','missing-optional','owner-bytes','anonymous-leak','other-leak','same-user','wrong-provider','policy-other-allowed','policy-post-change','identity-post-change','inspection-post-change','version-post-change','bundle-post-change'])('checks actual manifest bytes and independent pre/post identity and policy: %s',async kind=>{
 const root=await mkdtemp(resolve(tmpdir(),'hub-human-'));project.root=root;
 const bytes=new Map([['index.html','APP'],['assets/app.js','JS'],['catalog.json','CATALOG'],['content/course/lesson.html','HTML'],...(kind==='missing-optional'?[]:[['content/course/.pack/nested.html','NESTED'],['content/course/.assets/image.png','IMAGE'],['content/course/book.pdf','PDF'],['content/course/.assets/font.woff2','FONT']])].map(([p,b])=>[p!,Buffer.from('SYNTHETIC_'+b)]));
 let identities=0,policyReads=0,inspectionReads=0,closed=false;
 const sha=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
 const inspection={workerId:'immutable-worker-id',versionId:'22222222-2222-2222-2222-222222222222',protectionFingerprint:'a'.repeat(64),snapshot:{accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,allowedEmails:[settings.allowedEmail],workerWide:true,hasBypass:false,hosts:[settings.productionUrl],freePlan:true,fingerprint:'b'.repeat(64),authDomain:'team.cloudflareaccess.com',otpProviderId:'otp-id'}};
 const reader=vi.spyOn(policy,'readAccessInspection').mockImplementation(async()=>{inspectionReads++;return {...inspection,...(inspectionReads===2&&kind==='inspection-post-change'?{protectionFingerprint:'c'.repeat(64)}:{}),...(inspectionReads===2&&kind==='version-post-change'?{versionId:'33333333-3333-3333-3333-333333333333'}:{})};});
 vi.stubEnv('CLOUDFLARE_API_TOKEN','synthetic');
 const api=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{const url=new URL(String(input));if(!url.pathname.endsWith('/user_policy_checks'))throw Error('Wrong policy endpoint');policyReads++;const owner=url.searchParams.get('user_id')==='owner-uuid';const status=owner||kind==='policy-other-allowed'||kind==='policy-post-change'&&policyReads>2?'success':'fail';return new Response(JSON.stringify({success:true,errors:[],result:{app_state:{app_uid:settings.accessAppId,status,policies:[{decision:'allow',status}]},user_identity:{account_id:settings.accountId,user_uuid:owner?'owner-uuid':'other-uuid',email:owner?settings.allowedEmail:'other@example.test'}}}));});
 const response=(status:number,body:Buffer,identity?:unknown,headers:Record<string,string>={'cf-ray':'test'})=>({status:()=>status,headers:()=>headers,body:async()=>body,json:async()=>identity});
 const launch=vi.spyOn(chromium,'launch').mockResolvedValue({newContext:async(options?:{storageState?:string})=>{const role=options?.storageState?.endsWith('owner.json')?'owner':options?.storageState?.endsWith('other.json')?'other':'anonymous';return {request:{get:async(url:string)=>{
  if(url==='https://team.cloudflareaccess.com/cdn-cgi/access/get-identity'){identities++;return response(200,Buffer.from(''),{account_id:settings.accountId,user_uuid:kind==='same-user'?'owner-uuid':role+'-uuid',email:role==='owner'?settings.allowedEmail:kind==='identity-post-change'&&identities>2?'changed@example.test':'other@example.test',idp:{id:kind==='wrong-provider'?'wrong':'otp-id',type:'onetimepin'}});}
  if(url.startsWith('https://team.cloudflareaccess.com/cdn-cgi/access/login/')){
   if(kind==='redirect-generic-403')return response(403,Buffer.from('Access denied'));
   const login='<title>Cloudflare Access</title><form><input type="email"><button>Send login code</button></form>';
   return response(200,Buffer.from(kind==='redirect-leak'?login+bytes.get('catalog.json')!.toString():kind==='missing-login-marker'?'ordinary form':login));
  }
  const path=decodeURIComponent(new URL(url).pathname.slice(1)),expected=bytes.get(path);if(!expected)throw Error('Probe absent from manifest');
  if(kind==='bundle-post-change')await writeFile(resolve(root,'dist/catalog.json'),'CHANGED');
  if(role==='owner')return response(200,kind==='owner-bytes'?Buffer.from('WRONG'):expected);
  if(kind==='anonymous-generic-403'&&role==='anonymous'||kind==='other-generic-403'&&role==='other')return response(403,Buffer.from('Access denied'));
  if(['trusted-login','redirect-generic-403','redirect-leak','wrong-login-host','missing-login-marker'].includes(kind))return response(302,Buffer.from('redirect'),undefined,{location:'https://team.cloudflareaccess.com/cdn-cgi/access/login/'+(kind==='wrong-login-host'?'wrong.example.workers.dev':'ajou-study-hub.example.workers.dev')});
  if(kind==='anonymous-leak'&&role==='anonymous'||kind==='other-leak'&&role==='other')return response(403,Buffer.concat([Buffer.from('Cloudflare Access denied'),expected]));
  return response(403,Buffer.from('Cloudflare Access denied'));
 }}};},close:async()=>{closed=true;}} as unknown as Browser);
 try{
  for(const [path,value] of bytes){await mkdir(dirname(resolve(root,'dist',path)),{recursive:true});await writeFile(resolve(root,'dist',path),value);}
  const outputs=await inventory(resolve(root,'dist'));
  const manifest={createdAt:new Date().toISOString(),bundleHash:sha(outputs.map(f=>`${f.path}\0${f.sha256}\n`).join('')),sources:[{courseId:'course',commit:'a'.repeat(40),dirty:true,trackedPaths:['lesson.html'],explicitUntracked:[]}],inputs:[{courseId:'course',path:'lesson.html',sha256:sha('input')}],outputs,issues:[]};
  const run=verifyProduction(settings,manifest as any,resolve(root,'owner.json'),resolve(root,'other.json'));
  if(kind==='success'||kind==='trusted-login'||kind==='missing-optional'){
   const evidence=await run;expect(evidence.rows.every(r=>r.ownerExact&&r.anonymousBlocked&&r.otherBlocked)).toBe(true);expect(evidence.ownerIdentityHash).not.toBe(evidence.otherIdentityHash);expect(evidence.rows.map(r=>r.kind)).toEqual(kind!=='missing-optional'?['catalog','html','nested-html','image','pdf','font']:['catalog','html']);expect(evidence.absentKinds).toEqual(kind!=='missing-optional'?[]:['nested-html','image','pdf','font']);expect(evidence.rows.every(r=>r.sha256===sha(bytes.get(r.path)!))).toBe(true);expect(JSON.parse(await readFile(resolve(root,'.reports/production-access-evidence.json'),'utf8'))).toEqual(evidence);expect(policyReads).toBe(4);expect(identities).toBe(4);
  }else{await expect(run).rejects.toThrow(/^Production Access verification failed; evidence remains invalid$/);expect(JSON.parse(await readFile(resolve(root,'.reports/production-access-evidence.json'),'utf8'))).toMatchObject({passed:false});}
  expect(closed).toBe(true);
 }finally{reader.mockRestore();api.mockRestore();launch.mockRestore();vi.unstubAllEnvs();project.root='';await rm(root,{recursive:true,force:true});}
});
import { execFileSync } from 'node:child_process';
it.each(['human-approval','access-baseline'])('rejects unreviewed CLI arguments without exposing raw errors: %s',name=>{
 try{execFileSync(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('tools/deploy/'+name+'.ts'),'--invalid-secret-argument'],{encoding:'utf8',stdio:'pipe'});throw Error('Unexpected CLI success');}
 catch(error){const result=error as {status?:number;stdout?:string;stderr?:string};expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toBe(name==='human-approval'?'Production Access verification failed; evidence remains invalid\n':'Automation approval failed; no approval is claimed\n');}
});
