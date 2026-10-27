import { execFile } from 'node:child_process';
import { appendFile, lstat, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
const exec=promisify(execFile);
function fail():never{throw Error('CI_SOURCE_GIT_UNSAFE');}
/** Fresh job-scoped Git configuration; never edits machine/user config or persistent hooksPath. */
export async function prepareSourceGit(project:string,temp:string,output:string,env:NodeJS.ProcessEnv=process.env):Promise<void>{
 try{
  if([project,temp,output].some(value=>!value||/[\r\n\0]/.test(value))||Object.keys(env).some(key=>/^(?:GIT_CONFIG_(?:COUNT|PARAMETERS|KEY_\d+|VALUE_\d+)|GIT_EXEC_PATH|GIT_TEMPLATE_DIR|GIT_SSH(?:_COMMAND)?|GIT_PROXY_COMMAND|GIT_ASKPASS|SSH_ASKPASS|GIT_EXTERNAL_DIFF|GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_COMMON_DIR|GIT_CONFIG|GIT_ATTR_SOURCE)$/.test(key)&&env[key]!==undefined))fail();
  const root=await realpath(project),directory=await realpath(temp);
  try{await lstat(resolve(root,'../sources'));fail();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const version=await exec('git',['--version'],{cwd:root,env,timeout:15000,maxBuffer:4096});
  const match=/^git version (\d+)\.(\d+)\./.exec(version.stdout);if(!match||Number(match[1])<2||Number(match[1])===2&&Number(match[2])<28)fail();
  const scope=await mkdtemp(resolve(directory,'study-hub-git-')),global=resolve(scope,'config'),templates=resolve(scope,'templates'),attributes=resolve(scope,'attributes');
  // The pinned non-cone action appends .git/info/sparse-checkout; retain its parent without any hooks.
  await mkdir(resolve(templates,'info'),{recursive:true});await writeFile(resolve(templates,'info','exclude'),'',{flag:'wx'});
  // Existing trust capture fingerprints the hooks directory. README is inert and is never a hook name.
  await mkdir(resolve(templates,'hooks'));await writeFile(resolve(templates,'hooks','README'),'',{flag:'wx',mode:0o600});
  await writeFile(attributes,'',{flag:'wx'});await writeFile(global,'',{flag:'wx'});
  const controlled={...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:global,GIT_ATTR_NOSYSTEM:'1',GIT_TEMPLATE_DIR:templates,GIT_TERMINAL_PROMPT:'0',GIT_LFS_SKIP_SMUDGE:'1',GIT_NO_REPLACE_OBJECTS:'1'};
  for(const [key,value] of [['core.sparseCheckoutCone','false'],['core.fsmonitor','false'],['core.autocrlf','false'],['core.attributesFile',attributes]])await exec('git',['config','--file',global,key,value],{cwd:root,env:controlled,timeout:15000,maxBuffer:4096});
  const config=(await exec('git',['config','--null','--list'],{cwd:root,env:controlled,timeout:15000,maxBuffer:1024*1024})).stdout;
  for(const entry of config.split('\0').filter(Boolean)){
   const split=entry.indexOf('\n'),key=entry.slice(0,split).toLowerCase(),value=entry.slice(split+1);
   if(split<0||/^(?:credential\.|filter\.|include\.|includeif\.)/.test(key)||/^core\.(?:hookspath|sshcommand|gitproxy)$/.test(key)||key==='core.fsmonitor'&&value!=='false'||/^url\..*\.(?:insteadof|pushinsteadof)$/.test(key)||/^http\..*extraheader$/.test(key)||key==='init.templatedir')fail();
  }
  await appendFile(output,Object.entries(controlled).filter(([key])=>['GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_ATTR_NOSYSTEM','GIT_TEMPLATE_DIR','GIT_TERMINAL_PROMPT','GIT_LFS_SKIP_SMUDGE','GIT_NO_REPLACE_OBJECTS'].includes(key)).map(([key,value])=>key+'='+value+'\n').join(''));
 }catch{fail();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 (async()=>{if(process.argv.length!==2||process.platform!=='linux'||!process.env.RUNNER_TEMP||!process.env.GITHUB_ENV)fail();await prepareSourceGit(process.cwd(),process.env.RUNNER_TEMP,process.env.GITHUB_ENV);})().catch(()=>{process.stderr.write('CI_SOURCE_GIT_UNSAFE\n');process.exitCode=1;});
}
