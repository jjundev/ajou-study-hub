import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec=promisify(execFile);
const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const inside=(root:string,path:string)=>{const rel=relative(root,path);return !rel||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));};
async function git(project:string,...args:string[]) {
 try {return (await exec('git',args,{cwd:project,encoding:'utf8',maxBuffer:8*1024*1024})).stdout;}
 catch {throw Error('BOUNDARY_GIT_UNREADABLE');}
}
export async function credentialConfigurationFingerprint(project:string):Promise<string> {
 // Read effective config including includes, but never log values (helpers can contain credentials).
 const config=await git(project,'config','--null','--list','--show-origin');
 if(/(?:credential\.[^\n\0]*|http\.[^\n\0]*extraheader|core\.(?:sshcommand|hookspath)|url\.[^\n\0]*insteadof)\n/i.test(config))throw Error('BOUNDARY_CREDENTIAL_CONFIG');
 return hash(config);
}
async function optionalFile(path:string):Promise<string> {
 try {if(!(await lstat(path)).isFile()||await realpath(path)!==path)throw Error();return hash(await readFile(path));}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return hash('absent');throw Error('BOUNDARY_CONFIG_UNREADABLE');}
}
/** Captured immediately after trusted checkout, before dependency or material execution. */
export async function captureTrustedFiles(project:string):Promise<Record<string,string>> {
 const root=await realpath(project);
 if(await realpath((await git(root,'rev-parse','--show-toplevel')).trim())!==root)throw Error('BOUNDARY_PROJECT_INVALID');
 const files=(await git(root,'ls-files','-z')).split('\0').filter(Boolean).sort();
 if(!files.length)throw Error('BOUNDARY_BASELINE_INVALID');
 const result:Record<string,string>={};
 for(const file of files){
  const target=resolve(root,file);
  try {
   if(file.startsWith('@')||!inside(root,target)||(await lstat(target)).isSymbolicLink()||await realpath(target)!==target)throw Error();
   result[file]=hash(await readFile(target));
  } catch {throw Error('BOUNDARY_TRUST_CHANGED');}
 }
 result['@git-index']=hash(await git(root,'ls-files','--stage','-z'));
 result['@git-head']=hash(await git(root,'rev-parse','--verify','HEAD'));
 result['@git-config']=await credentialConfigurationFingerprint(root);
 result['@untracked']=hash(await git(root,'ls-files','--others','--exclude-standard','-z'));
 const gitDir=await realpath(resolve(root,(await git(root,'rev-parse','--git-dir')).trim()));
 result['@local-config']=await optionalFile(resolve(gitDir,'config'));
 const hooks=resolve(gitDir,'hooks');
 for(const name of (await readdir(hooks)).sort())result['@hook/'+name]=await optionalFile(resolve(hooks,name));
 // Fingerprint credential stores and runtime settings, including absence, without retaining bytes.
 for(const name of ['.git-credentials','.netrc','.npmrc','.config/git/credentials'])result['@home/'+name]=await optionalFile(resolve(homedir(),name));
 return result;
}
export type ProcessMetadata={pid:number;ppid:number;uid:number;cwd:string;executable:string};
/** Metadata only: no command arguments, environment, or process termination. */
export function assertNoRelevantProcesses(rows:ProcessMetadata[],self:number,uid:number,project:string):void {
 if(!rows.some(row=>row.pid===self&&row.uid===uid))throw Error('BOUNDARY_PROCESS_UNREADABLE');
 const ancestors=new Set<number>();let cursor=self;
 while(cursor&&!ancestors.has(cursor)){ancestors.add(cursor);cursor=rows.find(p=>p.pid===cursor)?.ppid??0;}
 for(const row of rows){
  if(row.uid!==uid||ancestors.has(row.pid))continue;
  const relevant=inside(project,row.cwd)||/^(?:node|nodejs|chrome|chromium|firefox|webkit.*|MiniBrowser|WebKit.*|esbuild|workerd|vite|wrangler)(?:[.-].*)?$/.test(basename(row.executable));
  if(relevant||ancestors.has(row.ppid)&&row.ppid===self)throw Error('BOUNDARY_LIVE_PROCESS');
 }
}
export async function linuxProcesses(procRoot='/proc',ownUid=process.getuid?.()):Promise<ProcessMetadata[]> {
 const rows:ProcessMetadata[]=[];
 let stage:'LIST'|'STATUS'|'FIELDS'|'CWD'|'EXE'='LIST';
 try {
  for(const entry of await readdir(procRoot)){
   if(!/^\d+$/.test(entry))continue;
   try {
    stage='STATUS';
    const status=await readFile(resolve(procRoot,entry,'status'),'utf8');
    stage='FIELDS';
    const uid=Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]);
    const ppid=Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]);
    if(!Number.isSafeInteger(uid)||!Number.isSafeInteger(ppid))throw Error('invalid');
    // Other users cannot be workload children; never inspect their executable/cwd.
    if(uid!==ownUid)continue;
    stage='CWD';const cwd=await readlink(resolve(procRoot,entry,'cwd'));
    stage='EXE';const executable=await readlink(resolve(procRoot,entry,'exe'));
    rows.push({pid:Number(entry),ppid,uid,cwd,executable});
   } catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
 } catch(error){
  const code=(error as NodeJS.ErrnoException)?.code;
  const errno=typeof code==='string'&&['ENOENT','ESRCH','EACCES','EPERM','EINVAL','EISDIR','EIO','EMFILE','ENFILE'].includes(code)?code:'UNKNOWN';
  throw Error('BOUNDARY_PROCESS_'+stage+'_'+errno);
 }
 return rows;
}
export async function assertCleanBoundary(project:string,trustedFiles:Record<string,string>):Promise<void> {
 if(!trustedFiles||Object.keys(trustedFiles).length<3||!trustedFiles['@git-index']||!trustedFiles['@git-config']||Object.values(trustedFiles).some(v=>!/^[a-f0-9]{64}$/.test(v)))throw Error('BOUNDARY_BASELINE_INVALID');
 if(['GH_TOKEN','GITHUB_TOKEN','STUDY_HUB_READER_PRIVATE_KEY','STUDY_HUB_READER_APP_ID','GIT_ASKPASS','SSH_ASKPASS','GIT_CONFIG_COUNT','GIT_CONFIG_PARAMETERS'].some(name=>process.env[name]))throw Error('BOUNDARY_CREDENTIAL_RESIDUE');
 const current=await captureTrustedFiles(project);
 if(JSON.stringify(current)!==JSON.stringify(trustedFiles))throw Error('BOUNDARY_TRUST_CHANGED');
 if(process.platform!=='linux'||!process.getuid)throw Error('BOUNDARY_UNSUPPORTED_PLATFORM');
 assertNoRelevantProcesses(await linuxProcesses(),process.pid,process.getuid(),await realpath(project));
 // Detection only. Task 6 must establish actual isolation separately before activation.
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 (async()=>{
  const project=fileURLToPath(new URL('../../',import.meta.url));
  if(await realpath(process.cwd())!==await realpath(project))throw Error('BOUNDARY_PROJECT_INVALID');
  const [command,path,...rest]=process.argv.slice(2);
  if(command==='probe-processes'&&!path&&!rest.length){
   if(process.platform!=='linux'||!process.getuid)throw Error('BOUNDARY_UNSUPPORTED_PLATFORM');
   await linuxProcesses();return;
  }
  if(rest.length||!path||!isAbsolute(path))throw Error('BOUNDARY_ARGUMENTS_INVALID');
  if(command==='capture')await writeFile(path,JSON.stringify(await captureTrustedFiles(project)),{flag:'wx',mode:0o600});
  else if(command==='check')await assertCleanBoundary(project,JSON.parse(await readFile(path,'utf8')));
  else throw Error('BOUNDARY_ARGUMENTS_INVALID');
 })().catch(error=>{const code=error instanceof Error&&/^BOUNDARY_[A-Z_]+$/.test(error.message)?error.message:'BOUNDARY_FAILED';process.stderr.write(code+'\n');process.exitCode=1;});
}
