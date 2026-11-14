import { readFile, mkdtemp, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
const load=async()=>parse(await readFile(new URL('../../.github/workflows/study-hub-update.yml',import.meta.url),'utf8'));
const exec=promisify(execFile);
test('default_disabled_has_no_early_cloud_credentials and serializes production work',async()=>{
 const workflow=await load(),job=workflow.jobs.verify;
 expect(workflow.concurrency).toEqual({group:'study-hub-production','cancel-in-progress':false});
 expect(workflow.on.push.branches).toEqual(['main']);
 expect(Object.keys(workflow.on).sort()).toEqual(['push','workflow_dispatch']);
 expect(workflow.on.workflow_dispatch.inputs.mode.default).toBe('default');
 expect(workflow.permissions).toEqual({contents:'read',actions:'read'});
 expect(job['runs-on']).toBe('ubuntu-24.04');
 expect(job['timeout-minutes']).toBe(60);
 expect(job.env).toBeUndefined();
 expect(JSON.stringify(workflow)).not.toMatch(/STUDY_HUB_LEDGER|deploy:private|deploy:bootstrap/);
 const publish=job.steps.find((s:any)=>s.id==='publish');expect(publish.if).toContain("vars.STUDY_HUB_AUTOMATIC_UPDATES == 'enabled'");
 const steps=job.steps;
 expect(steps.filter((s:any)=>s.uses).every((s:any)=>/@[a-f0-9]{40}$/.test(s.uses))).toBe(true);
 expect(steps.find((s:any)=>s.id==='reader').with['permission-contents']).toBe('read');
 expect(steps.find((s:any)=>s.id==='summary-upload').with).toMatchObject({path:'app/ci-summary.json','retention-days':7});
 expect(steps.find((s:any)=>s.id==='summary-upload').with.name)
  .toContain("format('verify-metadata-{0}', github.run_attempt)");
});
test('app and five sources use fixed SHA refs without persisted credentials',async()=>{
 const workflow=await load(),steps=workflow.jobs.verify.steps;
 const checkouts=steps.filter((s:any)=>s.uses?.startsWith('actions/checkout@'));
 expect(checkouts).toHaveLength(6);
 expect(checkouts[0].with).toMatchObject({repository:'jjundev/ajou-study-hub',ref:'${{ github.sha }}',path:'app'});
 for(const step of checkouts){expect(step.with['persist-credentials']).toBe(false);expect(step.with['set-safe-directory']).toBe(false);}
 for(const step of checkouts.slice(1)){expect(step.with.ref).toMatch(/^\$\{\{ steps\.revisions\.outputs\.[a-z_0-9]+ \}\}$/);expect(step.with.path).toMatch(/^sources\//);}
 const revoke=steps.findIndex((s:any)=>s.id==='revoke-reader'),browser=steps.findIndex((s:any)=>s.id==='browsers');
 expect(revoke).toBeGreaterThan(steps.indexOf(checkouts.at(-1)));expect(browser).toBeGreaterThan(revoke);
 for(const step of steps.slice(revoke+1)){expect(JSON.stringify(step.env??{})).not.toMatch(/reader\.outputs\.token|LEDGER/);if(!['compare-public-inputs','publish'].includes(step.id))expect(JSON.stringify(step.env??{})).not.toContain('secrets.');}
});

test('sources use trusted generated exact non-cone selection and bounded checks before binding',async()=>{
 const steps=(await load()).jobs.verify.steps,reader=steps.findIndex((s:any)=>s.id==='reader');
 const prepare=steps.findIndex((s:any)=>s.id==='source-git'),patterns=steps.findIndex((s:any)=>s.id==='sparse'),probe=steps.findIndex((s:any)=>s.id==='sparse-probe');
 expect(prepare).toBeGreaterThan(-1);expect(prepare).toBeLessThan(steps.findIndex((s:any)=>s.name?.startsWith('Record trusted')));
 expect(patterns).toBeLessThan(reader);expect(patterns).toBeGreaterThan(prepare);expect(probe).toBeLessThan(reader);expect(probe).toBeGreaterThan(patterns);
 const sources=steps.filter((s:any)=>s.uses?.startsWith('actions/checkout@')&&s.with.path.startsWith('sources/'));
 for(const source of sources){const key=source.with.path.slice('sources/'.length).replaceAll('-','_');expect(source.with['sparse-checkout']).toBe('${{ steps.sparse.outputs.'+key+' }}');expect(source.with['sparse-checkout-cone-mode']).toBe(false);expect(source.with.lfs).toBe(false);expect(source.with.submodules).toBe(false);}
 const limits=steps.findIndex((s:any)=>s.id==='source-limits');expect(limits).toBe(steps.findIndex((s:any)=>s.id==='revoke-reader')+1);
 expect(limits).toBeLessThan(steps.findIndex((s:any)=>s.name==='Install trusted application dependencies'));
 expect(steps[limits].run.indexOf('tools/ci/source-limits.ts')).toBeLessThan(steps[limits].run.indexOf('sources-cli.ts bind'));
});

test('synthetic E2E failure prints test diagnostics and still fails the workflow shell',async()=>{
 const steps=(await load()).jobs.verify.steps;
 const step=steps.find((s:any)=>s.name==='Typecheck and synthetic tests');
 const command=step.run.trim().split('\n').find((line:string)=>line.startsWith('npm run test:e2e'));
 const bash=process.platform==='win32'?resolve((await exec('git',['--exec-path'])).stdout.trim(),'../../../bin/bash.exe'):'bash';
 let result:{code:number;stdout:string;stderr:string}|undefined;
 // Substitute only the external runner; exercise the actual workflow's shell redirections and failure branch.
 const runner="npm() { test \"$*\" = 'run test:e2e -- --reporter=line' || return 99; printf '%s\\n' 'synthetic.spec.ts:42 expected visible'; printf '%s\\n' 'synthetic browser launch failure' >&2; return 7; };\n";
 try{await exec(bash,['-e','-o','pipefail','-c',runner+command],{timeout:20000});}
 catch(error){result=error as typeof result;}
 expect(result?.code).toBe(1);
 expect(result?.stdout).toBe('synthetic.spec.ts:42 expected visible\nCI_E2E_FAILED\n');
 expect(result?.stderr).toBe('synthetic browser launch failure\n');
});
test('source allowlist guard rejects shell payloads and non-verify modes before token issuance',async()=>{
 const steps=(await load()).jobs.verify.steps;
 const guard=steps.find((s:any)=>s.id==='guard');
 const script=guard.run.split("<<'NODE'\n")[1].replace(/\nNODE\n?$/,'');
 const execute=new Function('process','console',script);
 for(const [source,mode,accepted] of [['','',true],['jjundev/ajou-jagual','verify',true],['','default',true],['jjundev/other','verify',false],['$(echo injected)','verify',false],['','auto',false]] as const){
  const logs:string[]=[],process={env:{SOURCE_REPOSITORY:source,MODE:mode},exitCode:0};
  execute(process,{error:(s:string)=>logs.push(s)});
  expect(process.exitCode).toBe(accepted?0:1);expect(logs).toEqual(accepted?[]:['CI_INPUT_REJECTED']);
 }
 expect(steps.indexOf(guard)).toBeLessThan(steps.findIndex((s:any)=>s.id==='reader'));
});

test('process metadata probes run before Reader and after synthetic tests before material build',async()=>{
 const steps=(await load()).jobs.verify.steps;
 const before=steps.findIndex((s:any)=>s.id==='process-probe'),after=steps.findIndex((s:any)=>s.id==='post-test-process-probe');
 expect(before).toBeGreaterThan(steps.findIndex((s:any)=>s.name?.startsWith('Record trusted checkout')));
 expect(before).toBeLessThan(steps.findIndex((s:any)=>s.id==='reader'));
 expect(after).toBe(steps.findIndex((s:any)=>s.name==='Typecheck and synthetic tests')+1);
 expect(after).toBeLessThan(steps.findIndex((s:any)=>s.name==='Build and verify the same pinned material checkout'));
 for(const index of [before,after]){
  expect(steps[index].run).toBe('node tools/ci/process-boundary.ts probe-processes "$RUNNER_TEMP/study-hub-trusted.json"');
  expect(steps[index].env).toBeUndefined();
 }
});

test('final process boundary uses native Node with the original baseline and no loader',async()=>{
 const step=(await load()).jobs.verify.steps.find((s:any)=>s.id==='boundary');
 const command=step.run.trim().split('\n')[0];
 const bash=process.platform==='win32'?resolve((await exec('git',['--exec-path'])).stdout.trim(),'../../../bin/bash.exe'):'bash';
 const shell="npm() { printf '%s\\n' 'SYNTHETIC_LOADER_USED' >&2; return 42; };\nnode() { test \"$#\" -eq 3 && test \"$1\" = tools/ci/process-boundary.ts && test \"$2\" = check && test \"$3\" = \"$RUNNER_TEMP/study-hub-trusted.json\" || return 43; printf '%s\\n' 'SYNTHETIC_NATIVE_BOUNDARY'; };\n";
 let result:{code:number;stdout:string;stderr:string};
 try{const output=await exec(bash,['-e','-o','pipefail','-c',shell+command],{env:{...process.env,RUNNER_TEMP:'/tmp/synthetic boundary TOKEN'},timeout:20000});result={code:0,...output};}
 catch(error){result=error as typeof result;}
 expect({code:result.code,stdout:result.stdout,stderr:result.stderr}).toEqual({code:0,stdout:'SYNTHETIC_NATIVE_BOUNDARY\n',stderr:''});
});
test('Reader revocation rejects API errors without exposing credential or response',async()=>{
 const step=(await load()).jobs.verify.steps.find((s:any)=>s.id==='revoke-reader');
 const script=step.run.split("<<'NODE'\n")[1].replace(/\nNODE\n?$/,'').replace('(async()=>{','return (async()=>{');
 for(const status of [204,401,500]){
  const logs:string[]=[],process={env:{GH_TOKEN:'secret-fixture'},exitCode:0};
  await new Function('fetch','process','console',script)(async(url:string,options:RequestInit)=>{
   expect(url).toBe('https://api.github.com/installation/token');expect(options.method).toBe('DELETE');expect(options.redirect).toBe('error');
   return new Response(null,{status});
  },process,{error:(s:string)=>logs.push(s)});
  expect(process.exitCode).toBe(status===204?0:1);expect(logs).toEqual(status===204?[]:['CI_READER_REVOCATION_FAILED']);
 }
});
test('source scripts are never invoked and both material commands use explicit settings',async()=>{
 const job=(await load()).jobs.verify;
 expect(job.defaults.run['working-directory']).toBe('app');
 const commands=job.steps.filter((s:any)=>s.run).map((s:any)=>s.run).join('\n');
 expect(commands).not.toMatch(/(?:cd|npm\s+--prefix|bash|sh)\s+[^\n]*sources\//);
 expect(commands).toContain('npm run build -- --sources .local/ci-sources.json');
 expect(commands).toContain('npm run verify:content -- --sources .local/ci-sources.json');
 expect(job.if).toContain("github.repository == 'jjundev/ajou-study-hub'");
 expect(job.if).toContain("github.ref == 'refs/heads/main'");
 expect(job.if).toContain('github.workflow_sha == github.sha');
});
test('native workflow boundary rejects credential helper in source checkout without leaking its value',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hub-source-credential-'));
 const app=join(root,'app'),source=join(root,'sources','synthetic');
 const env={...process.env,GIT_CONFIG_GLOBAL:join(root,'empty.gitconfig'),GIT_CONFIG_NOSYSTEM:'1',HOME:root,USERPROFILE:root};
 try {
  await mkdir(join(app,'tools','ci'),{recursive:true});await mkdir(source,{recursive:true});
  await writeFile(join(app,'package.json'),'{"type":"module"}');
  await copyFile(new URL('../../tools/ci/process-boundary.ts',import.meta.url),join(app,'tools','ci','process-boundary.ts'));
  await exec('git',['init'],{cwd:source,env});
  const step=(await load()).jobs.verify.steps.find((s:any)=>s.id==='boundary');
  const script=step.run.split("<<'NODE'\n")[1].replace(/\nNODE\n?$/,'');
  const run=async()=>{
   try {const result=await exec(process.execPath,['--input-type=module','--eval',script],{cwd:app,env});return {code:0,...result};}
   catch(error){const result=error as {code:number;stdout:string;stderr:string};return {code:result.code,stdout:result.stdout,stderr:result.stderr};}
  };
  expect(await run()).toEqual({code:0,stdout:'',stderr:''});
  await exec('git',['config','credential.helper','!synthetic-helper-must-never-execute'],{cwd:source,env});
  expect(await run()).toEqual({code:1,stdout:'',stderr:'BOUNDARY_SOURCE_CREDENTIAL_CONFIG\n'});
 } finally {await rm(root,{recursive:true,force:true});}
});

test('workflow bind wrapper preserves safe CLI stderr while discarding stdout and failing the step',async()=>{
 const root=await mkdtemp(join(tmpdir(),'private-bind-wrapper-TOKEN-'));
 try{
  const revisions=join(root,'private-revisions.json');await writeFile(revisions,'[]');
  const step=(await load()).jobs.verify.steps.find((s:any)=>s.id==='source-limits');
  const command=step.run.trim().split('\n').at(-1).replace('.local/revisions.json',"'"+revisions.replaceAll('\\','/')+"'");
  // Execute the actual workflow shell branch against a synthetic invalid baseline.
  const bash=process.platform==='win32'?resolve((await exec('git',['--exec-path'])).stdout.trim(),'../../../bin/bash.exe'):'bash';
  let result:{code:number;stdout:string;stderr:string}|undefined;
  try{await exec(bash,['-e','-o','pipefail','-c',command],{env:{...process.env,GITHUB_SHA:'MAIN'},timeout:20000});}
  catch(error){result=error as typeof result;}
  expect(result?.code).toBe(1);expect(result?.stdout).toBe('CI_BIND_FAILED\n');
  expect(result?.stderr).toBe('{"code":"CI_BIND_APP_SHA_INVALID"}\n');
  const success=await exec(bash,['-e','-o','pipefail','-c',"node() { printf '%s\\n' 'private success snapshot TOKEN'; };\n"+command],{env:{...process.env,GITHUB_SHA:'a'.repeat(40)},timeout:20000});
  expect(success.stdout).toBe('');expect(success.stderr).toBe('');
 }finally{await rm(root,{recursive:true,force:true});}
});


test('status metadata hydration uses scoped Reader before unconditional revocation and repeated post-revoke bind',async()=>{
 const steps=(await load()).jobs.verify.steps,hydrate=steps.findIndex((s:any)=>s.id==='hydrate-source-status'),revoke=steps.findIndex((s:any)=>s.id==='revoke-reader');
 expect(hydrate).toBe(revoke-1);expect(steps[hydrate].env).toEqual({GH_TOKEN:'${{ steps.reader.outputs.token }}'});
 expect(steps[hydrate].run).toBe('node --import tsx tools/ci/hydrate-source-status.ts');
 expect(steps[revoke].if).toContain('always()');expect(steps.findIndex((s:any)=>s.id==='source-limits')).toBeGreaterThan(revoke);
});


test('secrets and receipt handling remain bound to their steps',async()=>{
 const steps=(await load()).jobs.verify.steps,publish=steps.find((s:any)=>s.id==='publish'),boundary=steps.findIndex((s:any)=>s.id==='boundary');
 expect(steps.filter((s:any)=>s.env?.CLOUDFLARE_API_TOKEN).map((s:any)=>s.id)).toEqual(['publish']);
 expect(steps.filter((s:any)=>s.env?.CLOUDFLARE_READ_TOKEN).map((s:any)=>s.id)).toEqual(['compare-public-inputs','publish']);
 const compare=steps.find((s:any)=>s.id==='compare-public-inputs');
 expect(steps.indexOf(compare)).toBeGreaterThan(steps.findIndex((s:any)=>s.id==='source-limits'));
 expect(compare.env.GH_TOKEN).toBe('${{ github.token }}');
 expect(boundary).toBeGreaterThan(steps.findIndex((s:any)=>s.name==='Build and verify the same pinned material checkout'));
 expect(steps.indexOf(publish)).toBeGreaterThan(boundary);
 expect(publish.env).toEqual({STUDY_HUB_PUBLIC_DEPLOYMENT_SETTINGS:'${{ vars.STUDY_HUB_PUBLIC_DEPLOYMENT_SETTINGS }}',CLOUDFLARE_API_TOKEN:'${{ secrets.CLOUDFLARE_API_TOKEN }}',CLOUDFLARE_READ_TOKEN:'${{ secrets.CLOUDFLARE_READ_TOKEN }}'});
 expect(publish.run).toContain('validatePublicSettings(settings)');
 expect(publish.run).toContain("writeFile('.local/public-deployment.json'");
 expect(publish.run).toContain('npm run deploy:public');expect(publish.run).not.toMatch(/playwright|chromium|wrangler|deploy:private|deploy:automatic|ledger/i);
 expect(publish.run).not.toMatch(/\$\{\{/);expect(publish.run).toContain("{flag:'wx',mode:0o600}");
 const record=steps.find((s:any)=>s.id==='record-public-checkpoint');
 const upload=steps.find((s:any)=>s.id==='upload-public-checkpoint');
 expect(steps.indexOf(record)).toBeGreaterThan(steps.indexOf(publish));
 expect(steps.indexOf(upload)).toBeGreaterThan(steps.indexOf(record));
 expect(record.if).toContain("steps.publish.outcome == 'success'");
 expect(upload.if).toContain("steps.record-public-checkpoint.outcome == 'success'");
 expect(upload.with).toEqual({name:'public-checkpoint-${{ github.run_attempt }}',path:'app/.reports/public-checkpoint.json',
  'retention-days':7,'if-no-files-found':'error','include-hidden-files':false});
 const observe=steps.find((s:any)=>s.id==='observe-course-verification');
 expect(steps.indexOf(observe)).toBeGreaterThan(steps.indexOf(upload));
 expect(observe).toMatchObject({'continue-on-error':true,'timeout-minutes':12});
});

test('only eligible course updates may skip expensive steps', async () => {
 const steps = (await load()).jobs.verify.steps;
 const names = [
  'Install trusted application dependencies', 'Install three browsers', 'Typecheck and synthetic tests',
  'Probe process metadata after synthetic browsers before material build', 'Build and verify the same pinned material checkout',
  'Emit bounded metadata only', 'Upload safe metadata only', 'Publish the verified bundle to the public Worker',
 ];
 const course = 'jjundev/ajou-jagual';
 const scenarios = [
  { name:'matched course update', compare:true, skip:true },
  { name:'hub push', event:'push', compare:false, skip:false },
  { name:'regular manual or token rotation', source:'', compare:false, skip:false },
  { name:'verify only', mode:'verify', published:false, compare:false, skip:false },
  { name:'updates disabled', enabled:'disabled', published:false, compare:false, skip:false },
  { name:'observe mode', policy:'observe', compare:true, skip:false },
  { name:'course observe with changed inputs', coursePolicy:'observe', match:'false', changed:'life-science', observe:true, compare:true, skip:false },
  { name:'course observe works independently of unchanged skip', coursePolicy:'observe', policy:'', match:'false', changed:'logic-lab,ml-basics', observe:true, compare:true, skip:false },
  { name:'course observe follows an unchanged skip', coursePolicy:'observe', compare:true, skip:true },
  { name:'course observe without a comparable baseline', coursePolicy:'observe', match:'false', compare:true, skip:false },
  { name:'course observe cannot run after the comparison fails', coursePolicy:'observe', match:'false', changed:'life-science', comparisonFailed:true, compare:true, skip:false },
  { name:'course observe cannot run if the full path fails', coursePolicy:'observe', match:'false', changed:'life-science', publishFailed:true, compare:true, skip:false },
  { name:'default mode', policy:'', compare:false, skip:false },
  { name:'input mismatch', match:'false', compare:true, skip:false },
  { name:'fingerprint failure', fingerprintFailed:true, compare:false, skip:false },
  { name:'comparison failure', comparisonFailed:true, compare:true, skip:false },
  { name:'Reader or source validation failed', success:false, published:false, compare:false, skip:false },
  { name:'trusted boundary failed after match', boundaryFailed:true, published:false, compare:true, skip:true },
 ];
 for (const row of scenarios) {
  let success = row.success ?? true;
  const vars = { STUDY_HUB_AUTOMATIC_UPDATES:row.enabled ?? 'enabled', STUDY_HUB_UNCHANGED_DEPLOYMENTS:row.policy ?? 'skip',
   STUDY_HUB_COURSE_VERIFICATION:row.coursePolicy ?? '' };
  const inputs = { mode:row.mode ?? 'default', source_repository:row.source ?? course };
  const github = { event_name:row.event ?? 'workflow_dispatch' };
  const known: Record<string,{outputs:Record<string,string>;outcome?:string}> = {};
  const outcomes = new Map();
  for (const step of steps) {
   let run = success;
   if (step.if) {
    const expr = step.if.trim().slice(3,-2)
     .replace(/steps\.([a-z-]+)(?:\.outputs)?\.([a-z_]+)/g, (_:string, id:string, key:string) =>
      JSON.stringify(known[id]?.outputs[key] ?? (key==='outcome' ? known[id]?.outcome : undefined) ?? ''));
    run = (expr.includes('always()') || success) && new Function('success','always','vars','inputs','github',
     'return ('+expr+')')(() => success,() => true,vars,inputs,github);
   }
   outcomes.set(step.id ?? step.name, run);
   if (step.id) known[step.id] = {outcome:run ? 'success' : 'skipped',outputs:{}};
   if (run && step.id==='fingerprint-public-inputs') {
    known[step.id]!.outcome=row.fingerprintFailed ? 'failure' : 'success';
    known[step.id]!.outputs={input_hash:'f'.repeat(64),policy:vars.STUDY_HUB_UNCHANGED_DEPLOYMENTS};
   }
   if (run && step.id==='compare-public-inputs') {
    known[step.id]!.outcome=row.comparisonFailed ? 'failure' : 'success';
    known[step.id]!.outputs.match=row.match ?? 'true';
    known[step.id]!.outputs.changed_courses=row.changed ?? '';
   }
   if (run && step.id==='skip-public-deployment') known[step.id]!.outputs.skip='true';
   if (run && step.id==='publish' && row.publishFailed) {
    known[step.id]!.outcome='failure';
    success=false;
   }
   if (run && step.id==='boundary' && row.boundaryFailed) {
    known[step.id]!.outcome='failure';
    success=false;
   }
  }
  expect(outcomes.get('compare-public-inputs'),row.name).toBe(row.compare);
  expect(outcomes.get('skip-public-deployment'),row.name).toBe(row.skip);
  expect(outcomes.get('observe-course-verification') ?? false,row.name).toBe(row.observe ?? false);
  expect(outcomes.get('boundary'),row.name).toBe(row.success ?? true);
  expect(outcomes.get('Report the verified unchanged deployment'),row.name).toBe(row.skip && !row.boundaryFailed);
  for (const name of names) {
   const step=steps.find((candidate:any)=>candidate.name===name);
   expect(step,row.name).toBeDefined();
   expect(outcomes.get(step.id ?? name),row.name)
    .toBe((row.success ?? true) && !row.skip && (step.id!=='publish' || (row.published ?? true)));
  }
 }
});


test('publication summary exports only bounded allowlisted outcomes and fails on an invalid receipt',async()=>{
 const publish=(await load()).jobs.verify.steps.find((s:any)=>s.id==='publish'),script=publish.run.split("node --input-type=module <<'NODE'\n")[1].split('\nNODE')[0];
 const root=await mkdtemp(join(tmpdir(),'hub-publication-summary-')),summary=join(root,'summary');
 try{
  await mkdir(join(root,'.reports'));
  const value={status:'upload-started-outcome-unknown',previousVersionId:'11111111-1111-1111-1111-111111111111',bundleHash:'a'.repeat(64),privatePath:'private-canary',token:'secret-canary'};
  await writeFile(join(root,'.reports','public-release.json'),JSON.stringify(value));
  const result=await exec(process.execPath,['--input-type=module','--eval',script],{cwd:root,env:{...process.env,GITHUB_STEP_SUMMARY:summary},timeout:30000});
  expect(JSON.parse(result.stdout)).toMatchObject({status:value.status,bundleHash:value.bundleHash});expect(result.stderr).toBe('');
  const text=await readFile(summary,'utf8');expect(text).toContain('upload-started-outcome-unknown');expect(text).not.toContain('acceptanceComplete');expect(text).not.toMatch(/canary|privatePath|token/);
  const active = '22222222-2222-2222-2222-222222222222';
  const deploymentId = '33333333-3333-3333-3333-333333333333';
  const catalogHash = 'c'.repeat(64);
  await writeFile(join(root,'.reports','public-release.json'),JSON.stringify({
   ...value,status:'published-public-verified',versionId:active,currentVersionId:active,checked:1307,catalogHash,deploymentId,
  }));
  await exec(process.execPath,['--input-type=module','--eval',script],{cwd:root,env:{...process.env,GITHUB_STEP_SUMMARY:summary},timeout:30000});
  const published = await readFile(summary,'utf8');
  expect(published).toContain('"checked":1307');
  expect(published).toContain(catalogHash);
  expect(published).toContain(deploymentId);
  await writeFile(join(root,'.reports','public-release.json'),JSON.stringify({
   ...value,status:'published-public-verified',versionId:active,currentVersionId:active,checked:1307,catalogHash,
  }));
  await expect(exec(process.execPath,['--input-type=module','--eval',script],{cwd:root,env:{...process.env,GITHUB_STEP_SUMMARY:summary},timeout:30000}))
   .rejects.toMatchObject({code:1,stderr:'CI_PUBLICATION_RECEIPT_UNAVAILABLE_INSPECT_CURRENT_TARGET\n'});
  await writeFile(join(root,'.reports','public-release.json'),JSON.stringify({...value,versionId:'private-canary'}));
  const invalid=await exec(process.execPath,['--input-type=module','--eval',script],{cwd:root,env:{...process.env,GITHUB_STEP_SUMMARY:summary},timeout:30000}).then(()=>({code:0,stderr:''}),error=>({code:error.code,stderr:error.stderr}));
  expect(invalid).toEqual({code:1,stderr:'CI_PUBLICATION_RECEIPT_UNAVAILABLE_INSPECT_CURRENT_TARGET\n'});
  expect(await readFile(summary,'utf8')).toBe(published);
 }finally{await rm(root,{recursive:true,force:true});}
});
