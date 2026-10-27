import { expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { statusWithReader } from '../../tools/ci/hydrate-source-status.js';
const exec=promisify(execFile);
test('partial sparse clone hydrates status metadata before Reader removal and retains dirty detection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hub-status-hydration-')),origin=join(root,'origin'),clone=join(root,'clone');
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(root,'empty-global'),GIT_TERMINAL_PROMPT:'0'};
 const git=async(cwd:string,...args:string[])=>(await exec('git',args,{cwd,env,timeout:30000})).stdout;
 try{
  await mkdir(origin);await git(origin,'init','-q');await git(origin,'config','uploadpack.allowFilter','true');
  await mkdir(join(origin,'selected'));await mkdir(join(origin,'excluded'));
  await writeFile(join(origin,'.gitignore'),'ignored\n');await writeFile(join(origin,'excluded','.gitignore'),'nested-ignored\n');await writeFile(join(origin,'selected','a.html'),'synthetic');await writeFile(join(origin,'excluded','b.pdf'),'excluded'.repeat(100));
  await git(origin,'add','.');await git(origin,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
  await git(root,'clone','--filter=blob:none','--no-checkout',pathToFileURL(origin).href,clone);
  await git(clone,'sparse-checkout','set','--no-cone','/selected/');await git(clone,'checkout','-q');
  const before=await git(clone,'rev-list','--objects','--all','--missing=print');
  expect(before).toMatch(/^\?/m);
  const configBefore=await readFile(join(clone,'.git','config'),'utf8');
  await statusWithReader(clone,'synthetic-reader-token',env);
  expect(await readFile(join(clone,'.git','config'),'utf8')).toBe(configBefore);
  // Block all later lazy fetches. The exact production status must now succeed without Reader.
  const status=(await exec('git',['-c','remote.origin.url=file:///unavailable-private-origin','status','--porcelain','--untracked-files=all'],{cwd:clone,env,timeout:30000})).stdout;
  expect(status).toBe('');
  await writeFile(join(clone,'selected','a.html'),'changed');
  expect(await git(clone,'status','--porcelain','--untracked-files=all')).toContain('selected/a.html');
  await expect(statusWithReader(clone,'synthetic-reader-token',env)).rejects.toThrow(/^CI_SOURCE_STATUS_HYDRATION_FAILED$/);
  expect(env).not.toHaveProperty('GIT_CONFIG_COUNT');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('rejects tracing and inherited command config without exposing token',async()=>{
 await expect(statusWithReader('.', 'private-token',{...process.env,GIT_TRACE:'1'})).rejects.toThrow(/^CI_SOURCE_STATUS_HYDRATION_FAILED$/);
});
