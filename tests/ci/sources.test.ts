import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { courses } from '../../config/courses.js';
import { bindSources, resolveRevisions, formatSourceOperationDiagnostic, SourceBindError, type Revision } from '../../tools/ci/sources.js';
import * as binding from '../../tools/source-binding.js';
const temps:string[]=[];
let seed:string,seedSha:string,seedConfig:string;
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(temps.splice(0).map(p=>rm(p,{recursive:true,force:true,maxRetries:5,retryDelay:200})));});
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

// Removing a stage boundary must fail these assertions even when binding still rejects.
test('binding attributes malformed input and missing project to safe stages before settings writes',async()=>{
 const {project,revisions}=await fixture();
 await expect(bindSources(project,'MAIN',revisions)).rejects.toMatchObject({safeCode:'CI_BIND_APP_SHA_INVALID'});
 await expect(bindSources(project,appSha,revisions.slice(1))).rejects.toMatchObject({safeCode:'CI_BIND_REVISIONS_INVALID'});
 await expect(bindSources(join(project,'private-missing'),appSha,revisions)).rejects.toMatchObject({safeCode:'CI_BIND_PROJECT_ROOT_FAILED'});
 await expect(readFile(join(project,'.local/ci-sources.json'))).rejects.toMatchObject({code:'ENOENT'});
});

test.each(['root','overlap','origin','head','status','dirty','output'] as const)('binding rejects %s with its safe stage and leaves source files intact',async kind=>{
 const {project,revisions}=await fixture(),first=revisions[0]!,before=await readFile(join(first.root,'README.md'),'utf8');
 const codes={root:'CI_BIND_ROOT_FAILED',overlap:'CI_BIND_ROOT_OVERLAP',origin:'CI_BIND_ORIGIN_FAILED',head:'CI_BIND_HEAD_FAILED',status:'CI_BIND_STATUS_FAILED',dirty:'CI_BIND_SOURCE_DIRTY',output:'CI_BIND_OUTPUT_FAILED'};
 if(kind==='root')first.root=join(project,'private-missing');
 if(kind==='overlap'){const root=join(project,'.local');await cp(first.root,root,{recursive:true});first.root=root;}
 if(kind==='origin')git(first.root,'remote','set-url','origin','https://private.invalid/TOKEN');
 if(kind==='head')first.sha='0'.repeat(40);
 if(kind==='status')await writeFile(join(first.root,'.git/index'),'private-corrupt-index-TOKEN');
 if(kind==='dirty')await writeFile(join(first.root,'private-TOKEN.txt'),'private-content');
 if(kind==='output')await writeFile(join(project,'.local'),'private-output-TOKEN');
 await expect(bindSources(project,appSha,revisions)).rejects.toMatchObject({safeCode:codes[kind],...(kind==='output'?{}:{courseId:'logic-lab'})});
 if(kind!=='root')expect(await readFile(join(first.root,'README.md'),'utf8')).toBe(before);
});

test('binding contains raw inspection exceptions and attributes late provenance changes',async()=>{
 const {project,revisions}=await fixture();
 const inspect=binding.inspectBoundSources;
 const spy=vi.spyOn(binding,'inspectBoundSources').mockRejectedValueOnce(Error('private/path TOKEN raw Git failure'));
 await expect(bindSources(project,appSha,revisions)).rejects.toMatchObject({safeCode:'CI_BIND_INSPECTION_FAILED'});
 spy.mockImplementationOnce(async(...args)=>{const result=await inspect(...args);result.snapshot.provenance[0]!.dirty=true;return result;});
 await expect(bindSources(project,appSha,revisions)).rejects.toMatchObject({safeCode:'CI_BIND_PROVENANCE_FAILED',courseId:'logic-lab'});
 await expect(readFile(join(project,'.reports/ci-sources.json'))).rejects.toMatchObject({code:'ENOENT'});
});

test('formatter emits only trusted codes and fixed course IDs despite hostile error fields',async()=>{
 const {project,revisions}=await fixture();
 git(revisions[0]!.root,'remote','set-url','origin','https://private.invalid/TOKEN');
 let failure:unknown;
 try{await bindSources(project,appSha,revisions);}catch(error){failure=error;}
 expect(JSON.parse(formatSourceOperationDiagnostic(failure))).toEqual({code:'CI_BIND_ORIGIN_FAILED',courseId:'logic-lab'});
 // A captured typed error must not become a path or token channel if fields change.
 Object.assign(failure as object,{safeCode:'private-TOKEN',courseId:'private-course',message:'private-message',stack:'private-stack'});
 expect(JSON.parse(formatSourceOperationDiagnostic(failure))).toEqual({code:'CI_BIND_ORIGIN_FAILED',courseId:'logic-lab'});
 const hostile=new Proxy({}, {get(){throw Error('must not inspect arbitrary exception properties');}});
 for(const error of [Error('private-path TOKEN'),{safeCode:'CI_BIND_ORIGIN_FAILED',courseId:'logic-lab'},Object.assign(Error(),{code:'CI_BIND_ROOT_FAILED'}),Object.create(Object.getPrototypeOf(failure)),hostile,null,'private-message']){
  const output=formatSourceOperationDiagnostic(error);
  expect(output).toBe('{"code":"CI_SOURCE_OPERATION_FAILED"}\n');expect(Buffer.byteLength(output)).toBeLessThan(128);
 }
 expect(formatSourceOperationDiagnostic(new SourceBindError('private-TOKEN' as never,'private-message','private-course'))).toBe('{"code":"CI_SOURCE_OPERATION_FAILED"}\n');
 expect(formatSourceOperationDiagnostic(new SourceBindError('CI_BIND_PROVENANCE_FAILED','private-message','private-course'))).toBe('{"code":"CI_BIND_PROVENANCE_FAILED"}\n');
});

test('real bind CLI preserves success JSON and contains a raw Git status failure',async()=>{
 const {project,revisions}=await fixture(),path=join(project,'revisions.json');await writeFile(path,JSON.stringify(revisions));
 const invoke=()=>spawnSync(process.execPath,['--import',new URL('../../node_modules/tsx/dist/loader.mjs',import.meta.url).href,fileURLToPath(new URL('../../tools/ci/sources-cli.ts',import.meta.url)),'bind',appSha,path],{cwd:project,encoding:'utf8',timeout:20000});
 const success=invoke();expect(success.status).toBe(0);expect(success.stderr).toBe('');
 const snapshot=JSON.parse(success.stdout);expect(snapshot).toMatchObject({version:1,appSha,settingsPath:join(project,'.local/ci-sources.json')});
 expect(snapshot.revisions).toEqual(revisions);expect(snapshot.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
 await writeFile(join(revisions[0]!.root,'.git/index'),'private-corrupt-index-TOKEN');
 const failure=invoke();expect(failure.status).toBe(1);expect(failure.stdout).toBe('');
 expect(failure.stderr).toBe('{"code":"CI_BIND_STATUS_FAILED","courseId":"logic-lab"}\n');
});
