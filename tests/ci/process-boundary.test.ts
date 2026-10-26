import { mkdtemp, writeFile, mkdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, vi } from 'vitest';
import { assertCleanBoundary, captureTrustedFiles, assertNoRelevantProcesses } from '../../tools/ci/process-boundary.js';
const exec = promisify(execFile);
async function fixture(run:(root:string)=>Promise<void>) {
 const root=await mkdtemp(join(tmpdir(),'hub-boundary-'));
 const env={...process.env,GIT_CONFIG_GLOBAL:join(root,'global.gitconfig'),GIT_CONFIG_NOSYSTEM:'1'};
 vi.stubEnv('GIT_CONFIG_GLOBAL',env.GIT_CONFIG_GLOBAL);vi.stubEnv('GIT_CONFIG_NOSYSTEM','1');
 vi.stubEnv('HOME',root);vi.stubEnv('USERPROFILE',root);
 try {
  await mkdir(join(root,'tools','deploy'),{recursive:true});
  await writeFile(join(root,'tools','deploy','upload.ts'),'export const upload = true;');
  await writeFile(join(root,'package-lock.json'),'{}');
  await exec('git',['init'],{cwd:root,env});
  await exec('git',['add','.'],{cwd:root,env});
  await exec('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','fixture'],{cwd:root,env});
  await run(root);
 } finally {vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
}
test('rejects changed uploader',async()=>{
 await fixture(async root=>{
  const baseline=await captureTrustedFiles(root);
  await writeFile(join(root,'tools','deploy','upload.ts'),'changed');
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_TRUST_CHANGED');
 });
});
test('rejects deleted lockfile and newly installed Git hooks',async()=>{
 await fixture(async root=>{
  const baseline=await captureTrustedFiles(root);
  await writeFile(join(root,'.git','hooks','post-checkout'),'credential-fixture');
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_TRUST_CHANGED');
  await unlink(join(root,'.git','hooks','post-checkout'));
  await unlink(join(root,'package-lock.json'));
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_TRUST_CHANGED');
 });
});
test('rejects persisted credential helpers without printing helper contents',async()=>{
 await fixture(async root=>{
  const baseline=await captureTrustedFiles(root);
  await exec('git',['config','credential.helper','!secret-fixture'],{cwd:root});
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_CREDENTIAL_CONFIG');
 });
});
test('empty or caller-forged incomplete baseline cannot authorize boundary',async()=>{
 await fixture(async root=>{await expect(assertCleanBoundary(root,{})).rejects.toThrow('BOUNDARY_BASELINE_INVALID');});
});
test('rejects surviving Reader environment',async()=>{
 await fixture(async root=>{
  const baseline=await captureTrustedFiles(root);
  vi.stubEnv('GH_TOKEN','fixture-reader-token');
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_CREDENTIAL_RESIDUE');
 });
});
test('rejects surviving browser, reparented service, and workspace child without argv inspection',()=>{
 const self={pid:10,ppid:1,uid:1000,cwd:'/runner/app',executable:'/usr/bin/node'};
 for(const process of [
  {pid:20,ppid:10,uid:1000,cwd:'/tmp',executable:'/usr/bin/chromium'},
  {pid:21,ppid:1,uid:1000,cwd:'/tmp',executable:'/usr/bin/node'},
  {pid:22,ppid:1,uid:1000,cwd:'/runner/app/dist',executable:'/bin/sh'},
 ]) expect(()=>assertNoRelevantProcesses([self,process],10,1000,'/runner/app')).toThrow('BOUNDARY_LIVE_PROCESS');
 expect(()=>assertNoRelevantProcesses([self],10,1000,'/runner/app')).not.toThrow();
});
test('missing process inspection evidence fails closed',()=>{
 expect(()=>assertNoRelevantProcesses([],10,1000,'/runner/app')).toThrow('BOUNDARY_PROCESS_UNREADABLE');
});
test('unsupported platform fails closed even with a clean synthetic checkout',async()=>{
 if(process.platform==='linux')return;
 await fixture(async root=>{
  const baseline=await captureTrustedFiles(root);
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_UNSUPPORTED_PLATFORM');
 });
});
