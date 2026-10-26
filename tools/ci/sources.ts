import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { courses } from '../../config/courses.js';
import { inspectBoundSources } from '../source-binding.js';
export type Revision = {courseId:string; repository:string; sha:string; root:string};
export type SourceSnapshot = {version:1; appSha:string; revisions:Revision[]; inputFingerprint:string; settingsPath:string};
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
 if(!Array.isArray(value)||value.length!==courses.length)throw Error('Exactly five sources required');
 const result:Revision[]=[];
 for(const course of courses){
  const matches=value.filter(r=>record(r)&&r.courseId===course.id);
  if(matches.length!==1)throw Error('Missing or duplicate source');
  const revision=matches[0];
  if(!record(revision)||Object.keys(revision).sort().join(',')!=='courseId,repository,root,sha'||revision.repository!==course.repo||typeof revision.sha!=='string'||!shaPattern.test(revision.sha)||typeof revision.root!=='string'||!revision.root.trim())throw Error('Invalid source revision');
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
 if(typeof appSha!=='string'||!shaPattern.test(appSha))throw Error('Invalid app SHA');
 const projectRoot=await realpath(project),ordered=validatedRevisions(revisions),roots=new Set<string>();
 for(const revision of ordered){
  const requested=resolve(projectRoot,revision.root),root=await realpath(requested);
  if(root!==requested||roots.has(root)||await realpath(await git(root,'rev-parse','--show-toplevel'))!==root)throw Error('Invalid source root ownership');
  for(const dir of ['.local','.reports'])if(contains(root,resolve(projectRoot,dir))||contains(resolve(projectRoot,dir),root))throw Error('Source overlaps CI output');
  const origin=await git(root,'remote','get-url','origin');
  if(![`https://github.com/${revision.repository}`,`https://github.com/${revision.repository}.git`,`git@github.com:${revision.repository}`,`git@github.com:${revision.repository}.git`].includes(origin))throw Error('Source repository ownership mismatch');
  if(await git(root,'rev-parse','HEAD')!==revision.sha||await git(root,'status','--porcelain','--untracked-files=all'))throw Error('Source is dirty or HEAD moved');
  roots.add(root);revision.root=root;
 }
 const settingsPath=await outputPath(projectRoot,'.local'),reportPath=await outputPath(projectRoot,'.reports');
 await writeFile(settingsPath,JSON.stringify({roots:Object.fromEntries(ordered.map(r=>[r.courseId,r.root])),explicitUntracked:{}},null,2)+'\n');
 const inspected=await inspectBoundSources(projectRoot,settingsPath);
 if(inspected.snapshot.provenance.some(p=>p.dirty||p.commit!==ordered.find(r=>r.courseId===p.courseId)?.sha))throw Error('Source changed during binding');
 const fingerprintInputs=ordered.map(({courseId,repository,sha})=>({courseId,repository,sha})).sort((a,b)=>a.courseId.localeCompare(b.courseId));
 const inputFingerprint=createHash('sha256').update(JSON.stringify({appSha,revisions:fingerprintInputs})).digest('hex');
 const snapshot:SourceSnapshot={version:1,appSha,revisions:ordered,inputFingerprint,settingsPath};
 await writeFile(reportPath,JSON.stringify(snapshot,null,2)+'\n');return snapshot;
}
