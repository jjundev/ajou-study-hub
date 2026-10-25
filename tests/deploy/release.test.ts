import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, symlink, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { releasePrivate, parseUploadReceipt } from '../../tools/deploy/release.js';
import { inventory } from '../../tools/deploy/bootstrap.js';
import { settingsFingerprint, type AccessSnapshot } from '../../tools/deploy/access.js';
import { sentinelPaths } from '../../tools/deploy/guard.js';
import { representativePaths } from '../../tools/representatives.js';
import { execFileSync } from 'node:child_process';
import { courses } from '../../config/courses.js';
import { inspectBoundSources } from '../../tools/source-binding.js';
const settings={accountId:'a'.repeat(32),workerName:'ajou-study-hub',allowedEmail:'owner@example.test',accessAppId:'11111111-1111-1111-1111-111111111111',productionUrl:'https://ajou-study-hub.example.workers.dev',previewUrls:[]};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const roots:string[]=[];
const template=resolve('.generated/verification-tests',randomUUID());
beforeAll(async()=>{await mkdir(resolve(template,'복습노트/1024'),{recursive:true});await writeFile(resolve(template,'복습노트/1024/test.html'),'synthetic');const git=(...args:string[])=>execFileSync('git',args,{cwd:template,stdio:'pipe'});git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');git('add','.');git('commit','-qm','fixture');});
afterAll(async()=>{await rm(template,{recursive:true,force:true});});
afterEach(async()=>{for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=resolve('.generated/verification-tests',randomUUID());roots.push(root);
 async function put(path:string,value:unknown){await mkdir(dirname(resolve(root,path)),{recursive:true});await writeFile(resolve(root,path),typeof value==='string'?value:JSON.stringify(value));}
 const docs=representativePaths.map(([courseId,sourcePath],i)=>({id:'doc-'+i,courseId,sourcePath,url:'/content/'+courseId+'/'+sourcePath.split('/').map(encodeURIComponent).join('/'),listed:true}));
 await put('dist/index.html','app');await put('dist/assets/app.js','app');await put('dist/catalog.json',{documents:docs});
 for(const doc of docs)await put('dist/'+decodeURIComponent(doc.url.slice(1)),'synthetic html');
 await put('.local/deployment.json',settings);await put('wrangler.jsonc',{name:'ajou-study-hub',compatibility_date:'2026-10-24',assets:{directory:'./dist',html_handling:'none',not_found_handling:'404-page'}});await put('config/content-exceptions.json',[]);
 const outputs=await inventory(resolve(root,'dist')),bundleHash=hash(outputs.map(f=>`${f.path}\0${f.sha256}\n`).join(''));
 const source=resolve(root,'source'),sourcePath='복습노트/1024/test.html';await put('source/'+sourcePath,'synthetic');
 const git=(...args:string[])=>execFileSync('git',args,{cwd:source,stdio:'pipe'});
 await cp(resolve(template,'.git'),resolve(source,'.git'),{recursive:true});
 const sourceSettings={roots:Object.fromEntries(courses.map(c=>[c.id,source])),explicitUntracked:{}};await put('.local/sources.json',sourceSettings);
 const {snapshot:current,binding:sourceBinding}=await inspectBoundSources(root,'.local/sources.json');
 const manifest={createdAt:new Date().toISOString(),sources:current.provenance,inputs:[{courseId:'logic-lab',path:sourcePath,sha256:hash('synthetic')}],outputs,bundleHash,issues:[]};
 await put('.reports/app-build.json',manifest);
 const proof:any={version:2,scope:'actual-app-runtime',status:'complete',createdAt:new Date().toISOString(),passed:true,deploymentEligible:true,documentsChecked:docs.length,bundleHash,catalogHash:outputs.find(f=>f.path==='catalog.json')!.sha256,inputs:manifest.inputs,sources:manifest.sources,issues:[],observations:[],exceptions:[],fontFallbackChecks:[],documents:docs.map(doc=>({documentId:doc.id,title:'synthetic',images:0,pendingRequests:[],responses:[{url:'http://127.0.0.1:1234'+doc.url,status:200}]})),integrityChecks:{sourceHashesUnchanged:true,bundleBytesUnchanged:true,sourceTrackingUnchanged:true,inputCount:1,outputCount:outputs.length},representatives:{complete:true,observations:[],scenarios:docs.flatMap(doc=>['chromium','firefox','webkit'].flatMap(browser=>[390,1440].map(width=>({documentId:doc.id,browser,width,passed:true,checks:['synthetic']}))))},dynamicAssets:{workbooks:0,figures:[]}};
 await put('.reports/verification.json',proof);
 proof.sourceBinding=sourceBinding;await put('.reports/verification.json',proof);
 const snapshot:AccessSnapshot={...settings,allowedEmails:[settings.allowedEmail],workerWide:true,hasBypass:false,hosts:[settings.productionUrl],freePlan:true,fingerprint:hash('policy'),authDomain:'team.cloudflareaccess.com'};
 await put('.reports/access-evidence.json',{...settings,checkedAt:new Date().toISOString(),settingsFingerprint:settingsFingerprint(settings),policyFingerprint:snapshot.fingerprint,hosts:snapshot.hosts,anonymousBlocked:true,otherAccountBlocked:true,ownerAllowed:true,sentinelHashes:Object.fromEntries(sentinelPaths.map(p=>[p,hash(p)]))});
 const upload=vi.fn(async(_directory:string):Promise<{url:string;versionId:string}>=>({url:settings.productionUrl,versionId:randomUUID()}));const readAccessSnapshot=vi.fn(async()=>structuredClone(snapshot));
 const options={settings:structuredClone(settings),distDir:resolve(root,'dist'),reportPath:resolve(root,'.reports/app-build.json'),testProjectRoot:root};
 return {root,put,proof,manifest,options,upload,readAccessSnapshot,snapshot,source,sourcePath,sourceSettings,git};
}
describe('guarded private release (synthetic only)',()=>{
 for(const checkpoint of ['initial','second'] as const)it.each(['bytes','deletion','tracking','selection','explicitUntracked','settings-bytes','root-switch'])('blocks current source %s mutation at '+checkpoint,async kind=>{
  const f=await fixture();const mutate=async()=>{
   if(kind==='bytes')await f.put('source/'+f.sourcePath,'changed');
   if(kind==='deletion')await rm(resolve(f.source,f.sourcePath));
   if(kind==='tracking')f.git('rm','--cached','--',f.sourcePath);
   if(kind==='selection'){await f.put('source/복습노트/1025/new.html','new');f.git('add','.');}
   if(kind==='explicitUntracked')await f.put('.local/sources.json',{...f.sourceSettings,explicitUntracked:{'logic-lab':['복습노트/1025/new.html']}});
   if(kind==='settings-bytes')await f.put('.local/sources.json',JSON.stringify(f.sourceSettings)+'\n');
   if(kind==='root-switch')await f.put('.local/sources.json',{...f.sourceSettings,roots:{...f.sourceSettings.roots,'logic-lab':resolve(f.root,'unverified-checkout')}});
  };
  if(checkpoint==='initial')await mutate();else{let calls=0;f.readAccessSnapshot.mockImplementation(async()=>{if(++calls===2)await mutate();return structuredClone(f.snapshot);});}
  await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();
 });
 it.each(['.envrc','nested/.ENVproduction'])('rejects freshly rehashed environment prefix %s',async path=>{const f=await fixture();await f.put('dist/'+path,'secret');f.manifest.outputs=await inventory(f.options.distDir);f.manifest.bundleHash=hash(f.manifest.outputs.map(x=>`${x.path}\0${x.sha256}\n`).join(''));f.proof.bundleHash=f.manifest.bundleHash;f.proof.integrityChecks.outputCount=f.manifest.outputs.length;await f.put('.reports/app-build.json',f.manifest);await f.put('.reports/verification.json',f.proof);await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();});
 it('rejects runtime proof which expires during staging',async()=>{const f=await fixture();const now=Date.now();f.proof.createdAt=new Date(now-86400000+30000).toISOString();f.manifest.createdAt=f.proof.createdAt;await f.put('.reports/app-build.json',f.manifest);await f.put('.reports/verification.json',f.proof);let calls=0;const spy=vi.spyOn(Date,'now').mockReturnValue(now);f.readAccessSnapshot.mockImplementation(async()=>{if(++calls===2)spy.mockReturnValue(now+60000);return structuredClone(f.snapshot);});try{await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();}finally{spy.mockRestore();}});
 it.each(['unverified','stale','dynamic','hash','incomplete-docs','incomplete-scenarios','unknown-warning','inputs','content-only','pending-requests'])('never uploads with %s proof',async kind=>{
  const f=await fixture();
  if(kind==='unverified')f.proof.deploymentEligible=false;
  if(kind==='stale')f.proof.createdAt='2020-01-01T00:00:00Z';
  if(kind==='dynamic')f.proof.dynamicAssets.figures=['content/missing.png'];
  if(kind==='hash')f.proof.bundleHash='a'.repeat(64);
  if(kind==='incomplete-docs')f.proof.documents.pop();
  if(kind==='incomplete-scenarios')f.proof.representatives.scenarios.pop();
  if(kind==='unknown-warning')f.proof.issues=[{severity:'warning',code:'unknown'}];
  if(kind==='inputs')f.proof.inputs=[];
  if(kind==='content-only')f.options.reportPath=resolve(f.root,'.reports/output.json');
  if(kind==='pending-requests')f.proof.documents[0].pendingRequests=['unfinished'];
  await f.put('.reports/verification.json',f.proof);await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();
 });
 it.each(['bytes','extra','limit','forbidden','main','routes','run_worker_first','settings','protection'])('never uploads after %s change',async kind=>{
  const f=await fixture();
  if(kind==='bytes')await f.put('dist/index.html','changed');
  if(kind==='extra')await f.put('dist/extra.html','extra');
  if(kind==='limit')f.manifest.outputs[0]!.size=26*1024*1024;
  if(kind==='forbidden')await f.put('dist/.env.local','secret');
  if(['main','routes','run_worker_first'].includes(kind))await f.put('wrangler.jsonc',{[kind]:'bad'});
  if(kind==='settings')await f.put('.local/deployment.json',{...settings,allowedEmail:'changed@example.test'});
  if(kind==='protection')await f.put('.reports/access-evidence.json',{ownerAllowed:false});
  await f.put('.reports/app-build.json',f.manifest);await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();
 });
 it.each(['policy','hosts','free','settings','proof','config','dist'])('rechecks %s immediately before upload',async kind=>{
  const f=await fixture();let calls=0;
  f.readAccessSnapshot.mockImplementation(async()=>{calls++;if(calls===2){if(kind==='policy')return {...f.snapshot,fingerprint:hash('changed')};if(kind==='hosts')return {...f.snapshot,hosts:['https://changed.workers.dev']};if(kind==='free')return {...f.snapshot,freePlan:false};if(kind==='settings')await f.put('.local/deployment.json',{...settings,allowedEmail:'changed@example.test'});if(kind==='proof')await f.put('.reports/verification.json',{passed:false});if(kind==='config')await f.put('wrangler.jsonc',{main:'bad'});if(kind==='dist')await f.put('dist/index.html','changed');}return structuredClone(f.snapshot);});
  await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();
 });
 it('uploads an owned copy of every verified byte despite concurrent rebuild/config mutation, records pending acceptance',async()=>{
  const f=await fixture();f.upload.mockImplementation(async(directory?:string)=>{expect(directory).not.toBe(f.options.distDir);expect(await inventory(directory!)).toEqual(f.manifest.outputs);const configPath=resolve(directory!,'../wrangler.json');const sealedConfig=await readFile(configPath,'utf8');expect(JSON.parse(sealedConfig)).toEqual({name:settings.workerName,account_id:settings.accountId,compatibility_date:'2026-10-24',workers_dev:true,preview_urls:false,assets:{directory,html_handling:'none',not_found_handling:'404-page'}});await f.put('dist/index.html','rebuild');await f.put('wrangler.jsonc',{main:'changed.js'});expect(await inventory(directory!)).toEqual(f.manifest.outputs);expect(await readFile(configPath,'utf8')).toBe(sealedConfig);return {url:settings.productionUrl,versionId:'12345678-1234-1234-1234-123456789abc'};});
  expect(await releasePrivate(f.options,f)).toMatchObject({url:settings.productionUrl,bundleHash:f.manifest.bundleHash});expect(f.readAccessSnapshot).toHaveBeenCalledTimes(2);const receipt=JSON.parse(await readFile(resolve(f.root,'.reports/private-release.json'),'utf8'));expect(receipt.status).toBe('uploaded-acceptance-pending');expect(receipt.acceptanceComplete).toBe(false);
 });
 it.each([{url:'https://unverified.workers.dev',versionId:randomUUID()},{url:settings.productionUrl,versionId:'unknown'}])('refuses invalid upload receipts',async receipt=>{const f=await fixture();f.upload.mockResolvedValue(receipt);await expect(releasePrivate(f.options,f)).rejects.toThrow();});
 it('rejects truthy non-boolean protection evidence',async()=>{const f=await fixture();const path='.reports/access-evidence.json';const evidence=JSON.parse(await readFile(resolve(f.root,path),'utf8'));evidence.anonymousBlocked='yes';await f.put(path,evidence);await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();});
 it('rejects symlink directories without following them',async()=>{const f=await fixture();await symlink(resolve(f.root,'config'),resolve(f.root,'dist/linked'),process.platform==='win32'?'junction':'dir');await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();});
 it('rejects stale Access evidence',async()=>{const f=await fixture();const path='.reports/access-evidence.json';const evidence=JSON.parse(await readFile(resolve(f.root,path),'utf8'));evidence.checkedAt='2020-01-01T00:00:00Z';await f.put(path,evidence);await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();});
 it('rejects manifest static errors despite passing runtime flags',async()=>{const f=await fixture();await f.put('.reports/app-build.json',{...f.manifest,issues:[{severity:'error',code:'unresolved-reference'}]});await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();});
 it('rejects a freshly rehashed forbidden manifest file',async()=>{const f=await fixture();await f.put('dist/.env.local','secret');f.manifest.outputs=await inventory(f.options.distDir);f.manifest.bundleHash=hash(f.manifest.outputs.map(x=>`${x.path}\0${x.sha256}\n`).join(''));f.proof.bundleHash=f.manifest.bundleHash;f.proof.integrityChecks.outputCount=f.manifest.outputs.length;await f.put('.reports/app-build.json',f.manifest);await f.put('.reports/verification.json',f.proof);await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();});
 it('parses installed Wrangler Current Version ID contract and requires the exact production URL',()=>{const id=randomUUID();const output=`Deployed ajou-study-hub triggers (1 sec)\n  ${settings.productionUrl}\nCurrent Version ID: ${id}\n`;expect(parseUploadReceipt(output,settings.productionUrl)).toEqual({url:settings.productionUrl,versionId:id});expect(()=>parseUploadReceipt('Uploaded successfully',settings.productionUrl)).toThrow();expect(()=>parseUploadReceipt(output+'https://unexpected.example.test\n',settings.productionUrl)).toThrow();});
});
