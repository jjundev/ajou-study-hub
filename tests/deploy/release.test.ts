import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, symlink, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { releasePrivate, parseUploadReceipt } from '../../tools/deploy/release.js';
import { inventory } from '../../tools/deploy/bootstrap.js';
import { settingsFingerprint, type AccessSnapshot } from '../../tools/deploy/access.js';
import { sentinelPaths } from '../../tools/deploy/guard.js';
import { execFileSync } from 'node:child_process';
import { courses } from '../../config/courses.js';
import { inspectBoundSources } from '../../tools/source-binding.js';
import { assertReleaseProof } from '../../tools/deploy/release-proof.js';
import { fixture, settings } from './release-fixture.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
describe('guarded private release (synthetic only)',()=>{
 it('accepts verified experiment PDFs after the former representative HTML is deleted',async()=>{
  const f=await fixture();
  await expect(assertReleaseProof(f.root,f.options.distDir,f.manifest,f.proof)).resolves.toBeUndefined();
 });
 it.each(['missing','wrong-hash','swapped','duplicate-scenario'])('rejects %s experiment download evidence',async kind=>{
  const f=await fixture();
  const scenarios=f.proof.representatives.scenarios;
  const row=scenarios.find((scenario:any)=>scenario.caseId==='logic-lab-experiment-01-downloads');
  if(kind==='missing')row.downloads.pop();
  if(kind==='wrong-hash')row.downloads[0].sha256='a'.repeat(64);
  if(kind==='swapped'){
   const [review,answer]=row.downloads;
   row.downloads=[{...answer,kind:'review'},{...review,kind:'answer'}];
  }
  if(kind==='duplicate-scenario')scenarios[scenarios.length-1]=structuredClone(row);
  await expect(assertReleaseProof(f.root,f.options.distDir,f.manifest,f.proof)).rejects.toThrow();
 });
 it('accepts captured informational external references and separately checks the exact runtime font exception',async()=>{
  const f=await fixture();
  const external={code:'external-reference',courseId:'logic-lab',sourcePath:f.sourcePath,target:'https://cdn.example.test/library.js',reason:'External dependency (not collected)',severity:'warning'};
  const exceptions=JSON.parse(await readFile(resolve('config/content-exceptions.json'),'utf8'));
  const exception=exceptions[0];
  const catalog=JSON.parse(await readFile(resolve(f.options.distDir,'catalog.json'),'utf8'));
  const fontDoc={id:'font-doc',courseId:exception.courseId,sourcePath:exception.sourcePath,url:'/content/'+exception.courseId+'/'+exception.sourcePath.split('/').map(encodeURIComponent).join('/'),listed:false};
  catalog.documents.push(fontDoc);await f.put('dist/catalog.json',catalog);await f.put('dist/'+decodeURIComponent(fontDoc.url.slice(1)),'synthetic font document');
  const manifest={...f.manifest,issues:[external,{...external,target:'//example.test/outbound?x=1#section'}],outputs:await inventory(f.options.distDir)};
  manifest.bundleHash=hash(manifest.outputs.map(x=>`${x.path}\0${x.sha256}\n`).join(''));
  const text='Readable synthetic fallback text. '.repeat(5);
  const proof={...f.proof,bundleHash:manifest.bundleHash,catalogHash:manifest.outputs.find(x=>x.path==='catalog.json')!.sha256,exceptions,
   documentsChecked:catalog.documents.length,documents:[...f.proof.documents,{documentId:fontDoc.id,title:'Font fixture',images:0,pendingRequests:[],responses:[{url:'http://127.0.0.1:1234'+fontDoc.url,status:200}]}],
   observations:[{documentId:fontDoc.id,classification:'external',kind:'requestfailed',target:exception.target,reason:'net::ERR_BLOCKED_BY_ORB'}],
   issues:[{code:'runtime-external-requestfailed',courseId:fontDoc.courseId,sourcePath:fontDoc.sourcePath,target:exception.target,reason:'net::ERR_BLOCKED_BY_ORB; Explicit exception: '+exception.reason,severity:'warning'}],
   fontFallbackChecks:[{documentId:fontDoc.id,readable:true,source:{text,width:400,height:200,fontStack:'Arial, sans-serif'},copy:{text,width:400,height:200,fontStack:'Arial, sans-serif'}}],
   integrityChecks:{...f.proof.integrityChecks,outputCount:manifest.outputs.length}};
  await f.put('config/content-exceptions.json',exceptions);
  await expect(assertReleaseProof(f.root,f.options.distDir,manifest as any,proof)).resolves.toBeUndefined();
  for(const issue of [{...external,code:'unknown-warning'},{...external,severity:'error'},{...external,target:'javascript:alert(1)'},{...external,target:'https://user:secret@example.test/a'},{...external,reason:'fetch failed'},{...external,sourcePath:'not-captured.css'}])
   await expect(assertReleaseProof(f.root,f.options.distDir,{...manifest,issues:[issue]} as any,proof)).rejects.toThrow();
  await expect(assertReleaseProof(f.root,f.options.distDir,manifest as any,{...proof,observations:[{...proof.observations[0],reason:'net::ERR_FAILED'}]})).rejects.toThrow();
  await expect(assertReleaseProof(f.root,f.options.distDir,manifest as any,{...proof,observations:[{...proof.observations[0],target:'https://cdn.example.test/broken.js'}]})).rejects.toThrow();
 });
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
