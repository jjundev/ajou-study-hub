import { mkdtemp, writeFile, mkdir, rm, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, vi } from 'vitest';
import { assertCleanBoundary, captureTrustedFiles, assertNoRelevantProcesses, linuxProcesses } from '../../tools/ci/process-boundary.js';
const exec = promisify(execFile);
const fileBaseline=async(root:string)=>({version:1 as const,files:await captureTrustedFiles(root),opaqueProcesses:[]});
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
  const baseline=await fileBaseline(root);
  await writeFile(join(root,'tools','deploy','upload.ts'),'changed');
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_TRUST_CHANGED');
 });
});
test('rejects deleted lockfile and newly installed Git hooks',async()=>{
 await fixture(async root=>{
  const baseline=await fileBaseline(root);
  await writeFile(join(root,'.git','hooks','post-checkout'),'credential-fixture');
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_TRUST_CHANGED');
  await unlink(join(root,'.git','hooks','post-checkout'));
  await unlink(join(root,'package-lock.json'));
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_TRUST_CHANGED');
 });
});
test('rejects persisted credential helpers without printing helper contents',async()=>{
 await fixture(async root=>{
  const baseline=await fileBaseline(root);
  await exec('git',['config','credential.helper','!secret-fixture'],{cwd:root});
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_CREDENTIAL_CONFIG');
 });
});
test('empty or caller-forged incomplete baseline cannot authorize boundary',async()=>{
 await fixture(async root=>{await expect(assertCleanBoundary(root,{})).rejects.toThrow('BOUNDARY_BASELINE_INVALID');});
});
test('rejects surviving Reader environment',async()=>{
 await fixture(async root=>{
  const baseline=await fileBaseline(root);
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
 expect(()=>assertNoRelevantProcesses([self,{pid:1,ppid:0,uid:1000,cwd:'/runner/app',executable:'/usr/bin/node'}],10,1000,'/runner/app')).not.toThrow();
 expect(()=>assertNoRelevantProcesses([self,{pid:23,ppid:10,uid:1000,cwd:'/tmp',executable:'/bin/sh'}],10,1000,'/runner/app')).toThrow('BOUNDARY_LIVE_PROCESS');
});
test('missing process inspection evidence fails closed',()=>{
 expect(()=>assertNoRelevantProcesses([],10,1000,'/runner/app')).toThrow('BOUNDARY_PROCESS_UNREADABLE');
});
test('unsupported platform fails closed even with a clean synthetic checkout',async()=>{
 if(process.platform==='linux')return;
 await fixture(async root=>{
  const baseline=await fileBaseline(root);
  await expect(assertCleanBoundary(root,baseline)).rejects.toThrow('BOUNDARY_UNSUPPORTED_PLATFORM');
 });
});

test('Linux process failures expose only fixed stage and errno without process paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'private-TOKEN-proc-'));
 try{
  const pid=join(root,'123');await mkdir(pid);
  await expect(linuxProcesses(join(root,'private-missing'),1000)).rejects.toThrow(/^BOUNDARY_PROCESS_LIST_ENOENT$/);
  await writeFile(join(pid,'status'),'private-invalid-TOKEN');
  await expect(linuxProcesses(root,1000)).rejects.toThrow(/^BOUNDARY_PROCESS_FIELDS_UNKNOWN$/);
  await writeFile(join(pid,'status'),'Uid:\t1000 1000 1000 1000\nPPid:\t1\n');
  await writeFile(join(pid,'cwd'),'private-not-a-link-TOKEN');
  await expect(linuxProcesses(root,1000)).rejects.toThrow(/^BOUNDARY_PROCESS_CWD_EINVAL_UID_ALL_MATCH$/);
  for(const [fields,role] of [['1000 0 0 0','EFFECTIVE_OTHER'],['1000 1000 0 1000','SAVED_OR_FS_OTHER'],['1000 1000 1000 0','SAVED_OR_FS_OTHER']]){
   await writeFile(join(pid,'status'),'Uid:\t'+fields+'\nPPid:\t1\n');
   await expect(linuxProcesses(root,1000)).rejects.toThrow('BOUNDARY_PROCESS_CWD_EINVAL_UID_'+role);
  }
  await writeFile(join(pid,'status'),'Uid:\t1000\nPPid:\t1\n');
  await expect(linuxProcesses(root,1000)).rejects.toThrow(/^BOUNDARY_PROCESS_FIELDS_UNKNOWN$/);
  await writeFile(join(pid,'status'),'Uid:\t1000 1000 1000 1000\nPPid:\t1\n');
  await unlink(join(pid,'cwd'));
  await symlink(root,join(pid,'cwd'),process.platform==='win32'?'junction':'dir');
  await writeFile(join(pid,'exe'),'private-not-a-link-TOKEN');
  await expect(linuxProcesses(root,1000)).rejects.toThrow(/^BOUNDARY_PROCESS_EXE_EINVAL_UID_ALL_MATCH$/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Linux process scan still skips disappearing and other-user entries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hub-proc-'));
 try{
  // A disappeared process has no remaining proc directory.
  await mkdir(join(root,'124'));
  await writeFile(join(root,'124','status'),'Uid:\t2000 0 0 0\nPPid:\t1\n');
  await expect(linuxProcesses(root,1000)).resolves.toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Linux process scan exempts only proper ancestors before unreadable cwd inspection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hub-proc-ancestors-'));
 const links=vi.fn(async(path:unknown)=>{
  if(String(path).includes(join(root,'20')))throw Object.assign(Error('private-denied-TOKEN'),{code:'EACCES'});
  return '/tmp';
 });
 try{
  vi.resetModules();
  vi.doMock('node:fs/promises',async()=>({...await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'),readlink:links}));
  const {linuxProcesses:scan}=await import('../../tools/ci/process-boundary.js');
  for(const [pid,ppid] of [[10,20],[20,30],[30,1]]){
   await mkdir(join(root,String(pid)));
   await writeFile(join(root,String(pid),'status'),'Uid:\t1000 1000 1000 1000\nPPid:\t'+ppid+'\n');
  }
  const rows=await scan(root,1000,10);
  expect(rows).toEqual([{pid:10,ppid:20,uid:1000,cwd:'/tmp',executable:'/tmp'}]);
  expect(links.mock.calls.map(([path])=>String(path))).toEqual([join(root,'10','cwd'),join(root,'10','exe')]);
  // The very same denied process is not exempt when it is outside our ancestor chain.
  await writeFile(join(root,'10','status'),'Uid:\t1000 1000 1000 1000\nPPid:\t1\n');
  await expect(scan(root,1000,10)).rejects.toThrow(/^BOUNDARY_PROCESS_CWD_EACCES_UID_ALL_MATCH$/);
  links.mockImplementation(async()=>{throw Object.assign(Error('private-self-denied-TOKEN'),{code:'EACCES'});});
  await expect(scan(root,1000,10)).rejects.toThrow(/^BOUNDARY_PROCESS_CWD_EACCES_UID_ALL_MATCH$/);
 }finally{vi.doUnmock('node:fs/promises');vi.resetModules();await rm(root,{recursive:true,force:true});}
});

test('trusted initial opaque identity allows only the same preexisting EACCES process',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hub-opaque-'));
 let denied=new Set([20]),errno='EACCES',readableExecutable='/tmp',deniedField='both';
 const links=vi.fn(async(path:unknown)=>{
  const pid=Number(String(path).slice(root.length+1).split(/[\\/]/)[0]);
  if(denied.has(pid)&&(deniedField==='both'||String(path).endsWith(deniedField)))throw Object.assign(Error('private-denied-TOKEN'),{code:errno});
  return String(path).endsWith('exe')?readableExecutable:'/tmp';
 });
 const status=()=>'Uid:\t1000 1000 1000 1000\nPPid:\t1\n';
 const stat=(pid:number,start:string)=>`${pid} (private ) TOKEN) S 1 ${Array(17).fill('0').join(' ')} ${start} 0\n`;
 const add=async(pid:number,start:string)=>{
  await mkdir(join(root,String(pid)),{recursive:true});
  await writeFile(join(root,String(pid),'status'),status());
  await writeFile(join(root,String(pid),'stat'),stat(pid,start));
 };
 try{
  vi.resetModules();
  vi.doMock('node:fs/promises',async()=>({...await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'),readlink:links}));
  const {linuxProcesses:scan,captureOpaqueProcesses,validateBoundaryBaseline}=await import('../../tools/ci/process-boundary.js');
  await add(10,'100');await add(20,'200');
  const opaque=await captureOpaqueProcesses(root,1000,10);
  expect(opaque).toEqual([{pid:20,starttime:'200'}]);
  await expect(scan(root,1000,10,opaque)).resolves.toEqual([{pid:10,ppid:1,uid:1000,cwd:'/tmp',executable:'/tmp'}]);
  deniedField='exe';
  await expect(captureOpaqueProcesses(root,1000,10)).resolves.toEqual(opaque);
  await expect(scan(root,1000,10,opaque)).resolves.toHaveLength(1);
  deniedField='both';
  await expect(scan(root,1000,10)).rejects.toThrow(/^BOUNDARY_PROCESS_CWD_EACCES_UID_ALL_MATCH$/);
  await writeFile(join(root,'20','stat'),stat(20,'201'));
  await expect(scan(root,1000,10,opaque)).rejects.toThrow(/^BOUNDARY_OPAQUE_IDENTITY_CHANGED$/);
  denied=new Set(); // Reused PID must still fail when the replacement is readable.
  await expect(scan(root,1000,10,opaque)).rejects.toThrow(/^BOUNDARY_OPAQUE_IDENTITY_CHANGED$/);
  denied=new Set([20]);await writeFile(join(root,'20','stat'),stat(20,'200'));
  denied=new Set();readableExecutable='/usr/bin/node';
  const readableRows=await scan(root,1000,10,opaque);
  expect(()=>assertNoRelevantProcesses(readableRows,10,1000,'/runner/app')).toThrow('BOUNDARY_LIVE_PROCESS');
  readableExecutable='/tmp';denied=new Set([20]);
  errno='EPERM';await expect(scan(root,1000,10,opaque)).rejects.toThrow(/^BOUNDARY_PROCESS_CWD_EPERM_UID_ALL_MATCH$/);
  await expect(captureOpaqueProcesses(root,1000,10)).rejects.toThrow(/^BOUNDARY_PROCESS_CWD_EPERM_UID_ALL_MATCH$/);
  errno='EACCES';denied=new Set([10,20]);
  await expect(captureOpaqueProcesses(root,1000,10)).rejects.toThrow(/^BOUNDARY_PROCESS_CWD_EACCES_UID_ALL_MATCH$/);
  await expect(scan(root,1000,10,[{pid:10,starttime:'100'},...opaque])).rejects.toThrow(/^BOUNDARY_PROCESS_CWD_EACCES_UID_ALL_MATCH$/);
  denied=new Set([20]);
  await writeFile(join(root,'20','stat'),'private-invalid-TOKEN');
  await expect(captureOpaqueProcesses(root,1000,10)).rejects.toThrow(/^BOUNDARY_PROCESS_STAT_UNKNOWN$/);
  await expect(scan(root,1000,10,opaque)).rejects.toThrow(/^BOUNDARY_PROCESS_STAT_UNKNOWN$/);
  await unlink(join(root,'20','stat'));
  await expect(scan(root,1000,10,opaque)).rejects.toThrow(/^BOUNDARY_PROCESS_STAT_ENOENT$/);
  await expect(captureOpaqueProcesses(root,1000,10)).rejects.toThrow(/^BOUNDARY_PROCESS_STAT_ENOENT$/);
  await writeFile(join(root,'20','stat'),stat(20,'200'));
  await unlink(join(root,'20','status'));
  await expect(scan(root,1000,10,opaque)).rejects.toThrow(/^BOUNDARY_PROCESS_STATUS_ENOENT$/);
  await rm(join(root,'20'),{recursive:true}); // Old process gone: no obligation to keep it alive.
  await expect(scan(root,1000,10,opaque)).resolves.toHaveLength(1);
  await add(21,'210');denied=new Set([21]);
  await expect(scan(root,1000,10,opaque)).rejects.toThrow(/^BOUNDARY_PROCESS_CWD_EACCES_UID_ALL_MATCH$/);
  const files={'@git-index':'a'.repeat(64),'@git-config':'b'.repeat(64),'tracked':'c'.repeat(64)};
  const baseline={version:1,files,opaqueProcesses:opaque};
  expect(validateBoundaryBaseline(baseline)).toEqual(baseline);
  for(const invalid of [{},files,{...baseline,version:2},{...baseline,extra:true},{...baseline,files:{}},{...baseline,opaqueProcesses:[...opaque,...opaque]},{...baseline,opaqueProcesses:[{pid:0,starttime:'200'}]},{...baseline,opaqueProcesses:[{pid:20,starttime:'-1'}]},{...baseline,opaqueProcesses:[{pid:20,starttime:'200',path:'private-TOKEN'}]}]){
   expect(()=>validateBoundaryBaseline(invalid)).toThrow(/^BOUNDARY_BASELINE_INVALID$/);
  }
 }finally{vi.doUnmock('node:fs/promises');vi.resetModules();await rm(root,{recursive:true,force:true});}
});
