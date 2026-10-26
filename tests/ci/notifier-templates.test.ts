import { mkdtemp, readFile, rm, readdir, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { generateNotifiers } from '../../tools/ci/notifier-templates.js';

test('notifier_has_no_checkout and writes five standalone restricted workflows',async()=>{
 const project=await mkdtemp(join(tmpdir(),'hub-notifiers-'));
 try {
  const files=await generateNotifiers(project);
  expect(Object.keys(files).sort()).toEqual(['circuits-2','data-structures','life-science','logic-lab','ml-basics']);
  for(const [id,path] of Object.entries(files)) {
   expect(path).toBe(join(project,'.generated','source-notifiers',id+'.yml'));
   const raw=await readFile(path,'utf8'), workflow=parse(raw),job=workflow.jobs.notify;
   expect(workflow.on.push.branches).toEqual(['main']);
   expect(workflow.on.workflow_dispatch).toEqual({});
   expect(workflow.permissions).toEqual({});
   expect(job['timeout-minutes']).toBe(5);
   expect(job.env).toBeUndefined();
   expect(job.steps.filter((s:any)=>s.uses).map((s:any)=>s.uses)).toEqual(['actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349']);
   expect(job.steps[0].with).toMatchObject({owner:'jjundev',repositories:'ajou-study-hub','permission-actions':'write'});
   expect(job.steps[1].env).toEqual({GH_TOKEN:'${{ steps.dispatch-token.outputs.token }}'});
   expect(raw).not.toMatch(/checkout|\bPAT\b|github\.event|github\.repository|tools\/|set -x/);
   expect(job.steps[1].run).toContain('https://api.github.com/repos/jjundev/ajou-study-hub/actions/workflows/study-hub-update.yml/dispatches');
   expect(job.steps[1].run).toContain('"ref":"main"');
   const repositories:Record<string,string>={'logic-lab':'jjundev/ajou-nonhoesil','life-science':'jjundev/ajou-life-science','circuits-2':'jjundev/ajou-electronic-circuits-2','data-structures':'jjundev/ajou-jagual','ml-basics':'jjundev/ajou-ml-basics'};
   const script=job.steps[1].run.split("<<'NODE'\n")[1].replace(/\nNODE\n?$/,'');
   const execute=new Function('fetch','process','console',`return (async()=>{${script}})()`);
   const calls:{url:string;options:RequestInit}[]=[],logs:string[]=[];
   const fakeProcess={env:{GH_TOKEN:'test-token'},exitCode:0};
   await execute(async(url:string,options:RequestInit)=>{calls.push({url,options});return new Response(null,{status:204});},fakeProcess,{error:(s:string)=>logs.push(s)});
   expect(calls).toHaveLength(1);
   expect(JSON.parse(String(calls[0]!.options.body))).toEqual({ref:'main',inputs:{source_repository:repositories[id]}});
   expect(calls[0]!.options.redirect).toBe('error');
   expect(logs).toEqual([]);
   await execute(async()=>{throw Error('test-token');},fakeProcess,{error:(s:string)=>logs.push(s)});
   expect(logs).toEqual(['Study hub dispatch failed.']);
   expect(fakeProcess.exitCode).toBe(1);
  }
  expect(await readdir(project)).toEqual(['.generated']);
 } finally {await rm(project,{recursive:true,force:true});}
});
test('generator refuses an output directory symlink',async()=>{
 const project=await mkdtemp(join(tmpdir(),'hub-notifiers-')),other=await mkdtemp(join(tmpdir(),'hub-outside-'));
 try {await mkdir(join(project,'.generated'));await symlink(other,join(project,'.generated','source-notifiers'),'junction');await expect(generateNotifiers(project)).rejects.toThrow();expect(await readdir(other)).toEqual([]);}
 finally {await rm(project,{recursive:true,force:true});await rm(other,{recursive:true,force:true});}
});
