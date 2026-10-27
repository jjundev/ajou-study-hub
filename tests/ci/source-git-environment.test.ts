import { afterEach, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSourceGit } from '../../tools/ci/source-git-environment.js';
const exec=promisify(execFile);let root='';
afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true});root='';});
async function fixture(){
 root=await mkdtemp(join(tmpdir(),'hub-source-git-'));const app=join(root,'app'),temp=join(root,'temp'),output=join(root,'github-env');await mkdir(app);await mkdir(temp);
 const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(root,'empty-global')};
 await exec('git',['init'],{cwd:app,env,timeout:15000});return {app,temp,output,env};
}
test('isolates system/global config and templates before any Reader source checkout',async()=>{
 const f=await fixture();await prepareSourceGit(f.app,f.temp,f.output,f.env);
 const text=await readFile(f.output,'utf8'),env={...f.env,...Object.fromEntries(text.trim().split('\n').map(line=>{const split=line.indexOf('=');return [line.slice(0,split),line.slice(split+1)];}))};
 const config=(await exec('git',['config','--list'],{cwd:f.app,env,timeout:15000})).stdout;
 expect(config).toContain('core.sparsecheckoutcone=false');expect(config).toContain('core.fsmonitor=false');expect(config).not.toMatch(/credential\.|filter\.|hookspath/);
 expect(text).toContain('GIT_CONFIG_NOSYSTEM=1\n');expect(text).toContain('GIT_ATTR_NOSYSTEM=1\n');expect(text).toContain('GIT_TEMPLATE_DIR=');
 const source=join(root,'synthetic-source');await mkdir(source);await exec('git',['init'],{cwd:source,env,timeout:15000});
 expect(await readFile(join(source,'.git','info','exclude'),'utf8')).toBe('');
 expect(await readdir(join(source,'.git','hooks'))).toEqual(['README']);
});
test.each(['credential.helper','core.hooksPath','core.fsmonitor','url.https://evil.test/.insteadOf','filter.evil.smudge','include.path'])('rejects effective dangerous local Git setting %s without leaking its value',async key=>{
 const f=await fixture();await exec('git',['config','--local',key,'private-value'],{cwd:f.app,env:f.env,timeout:15000});
 await expect(prepareSourceGit(f.app,f.temp,f.output,f.env)).rejects.toThrow('CI_SOURCE_GIT_UNSAFE');
});
test('rejects inherited command configuration and existing source destination before source work',async()=>{
 const f=await fixture();for(const key of ['GIT_CONFIG_COUNT','GIT_ASKPASS','SSH_ASKPASS','GIT_EXTERNAL_DIFF','GIT_EXEC_PATH'])await expect(prepareSourceGit(f.app,f.temp,f.output,{...f.env,[key]:'private-command'})).rejects.toThrow('CI_SOURCE_GIT_UNSAFE');
 await mkdir(join(root,'sources'));await writeFile(join(root,'sources','private'),'synthetic');await expect(prepareSourceGit(f.app,f.temp,f.output,f.env)).rejects.toThrow('CI_SOURCE_GIT_UNSAFE');
});
test.each([
 ['GIT_TRACE','1'],['GIT_TRACE','0'],['GIT_TRACE',''],['GIT_TRACE_CURL','1'],['GIT_TRACE_REDACT','0'],
 ['GIT_TRACE2_EVENT','0'],['GIT_TRACE_FUTURE','trace-canary'],['GIT_CURL_VERBOSE','1'],['GIT_CURL_VERBOSE','0'],['GIT_CURL_VERBOSE',''],
 ['git_trace_curl','trace-canary'],['git_curl_verbose','trace-canary'],
])('rejects present inherited tracing variable %s with value %j before any exports',async(key,value)=>{
 const f=await fixture();
 await expect(prepareSourceGit(f.app,f.temp,f.output,{...f.env,[key]:value})).rejects.toThrow(/^CI_SOURCE_GIT_UNSAFE$/);
 expect(await readdir(f.temp)).toEqual([]);
 await expect(readFile(f.output,'utf8')).rejects.toMatchObject({code:'ENOENT'});
});
test('rejects an unredacted file trace before Git invocation or GitHub environment writes',async()=>{
 const f=await fixture(),trace=join(root,'reader-auth-canary.trace');
 const env={...f.env,GIT_TRACE:trace,GIT_TRACE_REDACT:'0',SYNTHETIC_READER_TOKEN:'reader-auth-canary'};
 let message='resolved';try{await prepareSourceGit(f.app,f.temp,f.output,env);}catch(error){message=(error as Error).message;}
 expect({message,files:await readdir(f.temp),traceCreated:(await readdir(root)).includes('reader-auth-canary.trace')}).toEqual({message:'CI_SOURCE_GIT_UNSAFE',files:[],traceCreated:false});
 expect(message).not.toContain('reader-auth-canary');
 await expect(readFile(f.output,'utf8')).rejects.toMatchObject({code:'ENOENT'});
});
