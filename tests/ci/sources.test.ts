import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { courses } from '../../config/courses.js';
import { bindSources, resolveRevisions, type Revision } from '../../tools/ci/sources.js';
const temps:string[]=[];
afterEach(async()=>{await Promise.all(temps.splice(0).map(p=>rm(p,{recursive:true,force:true,maxRetries:5,retryDelay:200})));});
const git=(root:string,...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(){
 const project=await mkdtemp(join(tmpdir(),'ci-sources-'));temps.push(project);
 const revisions:Revision[]=[];
 for(const course of courses){
  const root=join(project,'sources',course.id);await mkdir(root,{recursive:true});
  git(root,'init','--quiet');git(root,'config','core.autocrlf','false');git(root,'config','user.name','Test');git(root,'config','user.email','test@example.invalid');
  git(root,'remote','add','origin',`https://github.com/${course.repo}.git`);
  await writeFile(join(root,'README.md'),'source\n');git(root,'add','.');git(root,'commit','--quiet','-m','fixture');
  revisions.push({courseId:course.id,repository:course.repo,sha:git(root,'rev-parse','HEAD'),root});
 }
 return {project,revisions};
}
const appSha='a'.repeat(40);
test('resolve_only_allowlisted_main',async()=>{
 const requestedRepos:string[]=[],requestedRefs:string[]=[];
 const request:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));expect(url.origin).toBe('https://api.github.com');
  const match=/^\/repos\/(.+)\/git\/ref\/(.+)$/.exec(url.pathname)!;
  requestedRepos.push(match[1]!);requestedRefs.push(match[2]!);
  expect(init?.redirect).toBe('error');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-token');
  return Response.json({ref:'refs/heads/main',object:{type:'commit',sha:'b'.repeat(40)}});
 };
 const result=await resolveRevisions(request,'private-token');
 expect(requestedRepos.sort()).toEqual(courses.map(c=>c.repo).sort());expect(requestedRefs).toEqual(Array(5).fill('heads/main'));
 expect(result).toHaveLength(5);expect(result.every(r=>r.sha==='b'.repeat(40)&&!('root' in r))).toBe(true);
});
test.each([new Response('',{status:302}),new Response('',{status:403}),Response.json({}),Response.json([{ref:'refs/heads/main'}]),Response.json({ref:'refs/heads/main',object:{type:'tag',sha:'b'.repeat(40)}})])('resolve rejects invalid API responses %#',async(response)=>{
 await expect(resolveRevisions(async()=>response.clone(),'token')).rejects.toThrow();
});
test('bind_rejects_dirty_or_moved_head',async()=>{
 const {project,revisions}=await fixture();
 await writeFile(join(revisions[0]!.root,'README.md'),'changed');await expect(bindSources(project,appSha,revisions)).rejects.toThrow();
 git(revisions[0]!.root,'add','.');git(revisions[0]!.root,'commit','--quiet','-m','moved');await expect(bindSources(project,appSha,revisions)).rejects.toThrow();
});
test('fingerprint_ignores_runner_root and pinned revisions survive later main movement',async()=>{
 const {project,revisions}=await fixture();const pinnedShas=revisions.map(r=>r.sha);
 const rootA=await bindSources(project,appSha,revisions);
 const other=await mkdtemp(join(tmpdir(),'ci-copy-'));temps.push(other);await cp(join(project,'sources'),join(other,'sources'),{recursive:true});
 const rootB=await bindSources(other,appSha,revisions.map(r=>({...r,root:join(other,'sources',r.courseId)})));
 expect(rootA.inputFingerprint).toBe(rootB.inputFingerprint);
 const changedApp=await bindSources(other,'c'.repeat(40),revisions.map(r=>({...r,root:join(other,'sources',r.courseId)})));expect(changedApp.inputFingerprint).not.toBe(rootA.inputFingerprint);expect(rootA.settingsPath).not.toEqual(rootB.settingsPath);
 expect(rootA.revisions.map(r=>r.sha)).toEqual(pinnedShas);
 expect(JSON.parse(await readFile(join(project,'.local/ci-sources.json'),'utf8')).explicitUntracked).toEqual({});
 expect(JSON.parse(await readFile(join(project,'.reports/ci-sources.json'),'utf8')).inputFingerprint).toBe(rootA.inputFingerprint);
 git(revisions[0]!.root,'checkout','-b','main');await writeFile(join(revisions[0]!.root,'README.md'),'later');git(revisions[0]!.root,'commit','-am','later','--quiet');
 expect(rootA.revisions.map(r=>r.sha)).toEqual(pinnedShas);
},120000);
test('bind_requires_five_sources and unique owned repository roots',async()=>{
 const {project,revisions}=await fixture();
 for(const invalid of [revisions.slice(1),[...revisions,revisions[0]!],revisions.map((r,i)=>i===1?revisions[0]!:r),revisions.map((r,i)=>i===0?{...r,repository:'someone/other'}:r),revisions.map((r,i)=>i===1?{...r,root:revisions[0]!.root}:r)]) await expect(bindSources(project,appSha,invalid)).rejects.toThrow();
 git(revisions[0]!.root,'remote','set-url','origin','https://github.com/other/repo.git');await expect(bindSources(project,appSha,revisions)).rejects.toThrow();
});

test('bind rejects malformed revisions and app SHA before writing settings',async()=>{
 const {project,revisions}=await fixture();
 await expect(bindSources(project,'MAIN',revisions)).rejects.toThrow();
 await expect(bindSources(project,appSha,revisions.map((r,i)=>i===0?{...r,sha:'main'}:r))).rejects.toThrow();
 await expect(bindSources(project,appSha,revisions.map((r,i)=>i===0?{...r,unexpected:true}:r))).rejects.toThrow();
});
