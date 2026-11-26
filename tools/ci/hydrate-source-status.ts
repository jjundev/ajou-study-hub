import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { courses, type CourseConfig } from '../../config/courses.js';
import { courseConfiguration } from './course-source.js';
const exec=promisify(execFile);
async function configuration(root:string,env:NodeJS.ProcessEnv):Promise<string>{
 const text=(await exec('git',['config','--null','--list','--show-origin'],{cwd:root,env,timeout:15000,maxBuffer:1024*1024})).stdout;
 if(/(?:credential\.[^\n\0]*|http\.[^\n\0]*extraheader|core\.(?:sshcommand|hookspath)|url\.[^\n\0]*insteadof|filter\.[^\n\0]*)\n/i.test(text))throw Error();
 return text;
}
const fail=():never=>{throw Error('CI_SOURCE_STATUS_HYDRATION_FAILED');};
/** Internal status operation; caller has already checked the fixed origin and pinned HEAD.
 * Authorization exists only in this Git child's environment and is scoped to GitHub HTTPS. */
export async function statusWithReader(root:string,token:string,env:NodeJS.ProcessEnv=process.env):Promise<void>{
 try{
  if(!token||/[\r\n\0]/.test(token)||Object.keys(env).some(k=>/^(?:GIT_TRACE|GIT_CURL_VERBOSE$|GIT_CONFIG_(?:COUNT|PARAMETERS|KEY_\d+|VALUE_\d+)$)/i.test(k)))fail();
  const before=await configuration(root,env);
  const child={...env,GH_TOKEN:undefined,GITHUB_TOKEN:undefined,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_1:'http.followRedirects',GIT_CONFIG_VALUE_1:'false',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:'AUTHORIZATION: basic '+Buffer.from('x-access-token:'+token).toString('base64')};
  const result=await exec('git',['status','--porcelain','--untracked-files=all'],{cwd:root,env:child,timeout:120000,maxBuffer:20*1024*1024});
  if(result.stdout.trim()||before!==await configuration(root,env))fail();
 }catch{fail();}
}
export async function hydrateSourceStatus(project:string,revisions:unknown,token:string,env:NodeJS.ProcessEnv=process.env,configs: readonly CourseConfig[] = courses):Promise<void>{
 try{
  if(!Array.isArray(revisions)||revisions.length!==configs.length)fail();
  const list=revisions as any[];
  for(const course of configs){
   const rows=list.filter(r=>r?.courseId===course.id);if(rows.length!==1)fail();const row=rows[0];
   const root=resolve(project,'../sources',course.id);
   if(row.repository!==course.repo||row.root!=='../sources/'+course.id||typeof row.sha!=='string'||! /^[a-f0-9]{40}$/.test(row.sha)||await realpath(root)!==root)fail();
   await configuration(root,env);
   const git=async(...args:string[])=>(await exec('git',args,{cwd:root,env,timeout:15000,maxBuffer:1024*1024})).stdout.trim();
   if(await git('remote')!=='origin'||![`https://github.com/${course.repo}`,`https://github.com/${course.repo}.git`].includes(await git('remote','get-url','origin'))||await git('rev-parse','HEAD')!==row.sha||await realpath(await git('rev-parse','--show-toplevel'))!==root)fail();
   await statusWithReader(root,token,env);
  }
 }catch{fail();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void(async()=>{
 if(process.argv.length>3||!process.env.GH_TOKEN)fail();
 await hydrateSourceStatus(process.cwd(),JSON.parse(await readFile('.local/revisions.json','utf8')),process.env.GH_TOKEN!,process.env,process.argv[2] ? [courseConfiguration(process.argv[2])] : courses);
})().catch(()=>{console.error('CI_SOURCE_STATUS_HYDRATION_FAILED');process.exitCode=1;});
