import { execFile } from 'node:child_process';
import { lstat, readFile, readdir, realpath, statfs } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { courses } from '../../config/courses.js';
import { authorizedRoots, selected, type SourceSelection } from './sparse-source.js';
export type SourceMetrics={files:number;totalBytes:number;maxFileBytes:number;freeBytes:number};
const codes=['CI_SOURCE_DISK_LIMIT','CI_SOURCE_FILE_COUNT_LIMIT','CI_SOURCE_MAX_FILE_LIMIT','CI_SOURCE_TOTAL_BYTES_LIMIT','CI_SOURCE_UNSUPPORTED_ENTRY','CI_SOURCE_SELECTION_MISMATCH','CI_SOURCE_PROVENANCE_INVALID','CI_SOURCE_INSPECTION_FAILED','CI_SOURCE_LIMITS_PASSED'] as const;
class SourceFailure extends Error{}
function reject(code:typeof codes[number]):never{throw new SourceFailure(code);}
const bounded=(value:number)=>Number.isFinite(value)&&value>=0?Math.min(Math.floor(value),Number.MAX_SAFE_INTEGER):0;
export function checkFileLimit(metrics:SourceMetrics,size:number):void{
 if(!Number.isSafeInteger(size)||size<0)reject('CI_SOURCE_INSPECTION_FAILED');
 metrics.files++;metrics.totalBytes+=size;metrics.maxFileBytes=Math.max(metrics.maxFileBytes,size);
 if(metrics.files>100000)reject('CI_SOURCE_FILE_COUNT_LIMIT');
 if(size>256*1024**2)reject('CI_SOURCE_MAX_FILE_LIMIT');
 if(metrics.totalBytes>3*1024**3)reject('CI_SOURCE_TOTAL_BYTES_LIMIT');
}
export function checkFreeSpace(metrics:SourceMetrics,free:bigint):void{
 metrics.freeBytes=bounded(Number(free>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):free));
 if(free<4n*1024n**3n)reject('CI_SOURCE_DISK_LIMIT');
}
export function formatSourceDiagnostic(error:unknown,metrics:SourceMetrics):string{
 const code=error===null?'CI_SOURCE_LIMITS_PASSED':error instanceof SourceFailure&&codes.includes(error.message as typeof codes[number])?error.message:'CI_SOURCE_INSPECTION_FAILED';
 return JSON.stringify({code,files:bounded(metrics.files),totalBytes:bounded(metrics.totalBytes),maxFileBytes:bounded(metrics.maxFileBytes),freeBytes:bounded(metrics.freeBytes)})+'\n';
}
const exec=promisify(execFile);
async function git(root:string,...args:string[]):Promise<string>{
 try{const result=await exec('git',args,{cwd:root,encoding:'buffer',maxBuffer:32*1024**2,timeout:30000});return new TextDecoder('utf-8',{fatal:true}).decode(result.stdout);}
 catch{reject('CI_SOURCE_PROVENANCE_INVALID');}
}
/** Compare the complete stage-0 index with the fixed tree, then the physical selected file set.
 * Git objects and root .git metadata are intentionally not material files. */
