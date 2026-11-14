import { expect, it, vi } from 'vitest';
import { assertReleaseAllowed, sentinelPaths } from '../../tools/deploy/guard.js';
import { settingsFingerprint } from '../../tools/deploy/access.js';
import { validateManifest, verifyProduction } from '../../tools/deploy/human-approval.js';
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
 const root=await mkdtemp(resolve(tmpdir(),'hub-human-'));project.root=root;
 const launch=vi.spyOn(chromium,'launch').mockRejectedValue(new Error('Must not launch'));
 try{
  await mkdir(resolve(root,'dist'));
  for(const manifest of [null,{}, {createdAt:new Date().toISOString(),sources:[],inputs:[],outputs:[],issues:[],bundleHash:'a'.repeat(64)}]){
   expect(()=>validateManifest(manifest)).toThrow();
   await expect(verifyProduction(settings,manifest as any,'owner.json','other.json')).rejects.toThrow();
  }
  expect(launch).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(resolve(root,'.reports/production-access-evidence.json'),'utf8'))).toMatchObject({passed:false,status:'running'});
 }finally{launch.mockRestore();project.root='';await rm(root,{recursive:true,force:true});}
});
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import * as policy from '../../tools/deploy/access-policy.js';
import { inventory } from '../../tools/deploy/bootstrap.js';
import { assertCurrentBundle } from '../../tools/runtime-server.js';
import type { Catalog } from '../../src/content/model.js';
import type { BuildReport } from '../../tools/content/report.js';
import type { Browser } from '@playwright/test';
const project=vi.hoisted(()=>({root:''}));
vi.mock('../../tools/verification-project.js',()=>({verificationProject:async()=>{if(!project.root)throw Error('No isolated project');return project.root;}}));
const sha=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
type CatalogChange=(bytes:Map<string,Buffer>,root:string)=>void|Promise<void>;
const editCatalog=(edit:(catalog:Catalog)=>void):CatalogChange=>bytes=>{
 const catalog:Catalog=JSON.parse(bytes.get('catalog.json')!.toString());edit(catalog);bytes.set('catalog.json',Buffer.from(JSON.stringify(catalog)));
};
async function writeFixture(root:string,bytes:Map<string,Buffer>):Promise<BuildReport>{
 for(const [path,value] of bytes){await mkdir(dirname(resolve(root,'dist',path)),{recursive:true});await writeFile(resolve(root,'dist',path),value);}
 const outputs=await inventory(resolve(root,'dist'));
 const inputs=outputs.filter(f=>f.path.startsWith('content/course/')).map(f=>({courseId:'course',path:f.path.slice('content/course/'.length),sha256:f.sha256}));
 return {createdAt:new Date().toISOString(),bundleHash:sha(outputs.map(f=>`${f.path}\0${f.sha256}\n`).join('')),sources:[{courseId:'course',commit:'a'.repeat(40),dirty:true,trackedPaths:inputs.map(f=>f.path),explicitUntracked:[]}],inputs,outputs,issues:[]};
}
async function checkFixture(kind:string,change?:CatalogChange){
 const root=await mkdtemp(resolve(tmpdir(),'hub-human-'));project.root=root;
 const deep=kind.startsWith('deep-'),optional=!['missing-optional','deep-listed-only'].includes(kind);
 const listedPath=deep?'content/course/학습 자료/10 월/주 학습.html':'content/course/lesson.html';
 const unlistedPath=deep?'content/course/학습 자료/10 월/연결 문서.html':kind==='unlisted-at-root'?'content/course/linked.html':'content/course/.pack/nested.html';
 const assets=kind==='assets-outside-content'?['assets/image.png','assets/book.pdf','assets/font.woff2']:['content/course/.assets/image.png','content/course/book.pdf','content/course/.assets/font.woff2'];
 const bytes=new Map([['index.html','APP'],['404.html','NOT_FOUND'],['assets/app.js','JS'],[listedPath,'HTML'],...(optional?[[unlistedPath,'NESTED'],[assets[0]!,'IMAGE'],[assets[1]!,'PDF'],[assets[2]!,'FONT']]:[])].map(([p,b])=>[p!,Buffer.from('SYNTHETIC_'+b)]));
 const catalog:Catalog={version:1,courses:[{id:'course',name:'Synthetic course',repo:'example/synthetic-course',semester:'2026-2'}],groups:deep?[{id:'group',courseId:'course',title:'Synthetic group',sourcePath:'학습 자료/10 월',kind:'supplement',date:null,order:0}]:[],documents:[listedPath,...optional?[unlistedPath]:[]].map((path,i)=>({id:i===0?'listed-document':'linked-document',courseId:'course',groupId:deep?'group':null,title:i===0?'Main document':'Linked document',type:'note',sourcePath:path.slice('content/course/'.length),url:'/'+path.split('/').map(encodeURIComponent).join('/'),listed:i===0}))};
 if(kind==='deep-described-date') Object.assign(catalog.groups[0]!,{kind:'date',date:'2026-10-01',description:'첫 주제 · 다음 주제'});
 bytes.set('catalog.json',Buffer.from(JSON.stringify(catalog)));
 let identities=0,policyReads=0,inspectionReads=0,closed=false;
 const inspection={workerId:'immutable-worker-id',versionId:'22222222-2222-2222-2222-222222222222',protectionFingerprint:'a'.repeat(64),snapshot:{accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,allowedEmails:[settings.allowedEmail],workerWide:true,hasBypass:false,hosts:[settings.productionUrl],freePlan:true,fingerprint:'b'.repeat(64),authDomain:'team.cloudflareaccess.com',otpProviderId:'otp-id'}};
 const reader=vi.spyOn(policy,'readAccessInspection').mockImplementation(async()=>{inspectionReads++;return {...inspection,...(inspectionReads===2&&kind==='inspection-post-change'?{protectionFingerprint:'c'.repeat(64)}:{}),...(inspectionReads===2&&kind==='version-post-change'?{versionId:'33333333-3333-3333-3333-333333333333'}:{})};});
 vi.stubEnv('CLOUDFLARE_API_TOKEN','synthetic');
 const credentialKeys=['CLOUDFLARE_API_TOKEN','CLOUDFLARE_READ_TOKEN','GH_TOKEN','GITHUB_TOKEN','STUDY_HUB_READER_PRIVATE_KEY','STUDY_HUB_DISPATCH_PRIVATE_KEY','STUDY_HUB_LEDGER_PRIVATE_KEY'];
 if(kind==='browser-env'){
  for(const key of credentialKeys)vi.stubEnv(key,key==='CLOUDFLARE_API_TOKEN'?'synthetic':'synthetic-'+key);
  vi.stubEnv('STUDY_HUB_TEST_BROWSER_RUNTIME','synthetic-runtime');
 }
 const contexts:unknown[]=[],probes:{role:string;url:string}[]=[];
 const api=vi.spyOn(globalThis,'fetch').mockImplementation(async (input,options)=>{expect(options?.headers).toEqual({Authorization:'Bearer synthetic'});const url=new URL(String(input));if(!url.pathname.endsWith('/user_policy_checks'))throw Error('Wrong policy endpoint');policyReads++;const owner=url.searchParams.get('user_id')==='owner-uuid';const status=owner||kind==='policy-other-allowed'||kind==='policy-post-change'&&policyReads>2?'success':'fail';return new Response(JSON.stringify({success:true,errors:[],result:{app_state:{app_uid:settings.accessAppId,status,policies:[{decision:'allow',status}]},user_identity:{account_id:settings.accountId,user_uuid:owner?'owner-uuid':'other-uuid',email:owner?settings.allowedEmail:'other@example.test'}}}));});
 const response=(status:number,body:Buffer,identity?:unknown,headers:Record<string,string>={'cf-ray':'test'})=>({status:()=>status,headers:()=>headers,body:async()=>body,json:async()=>identity});
 const launch=vi.spyOn(chromium,'launch').mockResolvedValue({newContext:async(options?:{storageState?:string})=>{contexts.push(options);const role=options?.storageState?.endsWith('owner.json')?'owner':options?.storageState?.endsWith('other.json')?'other':'anonymous';return {request:{get:async(url:string)=>{
  if(url==='https://team.cloudflareaccess.com/cdn-cgi/access/get-identity'){identities++;return response(200,Buffer.from(''),{account_id:settings.accountId,user_uuid:kind==='same-user'?'owner-uuid':role+'-uuid',email:role==='owner'?settings.allowedEmail:kind==='identity-post-change'&&identities>2?'changed@example.test':'other@example.test',idp:{id:kind==='wrong-provider'?'wrong':'otp-id',type:'onetimepin'}});}
  if(url.startsWith('https://team.cloudflareaccess.com/cdn-cgi/access/login/')){
   if(kind==='redirect-generic-403')return response(403,Buffer.from('Access denied'));
   const login='<title>Cloudflare Access</title><form><input type="email"><button>Send login code</button></form>';
   return response(200,Buffer.from(kind==='redirect-leak'?login+bytes.get('catalog.json')!.toString():kind==='missing-login-marker'?'ordinary form':login));
  }
  const path=decodeURIComponent(new URL(url).pathname.slice(1)),expected=bytes.get(path);if(!expected)throw Error('Probe absent from manifest');
  probes.push({role,url});
  if(kind==='bundle-post-change')await writeFile(resolve(root,'dist/catalog.json'),'CHANGED');
  if(role==='owner')return response(200,kind==='owner-bytes'?Buffer.from('WRONG'):expected);
  if(kind==='anonymous-generic-403'&&role==='anonymous'||kind==='other-generic-403'&&role==='other')return response(403,Buffer.from('Access denied'));
  if(['trusted-login','redirect-generic-403','redirect-leak','wrong-login-host','missing-login-marker'].includes(kind))return response(302,Buffer.from('redirect'),undefined,{location:'https://team.cloudflareaccess.com/cdn-cgi/access/login/'+(kind==='wrong-login-host'?'wrong.example.workers.dev':'ajou-study-hub.example.workers.dev')});
  if(kind==='anonymous-leak'&&role==='anonymous'||kind==='other-leak'&&role==='other')return response(403,Buffer.concat([Buffer.from('Cloudflare Access denied'),expected]));
  return response(403,Buffer.from('Cloudflare Access denied'));
 }}};},close:async()=>{closed=true;}} as unknown as Browser);
 try{
  const manifest=await writeFixture(root,bytes);
  validateManifest(manifest);await assertCurrentBundle(resolve(root,'dist'),manifest,root);expect(await inventory(resolve(root,'dist'))).toEqual(manifest.outputs);
  const run=verifyProduction(settings,manifest,resolve(root,'owner.json'),resolve(root,'other.json'));
  if(deep||['success','browser-env','trusted-login','missing-optional','unlisted-at-root','assets-outside-content'].includes(kind)){
   const evidence=await run;expect(evidence.rows.every(r=>r.ownerExact&&r.anonymousBlocked&&r.otherBlocked)).toBe(true);expect(evidence.ownerIdentityHash).not.toBe(evidence.otherIdentityHash);expect(evidence.rows.map(r=>r.kind)).toEqual(optional?['catalog','html','nested-html','image','pdf','font']:['catalog','html']);expect(evidence.absentKinds).toEqual(optional?[]:['nested-html','image','pdf','font']);expect(evidence.rows.every(r=>r.sha256===sha(bytes.get(r.path)!))).toBe(true);expect(JSON.parse(await readFile(resolve(root,'.reports/production-access-evidence.json'),'utf8'))).toEqual(evidence);expect(policyReads).toBe(4);expect(identities).toBe(4);
   expect(evidence.rows.find(r=>r.kind==='html')?.path).toBe(listedPath);
   if(optional)expect(evidence.rows.find(r=>r.kind==='nested-html')?.path).toBe(unlistedPath);
   if(kind==='assets-outside-content')expect(evidence.rows.filter(r=>['image','pdf','font'].includes(r.kind)).map(r=>r.path)).toEqual(['assets/image.png','assets/book.pdf','assets/font.woff2']);
   if(deep){
    const main=settings.productionUrl+'/content/course/%ED%95%99%EC%8A%B5%20%EC%9E%90%EB%A3%8C/10%20%EC%9B%94/%EC%A3%BC%20%ED%95%99%EC%8A%B5.html';
    expect(probes.filter(p=>p.url===main).map(p=>p.role)).toEqual(['owner','anonymous','other']);
    if(optional){expect(listedPath.split('/')).toHaveLength(5);expect(unlistedPath.split('/')).toHaveLength(5);}
   }
  }else{await expect(run).rejects.toThrow(/^Production Access verification failed; evidence remains invalid$/);expect(JSON.parse(await readFile(resolve(root,'.reports/production-access-evidence.json'),'utf8'))).toMatchObject({passed:false});}
  if(kind==='browser-env'){
   const env=launch.mock.calls[0]?.[0]?.env;expect(env).toBeDefined();
   for(const key of credentialKeys){expect(Object.hasOwn(env!,key)).toBe(false);expect(process.env[key]).toBe(key==='CLOUDFLARE_API_TOKEN'?'synthetic':'synthetic-'+key);}
   expect(env!.STUDY_HUB_TEST_BROWSER_RUNTIME).toBe('synthetic-runtime');expect(process.env.STUDY_HUB_TEST_BROWSER_RUNTIME).toBe('synthetic-runtime');
   expect(contexts).toEqual([{storageState:resolve(root,'owner.json')},{storageState:resolve(root,'other.json')},undefined]);
  }
  expect(closed).toBe(true);
  if(change){
   // Every catalog rejection starts from the complete successful base above.
   reader.mockClear();api.mockClear();launch.mockClear();closed=false;
   await change(bytes,root);
   const changed=await writeFixture(root,bytes);
   validateManifest(changed);await assertCurrentBundle(resolve(root,'dist'),changed,root);expect(await inventory(resolve(root,'dist'))).toEqual(changed.outputs);
   await expect(verifyProduction(settings,changed,resolve(root,'owner.json'),resolve(root,'other.json'))).rejects.toThrow(/^Production Access verification failed; evidence remains invalid$/);
   expect(reader).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();expect(launch).not.toHaveBeenCalled();expect(closed).toBe(false);
   expect(JSON.parse(await readFile(resolve(root,'.reports/production-access-evidence.json'),'utf8'))).toMatchObject({passed:false,status:'running'});
  }
 }finally{reader.mockRestore();api.mockRestore();launch.mockRestore();vi.unstubAllEnvs();project.root='';await rm(root,{recursive:true,force:true});}
}
it.each(['success','browser-env','trusted-login','anonymous-generic-403','other-generic-403','redirect-generic-403','redirect-leak','wrong-login-host','missing-login-marker','missing-optional','owner-bytes','anonymous-leak','other-leak','same-user','wrong-provider','policy-other-allowed','policy-post-change','identity-post-change','inspection-post-change','version-post-change','bundle-post-change'])('checks actual manifest bytes and independent pre/post identity and policy: %s',kind=>checkFixture(kind));
it.each(['deep-content','deep-listed-only','deep-described-date','unlisted-at-root'])('classifies catalog listed metadata independently of HTML path depth: %s',kind=>checkFixture(kind));
it('probes optional assets from the verified manifest outside content/',()=>checkFixture('assets-outside-content'));
const invalidCatalogs:{name:string;edit:(catalog:Catalog)=>void}[]=[
 {name:'no listed HTML',edit:c=>{c.documents.forEach(d=>d.listed=false);}},
 {name:'empty documents',edit:c=>{c.documents=[];}},
 {name:'orphan HTML',edit:c=>{c.documents.pop();}},
 {name:'duplicate document',edit:c=>{c.documents.push({...c.documents[0]!});}},
 {name:'duplicate URL with conflicting listed flag',edit:c=>{c.documents.push({...c.documents[0]!,id:'conflicting-document',listed:false});}},
 {name:'duplicate document identity',edit:c=>{c.documents[1]!.id=c.documents[0]!.id;}},
 {name:'nonboolean listed',edit:c=>{Object.assign(c.documents[0]!,{listed:'true'});}},
 {name:'missing listed',edit:c=>{Reflect.deleteProperty(c.documents[0]!,'listed');}},
 {name:'invalid root version',edit:c=>{Object.assign(c,{version:2});}},
 {name:'nonarray documents',edit:c=>{Object.assign(c,{documents:{}});}},
 {name:'null document',edit:c=>{Object.assign(c.documents,{0:null});}},
 {name:'unknown document field',edit:c=>{Object.assign(c.documents[0]!,{hidden:false});}},
 {name:'invalid material type',edit:c=>{Object.assign(c.documents[0]!,{type:'unknown'});}},
 {name:'missing title',edit:c=>{Reflect.deleteProperty(c.documents[0]!,'title');}},
 {name:'source path mismatch',edit:c=>{c.documents[0]!.sourcePath='different.html';}},
 {name:'unknown course',edit:c=>{c.documents[0]!.courseId='other-course';}},
 {name:'duplicate course',edit:c=>{c.courses.push({...c.courses[0]!});}},
 {name:'unknown group',edit:c=>{c.documents[0]!.groupId='absent-group';}},
 {name:'invalid course schema',edit:c=>{Object.assign(c.courses[0]!,{semester:2026});}},
 {name:'invalid group schema',edit:c=>{Object.assign(c,{groups:[{id:'group'}]});}},
];
it.each(invalidCatalogs)('rejects hash-bound catalog metadata after a valid base: $name',({edit})=>checkFixture('success',editCatalog(edit)));
it.each([
 'https://outside.example/content/course/lesson.html','//outside.example/content/course/lesson.html',
 '/index.html','/404.html','/content/course/../course/lesson.html','/content/course/%2e%2e/course/lesson.html',
 '/content/course/lesson.html?download=1','/content/course/lesson.html#section','content/course/lesson.html',
 '/content//course/lesson.html','/content/course/%6Cesson.html','/content%2Fcourse/lesson.html',
 '/content/course/%256Cesson.html','/content\\course/lesson.html','/content/course/lesson.html\n',
])('rejects unsafe or noncanonical catalog URL after a valid base: %s',url=>checkFixture('success',editCatalog(c=>{c.documents[0]!.url=url;})));
it.each(['{','null','[]','{}'])('rejects invalid hash-bound catalog JSON/schema after a valid base: %s',raw=>checkFixture('success',bytes=>{bytes.set('catalog.json',Buffer.from(raw));}));
it.each(['catalog.json','content/course/lesson.html'])('rejects a missing catalog/referenced output with a consistent manifest: %s',path=>checkFixture('success',async(bytes,root)=>{bytes.delete(path);await rm(resolve(root,'dist',path));}));
import { execFileSync } from 'node:child_process';
it.each(['human-approval','access-baseline'])('rejects unreviewed CLI arguments without exposing raw errors: %s',name=>{
 try{execFileSync(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('tools/deploy/'+name+'.ts'),'--invalid-secret-argument'],{encoding:'utf8',stdio:'pipe'});throw Error('Unexpected CLI success');}
 catch(error){const result=error as {status?:number;stdout?:string;stderr?:string};expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toBe(name==='human-approval'?'Production Access verification failed; evidence remains invalid\n':'Automation approval failed; no approval is claimed\n');}
});
