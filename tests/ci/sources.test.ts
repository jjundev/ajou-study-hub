import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { courses } from '../../config/courses.js';
import { bindSources, resolveRevisions, type Revision } from '../../tools/ci/sources.js';
const temps:string[]=[];
let seed:string,seedSha:string,seedConfig:string;
afterEach(async()=>{await Promise.all(temps.splice(0).map(p=>rm(p,{recursive:true,force:true,maxRetries:5,retryDelay:200})));});
const git=(root:string,...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
beforeAll(async()=>{
 seed=await mkdtemp(join(tmpdir(),'ci-source-seed-'));
 git(seed,'init','--quiet','--initial-branch=main');
 seedConfig=(await readFile(join(seed,'.git/config'),'utf8'))+'\n[core]\n\tautocrlf = false\n[user]\n\tname = Test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n';
 await writeFile(join(seed,'.git/config'),seedConfig);
 await writeFile(join(seed,'README.md'),'source\n');git(seed,'add','.');git(seed,'commit','--quiet','-m','fixture');
 seedSha=git(seed,'rev-parse','HEAD');
});
afterAll(async()=>{if(seed)await rm(seed,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
async function fixture(){
 const project=await mkdtemp(join(tmpdir(),'ci-sources-'));temps.push(project);
 const revisions:Revision[]=[];
 for(const course of courses){
  const root=join(project,'sources',course.id);await mkdir(join(project,'sources'),{recursive:true});
  // Full copies keep each repository's index, objects and config independent.
  await cp(seed,root,{recursive:true});
  await writeFile(join(root,'.git/config'),seedConfig+`\n[remote "origin"]\n\turl = https://github.com/${course.repo}.git\n`);
  revisions.push({courseId:course.id,repository:course.repo,sha:seedSha,root});
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
 const expectedFingerprint=createHash('sha256').update(JSON.stringify({appSha:'a'.repeat(40),revisions:[
  {courseId:'circuits-2',repository:'jjundev/ajou-electronic-circuits-2',sha:seedSha},
  {courseId:'data-structures',repository:'jjundev/ajou-jagual',sha:seedSha},
  {courseId:'life-science',repository:'jjundev/ajou-life-science',sha:seedSha},
  {courseId:'logic-lab',repository:'jjundev/ajou-nonhoesil',sha:seedSha},
  {courseId:'ml-basics',repository:'jjundev/ajou-ml-basics',sha:seedSha},
 ]})).digest('hex');
 expect(rootA.inputFingerprint).toBe(expectedFingerprint);expect(rootA.settingsPath).not.toEqual(rootB.settingsPath);
 expect(rootA.revisions.map(r=>r.sha)).toEqual(pinnedShas);
 expect(JSON.parse(await readFile(join(project,'.local/ci-sources.json'),'utf8')).explicitUntracked).toEqual({});
 expect(JSON.parse(await readFile(join(project,'.reports/ci-sources.json'),'utf8')).inputFingerprint).toBe(rootA.inputFingerprint);
 // Seed already uses main: a later commit must work with init.defaultBranch=main too.
 await writeFile(join(revisions[0]!.root,'README.md'),'later');git(revisions[0]!.root,'commit','-am','later','--quiet');
 expect(await readFile(join(revisions[0]!.root,'.git/HEAD'),'utf8')).toBe('ref: refs/heads/main\n');
 expect(rootA.revisions.map(r=>r.sha)).toEqual(pinnedShas);
},120000);
test('bind_requires_five_sources and unique owned repository roots',async()=>{
 const {project,revisions}=await fixture();
 for(const invalid of [revisions.slice(1),[...revisions,revisions[0]!],revisions.map((r,i)=>i===1?revisions[0]!:r),revisions.map((r,i)=>i===0?{...r,repository:'someone/other'}:r),revisions.map((r,i)=>i===1?{...r,root:revisions[0]!.root}:r)]) await expect(bindSources(project,appSha,invalid)).rejects.toThrow();
 git(revisions[0]!.root,'remote','set-url','origin','https://github.com/other/repo.git');await expect(bindSources(project,appSha,revisions)).rejects.toThrow();
});

test('bind rejects malformed revisions and app SHA before writing settings',async()=>{
 const project=await mkdtemp(join(tmpdir(),'ci-invalid-'));temps.push(project);
 const revisions=courses.map(course=>({courseId:course.id,repository:course.repo,sha:'b'.repeat(40),root:join(project,course.id)}));
 await expect(bindSources(project,'MAIN',revisions)).rejects.toThrow(/^Invalid app SHA$/);
 await expect(bindSources(project,appSha,revisions.map((r,i)=>i===0?{...r,sha:'main'}:r))).rejects.toThrow(/^Invalid source revision$/);
 await expect(bindSources(project,appSha,revisions.map((r,i)=>i===0?{...r,unexpected:true}:r))).rejects.toThrow(/^Invalid source revision$/);
});
