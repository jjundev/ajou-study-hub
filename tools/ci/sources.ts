import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { courses } from '../../config/courses.js';
import { inspectBoundSources } from '../source-binding.js';
export type Revision = {courseId:string; repository:string; sha:string; root:string};
export type SourceSnapshot = {version:1; appSha:string; revisions:Revision[]; inputFingerprint:string; settingsPath:string};
const sourceCodes=['CI_SOURCE_OPERATION_FAILED','CI_SOURCE_COMMAND_INVALID','CI_BIND_INPUT_FAILED','CI_BIND_APP_SHA_INVALID','CI_BIND_REVISIONS_INVALID','CI_BIND_PROJECT_ROOT_FAILED','CI_BIND_ROOT_FAILED','CI_BIND_ROOT_OVERLAP','CI_BIND_ORIGIN_FAILED','CI_BIND_HEAD_FAILED','CI_BIND_STATUS_FAILED','CI_BIND_SOURCE_DIRTY','CI_BIND_OUTPUT_FAILED','CI_BIND_INSPECTION_FAILED','CI_BIND_PROVENANCE_FAILED'] as const;
type BindCode=typeof sourceCodes[number];
type SafeDiagnostic={code:BindCode;courseId?:string};
const diagnostics=new WeakMap<object,SafeDiagnostic>();
export class SourceBindError extends Error {
 readonly safeCode:BindCode;
 readonly courseId?:string;
 constructor(code:BindCode,message:string,courseId?:string){
  super(message);
  this.safeCode=sourceCodes.includes(code)?code:'CI_SOURCE_OPERATION_FAILED';
  this.courseId=courses.find(course=>course.id===courseId)?.id;
  diagnostics.set(this,{code:this.safeCode,...(this.courseId?{courseId:this.courseId}:{})});
 }
}
/** Only internally registered, whitelisted fields survive; never read error properties. */
export function formatSourceOperationDiagnostic(error:unknown):string {
 const known=error!==null&&(typeof error==='object'||typeof error==='function')?diagnostics.get(error):undefined;
 return JSON.stringify(known??{code:'CI_SOURCE_OPERATION_FAILED'})+'\n';
}
/** Replace even raw child-process/filesystem exceptions at their stage boundary. */
async function bindingStage<T>(code:BindCode,message:string,courseId:string|undefined,operation:()=>Promise<T>):Promise<T>{
 try{return await operation();}catch{throw new SourceBindError(code,message,courseId);}
}
const exec=promisify(execFile);
const shaPattern=/^[a-f0-9]{40}$/;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const contains=(root:string,path:string)=>{const rel=relative(root,path);return !rel||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));};
async function git(root:string,...args:string[]){
 try{return (await exec('git',args,{cwd:root,encoding:'utf8',maxBuffer:20*1024*1024})).stdout.trim();}
 catch{throw Error('Cannot inspect source repository');}
}
export async function resolveRevisions(request:typeof fetch,token:string):Promise<Omit<Revision,'root'>[]>{
 if(!token.trim())throw Error('Source read token required');
 const revisions:Omit<Revision,'root'>[]=[];
 for(const course of courses){
  let response:Response;
  try{response=await request(`https://api.github.com/repos/${course.repo}/git/ref/heads/main`,{redirect:'error',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});}
  catch{throw Error('Source revision request failed');}
  if(response.status!==200||response.redirected)throw Error('Source revision request rejected');
  let value:unknown;try{value=await response.json();}catch{throw Error('Invalid source revision response');}
  if(!record(value)||value.ref!=='refs/heads/main'||!record(value.object)||value.object.type!=='commit'||typeof value.object.sha!=='string'||!shaPattern.test(value.object.sha))throw Error('Invalid source revision response');
  revisions.push({courseId:course.id,repository:course.repo,sha:value.object.sha});
 }
 return revisions;
}
function validatedRevisions(value:unknown):Revision[]{
 if(!Array.isArray(value)||value.length!==courses.length)throw new SourceBindError('CI_BIND_REVISIONS_INVALID','Exactly five sources required');
 const result:Revision[]=[];
 for(const course of courses){
  const matches=value.filter(r=>record(r)&&r.courseId===course.id);
  if(matches.length!==1)throw new SourceBindError('CI_BIND_REVISIONS_INVALID','Missing or duplicate source');
  const revision=matches[0];
  if(!record(revision)||Object.keys(revision).sort().join(',')!=='courseId,repository,root,sha'||revision.repository!==course.repo||typeof revision.sha!=='string'||!shaPattern.test(revision.sha)||typeof revision.root!=='string'||!revision.root.trim())throw new SourceBindError('CI_BIND_REVISIONS_INVALID','Invalid source revision',course.id);
  result.push({courseId:course.id,repository:course.repo,sha:revision.sha,root:revision.root});
 }
 return result;
}
async function outputPath(project:string,directory:string){
 const parent=resolve(project,directory);await mkdir(parent,{recursive:true});
 if((await lstat(parent)).isSymbolicLink()||await realpath(parent)!==parent)throw Error('Unsafe CI output directory');
 const target=resolve(parent,'ci-sources.json');
 try{const stat=await lstat(target);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Unsafe CI output file');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return target;
}
export async function bindSources(project:string,appSha:string,revisions:Revision[]):Promise<SourceSnapshot>{
 if(typeof appSha!=='string'||!shaPattern.test(appSha))throw new SourceBindError('CI_BIND_APP_SHA_INVALID','Invalid app SHA');
 const projectRoot=await bindingStage('CI_BIND_PROJECT_ROOT_FAILED','Cannot inspect project root',undefined,()=>realpath(project)),ordered=validatedRevisions(revisions),roots=new Set<string>();
 for(const revision of ordered){
  const root=await bindingStage('CI_BIND_ROOT_FAILED','Invalid source root ownership',revision.courseId,async()=>{
   const requested=resolve(projectRoot,revision.root),root=await realpath(requested);
   if(root!==requested||roots.has(root)||await realpath(await git(root,'rev-parse','--show-toplevel'))!==root)throw Error();
   return root;
  });
  for(const dir of ['.local','.reports'])if(contains(root,resolve(projectRoot,dir))||contains(resolve(projectRoot,dir),root))throw new SourceBindError('CI_BIND_ROOT_OVERLAP','Source overlaps CI output',revision.courseId);
  await bindingStage('CI_BIND_ORIGIN_FAILED','Source repository ownership mismatch',revision.courseId,async()=>{
   const origin=await git(root,'remote','get-url','origin');
   if(![`https://github.com/${revision.repository}`,`https://github.com/${revision.repository}.git`,`git@github.com:${revision.repository}`,`git@github.com:${revision.repository}.git`].includes(origin))throw Error();
  });
  await bindingStage('CI_BIND_HEAD_FAILED','Source is dirty or HEAD moved',revision.courseId,async()=>{if(await git(root,'rev-parse','HEAD')!==revision.sha)throw Error();});
  const status=await bindingStage('CI_BIND_STATUS_FAILED','Cannot inspect source repository',revision.courseId,()=>git(root,'status','--porcelain','--untracked-files=all'));
  if(status)throw new SourceBindError('CI_BIND_SOURCE_DIRTY','Source is dirty or HEAD moved',revision.courseId);
  roots.add(root);revision.root=root;
 }
 const [settingsPath,reportPath]=await bindingStage('CI_BIND_OUTPUT_FAILED','Unsafe CI output directory or file',undefined,async()=>[await outputPath(projectRoot,'.local'),await outputPath(projectRoot,'.reports')] as const);
 await bindingStage('CI_BIND_OUTPUT_FAILED','Cannot write CI source settings',undefined,()=>writeFile(settingsPath,JSON.stringify({roots:Object.fromEntries(ordered.map(r=>[r.courseId,r.root])),explicitUntracked:{}},null,2)+'\n'));
 const inspected=await bindingStage('CI_BIND_INSPECTION_FAILED','Cannot inspect bound sources',undefined,()=>inspectBoundSources(projectRoot,settingsPath));
 const changed=inspected.snapshot.provenance.find(p=>p.dirty||p.commit!==ordered.find(r=>r.courseId===p.courseId)?.sha);
 if(changed)throw new SourceBindError('CI_BIND_PROVENANCE_FAILED','Source changed during binding',courses.find(c=>c.id===changed.courseId)?.id);
 const fingerprintInputs=ordered.map(({courseId,repository,sha})=>({courseId,repository,sha})).sort((a,b)=>a.courseId.localeCompare(b.courseId));
 const inputFingerprint=createHash('sha256').update(JSON.stringify({appSha,revisions:fingerprintInputs})).digest('hex');
 const snapshot:SourceSnapshot={version:1,appSha,revisions:ordered,inputFingerprint,settingsPath};
 await bindingStage('CI_BIND_OUTPUT_FAILED','Cannot write CI source report',undefined,()=>writeFile(reportPath,JSON.stringify(snapshot,null,2)+'\n'));return snapshot;
}
