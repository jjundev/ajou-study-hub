import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { inventory } from '../../tools/deploy/bootstrap.js';
import { settingsFingerprint, type AccessSnapshot } from '../../tools/deploy/access.js';
import { sentinelPaths } from '../../tools/deploy/guard.js';
import { representativePaths } from '../../tools/representatives.js';
import { execFileSync } from 'node:child_process';
import { courses } from '../../config/courses.js';
import { inspectBoundSources } from '../../tools/source-binding.js';
export const settings={accountId:'a'.repeat(32),workerName:'ajou-study-hub',allowedEmail:'owner@example.test',accessAppId:'11111111-1111-1111-1111-111111111111',productionUrl:'https://ajou-study-hub.example.workers.dev',previewUrls:[]};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const roots:string[]=[];
const template=resolve('.generated/verification-tests',randomUUID());
beforeAll(async()=>{
 await mkdir(resolve(template,'복습노트/1024'),{recursive:true});
 await writeFile(resolve(template,'복습노트/1024/test.html'),'synthetic');
 const git=(...args:string[])=>execFileSync('git',args,{cwd:template,stdio:'pipe'});
 git('init','-q');git('add','.');
 // Configure the commit itself instead of paying for two extra Git startups.
 git('-c','user.email=fixture@example.invalid','-c','user.name=Fixture','commit','-qm','fixture');
});
afterAll(async()=>{await rm(template,{recursive:true,force:true});});
afterEach(async()=>{for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true});});
export async function fixture(){
 const root=resolve('.generated/verification-tests',randomUUID());roots.push(root);
 async function put(path:string,value:unknown){await mkdir(dirname(resolve(root,path)),{recursive:true});await writeFile(resolve(root,path),typeof value==='string'?value:JSON.stringify(value));}
 const docs=representativePaths.map(([courseId,sourcePath],i)=>({id:'doc-'+i,courseId,sourcePath,url:'/content/'+courseId+'/'+sourcePath.split('/').map(encodeURIComponent).join('/'),listed:true}));
 await put('dist/index.html','app');await put('dist/assets/app.js','app');await put('dist/catalog.json',{groups:[],documents:docs});
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
 const snapshot:AccessSnapshot={...settings,allowedEmails:[settings.allowedEmail],workerWide:true,hasBypass:false,hosts:[settings.productionUrl],freePlan:true,fingerprint:hash('policy'),authDomain:'team.cloudflareaccess.com',otpProviderId:'otp-id'};
 await put('.reports/access-evidence.json',{version:2,method:'independent-identity-policy-and-nondisclosure',ownerIdentityHash:'1'.repeat(64),otherIdentityHash:'2'.repeat(64),policyChecksHash:'3'.repeat(64),...settings,checkedAt:new Date().toISOString(),settingsFingerprint:settingsFingerprint(settings),policyFingerprint:snapshot.fingerprint,hosts:snapshot.hosts,anonymousBlocked:true,otherAccountBlocked:true,ownerAllowed:true,sentinelHashes:Object.fromEntries(sentinelPaths.map(p=>[p,hash(p)]))});
 const upload=vi.fn(async(_directory:string):Promise<{url:string;versionId:string}>=>({url:settings.productionUrl,versionId:randomUUID()}));const readAccessSnapshot=vi.fn(async()=>structuredClone(snapshot));
 const options={settings:structuredClone(settings),distDir:resolve(root,'dist'),reportPath:resolve(root,'.reports/app-build.json'),testProjectRoot:root};
 return {root,put,proof,manifest,options,upload,readAccessSnapshot,snapshot,source,sourcePath,sourceSettings,git};
}
