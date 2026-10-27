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
export type OpaqueProcess={pid:number;starttime:string};
export type BoundaryBaseline={version:1;files:Record<string,string>;opaqueProcesses:OpaqueProcess[]};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function validateOpaqueProcesses(value:unknown):asserts value is OpaqueProcess[] {
 if(!Array.isArray(value)||value.length>4096||value.some(item=>!record(item)||Object.keys(item).sort().join(',')!=='pid,starttime'||!Number.isSafeInteger(item.pid)||Number(item.pid)<=0||Number(item.pid)>2147483647||typeof item.starttime!=='string'||!(/^(?:0|[1-9]\d{0,19})$/).test(item.starttime)||BigInt(item.starttime)>18446744073709551615n)||new Set(value.map(item=>item.pid)).size!==value.length)throw Error('BOUNDARY_BASELINE_INVALID');
}
export function validateBoundaryBaseline(value:unknown):BoundaryBaseline {
 if(!record(value)||Object.keys(value).sort().join(',')!=='files,opaqueProcesses,version'||value.version!==1||!record(value.files)||Object.keys(value.files).length<3||!value.files['@git-index']||!value.files['@git-config']||Object.values(value.files).some(hash=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)))throw Error('BOUNDARY_BASELINE_INVALID');
 validateOpaqueProcesses(value.opaqueProcesses);
 return value as BoundaryBaseline;
}
async function processVanished(procRoot:string,pid:number,error:unknown):Promise<boolean> {
 if((error as NodeJS.ErrnoException)?.code!=='ENOENT')return false;
 try{await lstat(resolve(procRoot,String(pid)));return false;}
 catch(missing){if((missing as NodeJS.ErrnoException)?.code==='ENOENT')return true;throw missing;}
}
async function processStarttime(procRoot:string,pid:number):Promise<string> {
 const stat=await readFile(resolve(procRoot,String(pid),'stat'),'utf8'),close=stat.lastIndexOf(')');
 const fields=stat.slice(close+2).trim().split(/\s+/),starttime=fields[19];
 if(!stat.startsWith(pid+' (')||close<0||stat[close+1]!==' '||!/^[RSDZTtXxKWPI]$/.test(fields[0]??'')||fields.slice(1,20).some(field=>! /^-?\d+$/.test(field))||!starttime||!/^(?:0|[1-9]\d{0,19})$/.test(starttime)||BigInt(starttime)>18446744073709551615n)throw Error('invalid');
 return starttime;
}
function ancestorPids(rows:Pick<ProcessMetadata,'pid'|'ppid'>[],self:number):Set<number> {
 const ancestors=new Set<number>();let cursor=self;
 while(cursor&&!ancestors.has(cursor)){ancestors.add(cursor);cursor=rows.find(p=>p.pid===cursor)?.ppid??0;}
 return ancestors;
}
/** Metadata only: no command arguments, environment, or process termination. */
export function assertNoRelevantProcesses(rows:ProcessMetadata[],self:number,uid:number,project:string):void {
 if(!rows.some(row=>row.pid===self&&row.uid===uid))throw Error('BOUNDARY_PROCESS_UNREADABLE');
 const ancestors=ancestorPids(rows,self);
 for(const row of rows){
  if(row.uid!==uid||ancestors.has(row.pid))continue;
  const relevant=inside(project,row.cwd)||/^(?:node|nodejs|chrome|chromium|firefox|webkit.*|MiniBrowser|WebKit.*|esbuild|workerd|vite|wrangler)(?:[.-].*)?$/.test(basename(row.executable));
  if(relevant||ancestors.has(row.ppid)&&row.ppid===self)throw Error('BOUNDARY_LIVE_PROCESS');
 }
}
async function scanLinuxProcesses(procRoot:string,ownUid:number|undefined,self:number,trustedOpaque:OpaqueProcess[]|null):Promise<{rows:ProcessMetadata[];opaqueProcesses:OpaqueProcess[]}> {
 const rows:ProcessMetadata[]=[];
 const opaqueProcesses:OpaqueProcess[]=[];
 let stage:'LIST'|'STATUS'|'FIELDS'|'CWD'|'EXE'|'STAT'='LIST';
 type UidRole='ALL_MATCH'|'EFFECTIVE_OTHER'|'SAVED_OR_FS_OTHER'|'UNKNOWN';
 let uidRole:UidRole='UNKNOWN';
 const identities:(Pick<ProcessMetadata,'pid'|'ppid'|'uid'>&{uidRole:UidRole})[]=[];
 try {
  for(const entry of await readdir(procRoot)){
   if(!/^\d+$/.test(entry))continue;
   try {
    stage='STATUS';
    const status=await readFile(resolve(procRoot,entry,'status'),'utf8');
    stage='FIELDS';
    const uid=Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]);
    const ppid=Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]);
    if(!Number.isSafeInteger(uid)||!Number.isSafeInteger(ppid)||Number(entry)<=0||Number(entry)>2147483647)throw Error('invalid');
    // Categorize credential roles without retaining their raw values.
    const roles=/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m.exec(status)?.slice(1).map(Number);
    if(!roles?.every(Number.isSafeInteger))throw Error('invalid');
    uidRole=roles[1]!==ownUid?'EFFECTIVE_OTHER':roles.slice(2).some(value=>value!==ownUid)?'SAVED_OR_FS_OTHER':'ALL_MATCH';
    identities.push({pid:Number(entry),ppid,uid,uidRole});
   } catch(error){if(!await processVanished(procRoot,Number(entry),error))throw error;}
  }
  // Resolve the existing ancestor exemption before protected cwd/exe reads.
  // Keep self readable and fail on every unknown non-ancestor denial.
  const ancestors=ancestorPids(identities,self);
  for(const identity of identities){
   const expected=trustedOpaque?.find(process=>process.pid===identity.pid);
   // Check present baseline PIDs even if now readable or their UID/ancestry changed.
   if(expected){
    stage='STAT';
    try{if(await processStarttime(procRoot,identity.pid)!==expected.starttime)throw Error('BOUNDARY_OPAQUE_IDENTITY_CHANGED');}
    catch(error){if(await processVanished(procRoot,identity.pid,error))continue;throw error;}
   }
   if(identity.uid!==ownUid||identity.pid!==self&&ancestors.has(identity.pid))continue;
   uidRole=identity.uidRole;
   try{
    stage='CWD';const cwd=await readlink(resolve(procRoot,String(identity.pid),'cwd'));
    stage='EXE';const executable=await readlink(resolve(procRoot,String(identity.pid),'exe'));
    rows.push({pid:identity.pid,ppid:identity.ppid,uid:identity.uid,cwd,executable});
   } catch(error){
    if(await processVanished(procRoot,identity.pid,error))continue;
    if((error as NodeJS.ErrnoException)?.code==='EACCES'&&identity.pid!==self&&(trustedOpaque===null||expected)){
     stage='STAT';
     try{
      const starttime=await processStarttime(procRoot,identity.pid);
      if(expected&&starttime!==expected.starttime)throw Error('BOUNDARY_OPAQUE_IDENTITY_CHANGED');
      if(trustedOpaque===null)opaqueProcesses.push({pid:identity.pid,starttime});
      continue;
     }catch(statError){if(await processVanished(procRoot,identity.pid,statError))continue;throw statError;}
    }
    throw error;
   }
  }
 } catch(error){
  if(error instanceof Error&&error.message==='BOUNDARY_OPAQUE_IDENTITY_CHANGED')throw Error('BOUNDARY_OPAQUE_IDENTITY_CHANGED');
  const code=(error as NodeJS.ErrnoException)?.code;
  const errno=typeof code==='string'&&['ENOENT','ESRCH','EACCES','EPERM','EINVAL','EISDIR','EIO','EMFILE','ENFILE'].includes(code)?code:'UNKNOWN';
  throw Error('BOUNDARY_PROCESS_'+stage+'_'+errno+(['CWD','EXE'].includes(stage)?'_UID_'+uidRole:''));
 }
 return {rows,opaqueProcesses};
}
export async function linuxProcesses(procRoot='/proc',ownUid=process.getuid?.(),self=process.pid,trustedOpaque:OpaqueProcess[]=[]):Promise<ProcessMetadata[]> {
 validateOpaqueProcesses(trustedOpaque);
 return (await scanLinuxProcesses(procRoot,ownUid,self,trustedOpaque)).rows;
}
/** Only trusted initial capture can record an opaque platform identity. */
export async function captureOpaqueProcesses(procRoot='/proc',ownUid=process.getuid?.(),self=process.pid):Promise<OpaqueProcess[]> {
 const result=await scanLinuxProcesses(procRoot,ownUid,self,null);
 if(!result.rows.some(row=>row.pid===self&&row.uid===ownUid))throw Error('BOUNDARY_PROCESS_UNREADABLE');
 validateOpaqueProcesses(result.opaqueProcesses);
 return result.opaqueProcesses;
}
export async function captureBoundaryBaseline(project:string):Promise<BoundaryBaseline> {
 const files=await captureTrustedFiles(project);
 if(process.platform!=='linux'||!process.getuid)throw Error('BOUNDARY_UNSUPPORTED_PLATFORM');
 return {version:1,files,opaqueProcesses:await captureOpaqueProcesses()};
}
export async function assertCleanBoundary(project:string,baseline:unknown):Promise<void> {
 const trusted=validateBoundaryBaseline(baseline);
 if(['GH_TOKEN','GITHUB_TOKEN','STUDY_HUB_READER_PRIVATE_KEY','STUDY_HUB_READER_APP_ID','GIT_ASKPASS','SSH_ASKPASS','GIT_CONFIG_COUNT','GIT_CONFIG_PARAMETERS'].some(name=>process.env[name]))throw Error('BOUNDARY_CREDENTIAL_RESIDUE');
 const current=await captureTrustedFiles(project);
 if(JSON.stringify(current)!==JSON.stringify(trusted.files))throw Error('BOUNDARY_TRUST_CHANGED');
 if(process.platform!=='linux'||!process.getuid)throw Error('BOUNDARY_UNSUPPORTED_PLATFORM');
 assertNoRelevantProcesses(await linuxProcesses('/proc',process.getuid(),process.pid,trusted.opaqueProcesses),process.pid,process.getuid(),await realpath(project));
 // Detection under ordinary CI trust, including initially opaque platform identities; not isolation.
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 (async()=>{
  const project=fileURLToPath(new URL('../../',import.meta.url));
  if(await realpath(process.cwd())!==await realpath(project))throw Error('BOUNDARY_PROJECT_INVALID');
  const [command,path,...rest]=process.argv.slice(2);
  if(rest.length||!path||!isAbsolute(path))throw Error('BOUNDARY_ARGUMENTS_INVALID');
  if(command==='capture')await writeFile(path,JSON.stringify(await captureBoundaryBaseline(project)),{flag:'wx',mode:0o600});
  else if(command==='probe-processes'){
   const trusted=validateBoundaryBaseline(JSON.parse(await readFile(path,'utf8')));
   if(process.platform!=='linux'||!process.getuid)throw Error('BOUNDARY_UNSUPPORTED_PLATFORM');
   const rows=await linuxProcesses('/proc',process.getuid(),process.pid,trusted.opaqueProcesses);
   if(!rows.some(row=>row.pid===process.pid&&row.uid===process.getuid!()))throw Error('BOUNDARY_PROCESS_UNREADABLE');
  }
  else if(command==='check')await assertCleanBoundary(project,JSON.parse(await readFile(path,'utf8')));
  else throw Error('BOUNDARY_ARGUMENTS_INVALID');
 })().catch(error=>{const code=error instanceof Error&&/^BOUNDARY_[A-Z_]+$/.test(error.message)?error.message:'BOUNDARY_FAILED';process.stderr.write(code+'\n');process.exitCode=1;});
}
