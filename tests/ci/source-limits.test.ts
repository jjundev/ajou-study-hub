import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSourceWorktree, checkFileLimit, checkFreeSpace, formatSourceDiagnostic, type SourceMetrics } from '../../tools/ci/source-limits.js';
import { sparsePatterns } from '../../tools/ci/sparse-source.js';
const exec=promisify(execFile);
let root='';
const metrics=():SourceMetrics=>({files:0,totalBytes:0,maxFileBytes:0,freeBytes:0});
afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true});root='';});
test('preserves inclusive file count, per-file and aggregate boundaries',()=>{
 const m=metrics();m.files=99999;m.totalBytes=3*1024**3-256*1024**2;
 checkFileLimit(m,256*1024**2);expect(m).toMatchObject({files:100000,totalBytes:3221225472,maxFileBytes:268435456});
 expect(()=>checkFileLimit(m,0)).toThrow('CI_SOURCE_FILE_COUNT_LIMIT');
 expect(()=>checkFileLimit(metrics(),268435457)).toThrow('CI_SOURCE_MAX_FILE_LIMIT');
 const total=metrics();total.totalBytes=3221225472;expect(()=>checkFileLimit(total,1)).toThrow('CI_SOURCE_TOTAL_BYTES_LIMIT');
});
test('preserves actual four GiB free-space boundary and bounds safe counters',()=>{
 const m=metrics();checkFreeSpace(m,4294967296n);expect(m.freeBytes).toBe(4294967296);
 expect(()=>checkFreeSpace(m,4294967295n)).toThrow('CI_SOURCE_DISK_LIMIT');
 checkFreeSpace(m,2n**100n);expect(m.freeBytes).toBe(Number.MAX_SAFE_INTEGER);
});
test('diagnostics never serialize raw paths, errors, stacks, or arbitrary fields',()=>{
 const text=formatSourceDiagnostic(Error('private/path TOKEN'),{...metrics(),freeBytes:Infinity,totalBytes:NaN,files:-1,secret:'private'} as SourceMetrics);
 expect(JSON.parse(text)).toEqual({code:'CI_SOURCE_INSPECTION_FAILED',files:0,totalBytes:0,maxFileBytes:0,freeBytes:0});
 expect(Buffer.byteLength(text)).toBeLessThan(512);expect(text).not.toMatch(/private|TOKEN|stack/);
});
async function buildFixture(){
 root=await mkdtemp(join(tmpdir(),'hub-sparse-limits-'));const origin=join(root,'origin'),checkout=join(root,'checkout');await mkdir(origin);await mkdir(checkout);
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(root,'empty-config'),GIT_TERMINAL_PROMPT:'0'};
 const git=async(cwd:string,...args:string[])=>(await exec('git',args,{cwd,env,maxBuffer:8*1024**2,timeout:15000})).stdout;
 await git(origin,'init');await git(origin,'config','user.name','Synthetic');await git(origin,'config','user.email','fixture@example.test');await git(origin,'config','core.autocrlf','false');
 const selected=['복습노트/note.txt','복습노트/.hidden','강의노트/추가 강의/note.txt','literal[1].pdf','file.pdf/child.txt'];
 const outside=['root.txt','nested/복습노트/no.txt','강의노트/sibling.txt','literal1.pdf','file.pdf-sibling','outside/.gitattributes'];
 for(const path of [...selected,...outside]){await mkdir(dirname(join(origin,path)),{recursive:true});await writeFile(join(origin,path),'synthetic\n');}
 await git(origin,'add','.');await git(origin,'commit','-m','synthetic');
 const sha=(await git(origin,'rev-parse','HEAD')).trim();
 // Outside-selection unsupported entries remain metadata, never materialized.
 await git(origin,'update-index','--add','--cacheinfo','120000,'+(await git(origin,'hash-object','root.txt')).trim()+',outside-link');
 await git(origin,'update-index','--add','--cacheinfo','160000,'+sha+',outside-submodule');await git(origin,'commit','-m','metadata decoys');
 const fixed=(await git(origin,'rev-parse','HEAD')).trim();
 await git(checkout,'init');await git(checkout,'fetch','--depth=1','--no-tags',origin,fixed);
 const config={allowedRoots:['복습노트','강의노트/추가 강의','literal[1].pdf','file.pdf'],extraFiles:[]};
 // Reproduce the pinned action's non-cone primitive: fresh full index + raw patterns.
 await git(checkout,'config','core.sparseCheckout','true');await git(checkout,'config','core.sparseCheckoutCone','false');
 await writeFile(join(checkout,'.git','info','sparse-checkout'),sparsePatterns(config).join('\n')+'\n');await git(checkout,'checkout','--detach',fixed);
 return {checkout,fixed,config,selected,git};
}
let baseline:Awaited<ReturnType<typeof buildFixture>>,baselineRoot='';
beforeAll(async()=>{baseline=await buildFixture();baselineRoot=root;root='';},180000);
afterAll(async()=>{if(baselineRoot)await rm(baselineRoot,{recursive:true,force:true});});
async function fixture(){
 root=await mkdtemp(join(tmpdir(),'hub-sparse-limits-case-'));const checkout=join(root,'checkout');await cp(baseline.checkout,checkout,{recursive:true});
 return {...baseline,checkout};
}
test('sparse primitive preserves fixed SHA/tree/full index and materializes exact Unicode/hidden/file sets',async()=>{
 const f=await fixture(),m=metrics();await assertSourceWorktree(f.checkout,f.fixed,f.config,m);
 expect(m.files).toBe(5);expect(m.totalBytes).toBe(50);
 expect((await f.git(f.checkout,'rev-parse','HEAD')).trim()).toBe(f.fixed);expect(await f.git(f.checkout,'status','--porcelain')).toBe('');
 expect((await f.git(f.checkout,'ls-files','-z')).split('\0').filter(Boolean)).toHaveLength(13);
 expect((await f.git(f.checkout,'rev-parse','HEAD^{tree}')).trim()).toBe((await f.git(join(baselineRoot,'origin'),'rev-parse',f.fixed+'^{tree}')).trim());
 expect(await readFile(join(f.checkout,'literal[1].pdf'),'utf8')).toBe('synthetic\n');
});
test.each(['ignored-extra','outside-extra','missing-selected','changed-index','selected-symlink','selected-gitlink'] as const)('rejects physical/provenance mismatch %s',async kind=>{
 const f=await fixture();
 if(kind==='ignored-extra'){await f.git(f.checkout,'config','core.excludesFile',join(root,'ignore'));await writeFile(join(root,'ignore'),'secret*\n');await writeFile(join(f.checkout,'복습노트','secret-private'),'synthetic');}
 if(kind==='outside-extra')await writeFile(join(f.checkout,'private-extra'),'synthetic');
 if(kind==='missing-selected'){await f.git(f.checkout,'update-index','--skip-worktree','복습노트/note.txt');await rm(join(f.checkout,'복습노트/note.txt'));expect(await f.git(f.checkout,'status','--porcelain')).toBe('');}
 if(kind==='changed-index')await f.git(f.checkout,'update-index','--force-remove','복습노트/note.txt');
 if(kind==='selected-symlink'||kind==='selected-gitlink'){
  const mode=kind==='selected-symlink'?'120000':'160000',hash=kind==='selected-symlink'?(await f.git(f.checkout,'hash-object','literal[1].pdf')).trim():f.fixed;
  await f.git(f.checkout,'update-index','--add','--cacheinfo',mode+','+hash+',복습노트/unsupported');
  await f.git(f.checkout,'-c','user.name=Synthetic','-c','user.email=fixture@example.test','commit','-m','selected unsupported');f.fixed=(await f.git(f.checkout,'rev-parse','HEAD')).trim();
 }
 await expect(assertSourceWorktree(f.checkout,f.fixed,f.config,metrics())).rejects.toThrow(/^CI_SOURCE_/);
});
test('CLI rejects overrides and raw filesystem failures with only bounded diagnostics',async()=>{
 root=await mkdtemp(join(tmpdir(),'hub-private-path-must-not-leak-'));
 for(const args of [[],['--max-bytes','999999999999']]){
  let result:{code:number;stdout:string;stderr:string}|undefined;
  try{await exec(process.execPath,['--import',new URL('../../node_modules/tsx/dist/loader.mjs',import.meta.url).href,fileURLToPath(new URL('../../tools/ci/source-limits.ts',import.meta.url)),...args],{cwd:root,timeout:15000});}
  catch(error){result=error as typeof result;}
  expect(result?.code).toBe(1);expect(result?.stdout).toBe('');
  expect(JSON.parse(result!.stderr)).toEqual({code:'CI_SOURCE_INSPECTION_FAILED',files:0,totalBytes:0,maxFileBytes:0,freeBytes:0});
  expect(result!.stderr).not.toMatch(/hub-private|ENOENT|stack|max-bytes/);
 }
});