export async function assertSourceWorktree(root:string,sha:string,config:SourceSelection,metrics:SourceMetrics):Promise<void>{
 const roots=authorizedRoots(config);
 if(!/^[a-f0-9]{40}$/.test(sha)||await realpath(root)!==root||(await lstat(root)).isSymbolicLink()||(await git(root,'rev-parse','HEAD')).trim()!==sha)reject('CI_SOURCE_PROVENANCE_INVALID');
 const tree=await git(root,'ls-tree','-r','-z','--full-tree',sha),index=await git(root,'ls-files','--stage','-z');
 const expected=new Set<string>(),treeEntries=new Map<string,string>();
 for(const row of tree.split('\0').filter(Boolean)){
  const match=/^(\d{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);if(!match)reject('CI_SOURCE_PROVENANCE_INVALID');
  const [,mode,,hash,path]=match;
  if(treeEntries.has(path))reject('CI_SOURCE_PROVENANCE_INVALID');treeEntries.set(path,mode+' '+hash);
  if(selected(path,roots)){
   if(mode!=='100644'&&mode!=='100755')reject('CI_SOURCE_UNSUPPORTED_ENTRY');
   if(path.split('/').some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.git')||/[\\\x00-\x1f\x7f]/.test(path))reject('CI_SOURCE_SELECTION_MISMATCH');
   expected.add(path);
  }
 }
 for(const row of index.split('\0').filter(Boolean)){
  const match=/^(\d{6}) ([a-f0-9]{40}) 0\t([\s\S]+)$/.exec(row);if(!match)reject('CI_SOURCE_PROVENANCE_INVALID');
  const [,mode,hash,path]=match;if(treeEntries.get(path)!==mode+' '+hash)reject('CI_SOURCE_PROVENANCE_INVALID');treeEntries.delete(path);
 }
 if(treeEntries.size)reject('CI_SOURCE_PROVENANCE_INVALID');
 const directories=new Set<string>();for(const path of expected){const parts=path.split('/');for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/'));}
 const walk=async(directory:string,prefix=''):Promise<void>=>{
  for(const item of await readdir(directory,{withFileTypes:true})){
   if(!prefix&&item.name==='.git')continue;
   const path=prefix?prefix+'/'+item.name:item.name,target=resolve(directory,item.name),stat=await lstat(target);
   if(stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory())reject('CI_SOURCE_UNSUPPORTED_ENTRY');
   if(stat.isDirectory()){
    if(!directories.has(path))reject('CI_SOURCE_SELECTION_MISMATCH');await walk(target,path);
   }else{
    checkFileLimit(metrics,stat.size);
    if(!expected.delete(path))reject('CI_SOURCE_SELECTION_MISMATCH');
   }
  }
 };
 await walk(root);if(expected.size)reject('CI_SOURCE_SELECTION_MISMATCH');
}
export async function checkSourceLimits(project:string,revisions:unknown,metrics:SourceMetrics):Promise<void>{
 const disk=await statfs(project,{bigint:true});checkFreeSpace(metrics,disk.bavail*disk.bsize);
 if(!Array.isArray(revisions)||revisions.length!==courses.length)reject('CI_SOURCE_PROVENANCE_INVALID');
 const sources=resolve(project,'../sources');
 if((await lstat(sources)).isSymbolicLink()||await realpath(sources)!==sources)reject('CI_SOURCE_UNSUPPORTED_ENTRY');
 const actual=await readdir(sources);if(actual.length!==courses.length||actual.some(id=>!courses.some(course=>course.id===id)))reject('CI_SOURCE_SELECTION_MISMATCH');
 for(const course of courses){
  const matches=revisions.filter(value=>value&&typeof value==='object'&&value.courseId===course.id),revision=matches[0];
  if(matches.length!==1||Object.keys(revision).sort().join(',')!=='courseId,repository,root,sha'||revision.repository!==course.repo||revision.root!=='../sources/'+course.id||typeof revision.sha!=='string')reject('CI_SOURCE_PROVENANCE_INVALID');
  await assertSourceWorktree(resolve(sources,course.id),revision.sha,course,metrics);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const metrics:SourceMetrics={files:0,totalBytes:0,maxFileBytes:0,freeBytes:0};
 (async()=>{
  if(process.argv.length!==2)reject('CI_SOURCE_INSPECTION_FAILED');
  const path=resolve('.local/revisions.json');if((await lstat(path)).size>16384)reject('CI_SOURCE_PROVENANCE_INVALID');
  await checkSourceLimits(process.cwd(),JSON.parse(await readFile(path,'utf8')),metrics);process.stdout.write(formatSourceDiagnostic(null,metrics));
 })().catch(error=>{process.stderr.write(formatSourceDiagnostic(error,metrics));process.exitCode=1;});
}
