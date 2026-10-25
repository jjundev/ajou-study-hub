import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Catalog } from '../../src/content/model.js';
import type { BuildReport } from '../content/report.js';
import { matchingException, checkBundle, bundleLimits } from '../content/preflight.js';
import { runtimeIssue, type RuntimeException } from '../runtime-exceptions.js';
import { auditWorkbookFigures } from '../runtime-workbooks.js';
import { representativePaths } from '../representatives.js';
import type { Observation } from '../verify-content.js';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const fail=():never=>{throw Error('Incomplete, stale or changed runtime/build proof');};
export function assertRuntimeFresh(manifest:BuildReport,proof:{createdAt:string}):void{
 const age=Date.now()-Date.parse(proof.createdAt);
 if(!Number.isFinite(age)||age<0||age>86400000||Date.parse(proof.createdAt)<Date.parse(manifest.createdAt)||!Number.isFinite(Date.parse(manifest.createdAt)))fail();
}
/** Reconcile evidence with the entire app manifest, never just its success flag. */
export async function assertReleaseProof(root:string,directory:string,manifest:BuildReport,proof:any):Promise<void>{
 const exceptions:RuntimeException[]=JSON.parse(await readFile(resolve(root,'config/content-exceptions.json'),'utf8'));
 const catalog:Catalog=JSON.parse(await readFile(resolve(directory,'catalog.json'),'utf8'));
 assertRuntimeFresh(manifest,proof);
 if(proof.version!==2||!proof.sourceBinding||proof.scope!=='actual-app-runtime'||proof.status!=='complete'||proof.passed!==true||proof.deploymentEligible!==true)fail();
 if(!Array.isArray(manifest.inputs)||!manifest.inputs.length||!Array.isArray(manifest.sources)||!manifest.sources.length||!Array.isArray(manifest.issues)||!same(proof.inputs,manifest.inputs)||!same(proof.sources,manifest.sources)||proof.bundleHash!==manifest.bundleHash||proof.catalogHash!==manifest.outputs.find(f=>f.path==='catalog.json')?.sha256||!same(proof.exceptions,exceptions))fail();
 if(checkBundle(manifest.outputs,bundleLimits).length)fail();
 for(const input of manifest.inputs)if(typeof input.courseId!=='string'||!input.courseId||typeof input.path!=='string'||!input.path||!/^[a-f0-9]{64}$/.test(input.sha256))fail();
 if(new Set(manifest.inputs.map(i=>i.courseId+'\0'+i.path)).size!==manifest.inputs.length)fail();
 for(const source of manifest.sources)if(typeof source.courseId!=='string'||!source.courseId||!/^[a-f0-9]{40}$/.test(source.commit)||typeof source.dirty!=='boolean'||!Array.isArray(source.trackedPaths)||!source.trackedPaths.every(p=>typeof p==='string')||!Array.isArray(source.explicitUntracked)||!source.explicitUntracked.every(p=>typeof p==='string'))fail();
 for(const file of manifest.outputs){
  if(!Number.isSafeInteger(file.size)||file.size<0||!/^([a-f0-9]{64})$/.test(file.sha256)||file.path.includes('\\')||file.path.includes('\0')||file.path.split('/').some(p=>!p||p==='.'||p==='..'||/^\.git$|^\.env|credentials|secrets?\.(?:json|pem)|제작|^backup[-_]|^\.reports$|^\.local$|^_worker\.js$|^\.assetsignore$/i.test(p)))fail();
 }
 for(const issue of manifest.issues){if(issue.severity!=='warning'||!matchingException(issue,exceptions))fail();}
 if(!Array.isArray(catalog.documents)||!catalog.documents.length||new Set(catalog.documents.map(d=>d.id)).size!==catalog.documents.length||proof.documentsChecked!==catalog.documents.length||!Array.isArray(proof.documents)||proof.documents.length!==catalog.documents.length)fail();
 const integrity=proof.integrityChecks;
 if(!integrity||integrity.sourceHashesUnchanged!==true||integrity.bundleBytesUnchanged!==true||integrity.sourceTrackingUnchanged!==true||integrity.inputCount!==manifest.inputs.length||integrity.outputCount!==manifest.outputs.length)fail();
 const seen=new Set<string>();
 for(const doc of catalog.documents)if(typeof doc.url!=='string'||!doc.url.startsWith('/content/')||!manifest.outputs.some(f=>'/'+f.path===decodeURIComponent(doc.url)))fail();
 for(const item of proof.documents){
  const doc=catalog.documents.find(d=>d.id===item.documentId);
  if(!doc||seen.has(item.documentId)||typeof item.title!=='string'||!Number.isSafeInteger(item.images)||item.images<0||!Array.isArray(item.pendingRequests)||item.pendingRequests.length||!Array.isArray(item.responses))fail();
  seen.add(item.documentId);
  if(!item.responses.some((r:any)=>{try{return r.status===200&&decodeURIComponent(new URL(r.url).pathname)===decodeURIComponent(doc!.url);}catch{return false;}}))fail();
 }
 const reps=proof.representatives;
 if(!reps||reps.complete!==true||!Array.isArray(reps.scenarios)||reps.scenarios.length!==representativePaths.length*6||!Array.isArray(reps.observations)||reps.observations.length)fail();
 for(const [courseId,sourcePath] of representativePaths){
  const doc=catalog.documents.find(d=>d.courseId===courseId&&d.sourcePath===sourcePath);if(!doc)fail();
  for(const browser of ['chromium','firefox','webkit'])for(const width of [390,1440]){
   const matches=reps.scenarios.filter((s:any)=>s.documentId===doc!.id&&s.browser===browser&&s.width===width);
   if(matches.length!==1||matches[0].passed!==true||matches[0].error||!Array.isArray(matches[0].checks)||!matches[0].checks.length)fail();
  }
 }
 const dynamic=await auditWorkbookFigures(catalog.documents,async(courseId,path)=>readFile(resolve(directory,'content',courseId,path)),manifest.outputs.map(f=>f.path));
 if(!same(dynamic,proof.dynamicAssets))fail();
 if(!Array.isArray(proof.observations)||!Array.isArray(proof.issues)||!Array.isArray(proof.fontFallbackChecks))fail();
 const computed=proof.observations.map((o:Observation)=>{
  const doc=catalog.documents.find(d=>d.id===o.documentId);if(!doc||o.classification!=='external')fail();
  const issue=runtimeIssue(o,doc!,exceptions);if(issue.severity!=='warning')fail();return issue;
 });
 const unique=computed.filter((i:unknown,n:number)=>computed.findIndex((x:unknown)=>same(x,i))===n);
 if(!same(unique,proof.issues))fail();
 for(const exception of exceptions.filter(e=>e.runtime)){
  const doc=catalog.documents.find(d=>d.courseId===exception.courseId&&d.sourcePath===exception.sourcePath);if(!doc)continue;
  const checks=proof.fontFallbackChecks.filter((c:any)=>c.documentId===doc.id);
  if(checks.length!==1||checks[0].readable!==true||typeof checks[0].source?.text!=='string'||checks[0].source.text.length<=100||checks[0].source.text!==checks[0].copy?.text||![checks[0].source,checks[0].copy].every(s=>s.width>0&&s.height>0&&typeof s.fontStack==='string'&&s.fontStack.includes('sans-serif')))fail();
 }
}
