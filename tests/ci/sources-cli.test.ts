import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile),temps:string[]=[];
afterEach(async()=>{await Promise.all(temps.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const cli=fileURLToPath(new URL('../../tools/ci/sources-cli.ts',import.meta.url));
const loader=new URL('../../node_modules/tsx/dist/loader.mjs',import.meta.url).href;
async function run(project:string,args:string[]){
 try{const result=await exec(process.execPath,['--import',loader,cli,...args],{cwd:project,timeout:20000});return {code:0,...result};}
 catch(error){const result=error as {code:number;stdout:string;stderr:string};return {code:result.code,stdout:result.stdout,stderr:result.stderr};}
}
test('real CLI contains malformed commands and revision files without raw errors or settings writes',async()=>{
 const project=await mkdtemp(join(tmpdir(),'private-cli-TOKEN-'));temps.push(project);
 const invalid=join(project,'private-revisions.json');await writeFile(invalid,'private invalid JSON TOKEN');
 for(const [args,code] of [[[],'CI_SOURCE_COMMAND_INVALID'],[['bind','a'.repeat(40),join(project,'private-missing')],'CI_BIND_INPUT_FAILED'],[['bind','a'.repeat(40),invalid],'CI_BIND_INPUT_FAILED']] as const){
  expect(await run(project,[...args])).toEqual({code:1,stdout:'',stderr:JSON.stringify({code})+'\n'});
 }
 await writeFile(invalid,'[]');
 expect(await run(project,['bind','MAIN',invalid])).toEqual({code:1,stdout:'',stderr:'{"code":"CI_BIND_APP_SHA_INVALID"}\n'});
 expect(await run(project,['bind','a'.repeat(40),invalid])).toEqual({code:1,stdout:'',stderr:'{"code":"CI_BIND_REVISIONS_INVALID"}\n'});
 await expect(readFile(join(project,'.local/ci-sources.json'))).rejects.toMatchObject({code:'ENOENT'});
});
