import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { readAccessSnapshot, settingsFingerprint, validateSettings, type DeploymentSettings, type ProtectionEvidence } from './access.js';
import { assertReleaseAllowed } from './guard.js';
import { assertReleaseProof } from './release-proof.js';
import { inventory } from './bootstrap.js';
import { assertCurrentBundle } from '../runtime-server.js';
import { verificationProject } from '../verification-project.js';
import { validateReportPath, writeReport, type BuildReport } from '../content/report.js';
export type ReleaseDependencies={readAccessSnapshot:typeof readAccessSnapshot;upload:(directory:string)=>Promise<{url:string;versionId:string}>};
type Options={settings:DeploymentSettings;distDir:string;reportPath:string;testProjectRoot?:string};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const version=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Wrangler 4.152.0 deploy prints an exact trigger URL and Current Version ID. */
export function parseUploadReceipt(output:string,expectedUrl:string):{url:string;versionId:string}{
 const clean=output.replace(/\x1b\[[0-9;]*m/g,'');
 const ids=[...clean.matchAll(/^Current Version ID:\s*(\S+)\s*$/gm)];
 const urls=clean.split(/\r?\n/).map(s=>s.trim()).filter(s=>/^https?:\/\/\S+$/.test(s));
 if(ids.length!==1||!version.test(ids[0]![1]!)||urls.length!==1||urls[0]!==expectedUrl)throw Error('Upload receipt does not confirm the protected target/version');
 return {url:expectedUrl,versionId:ids[0]![1]!};
}
function fixedConfig(settings:DeploymentSettings,directory:string){return {name:settings.workerName,account_id:settings.accountId,compatibility_date:'2026-10-24',workers_dev:true,preview_urls:false,assets:{directory,html_handling:'none',not_found_handling:'404-page'}};}
async function validateProjectConfig(root:string):Promise<string>{
 const path=resolve(root,'wrangler.jsonc');if((await lstat(path)).isSymbolicLink())throw Error('Symlink Wrangler configuration');
 const text=await readFile(path,'utf8');const config=JSON.parse(text);
 const expected={name:'ajou-study-hub',compatibility_date:'2026-10-24',assets:{directory:'./dist',html_handling:'none',not_found_handling:'404-page'}};
 // Deliberately reject unknown options, env/main/routes/hooks/run_worker_first, even if harmless today.
 if(!same(config,expected))throw Error('Unreviewed Wrangler configuration');return text;
}
async function runWrangler(root:string,directory:string,configPath:string,settings:DeploymentSettings):Promise<{url:string;versionId:string}>{
 const config=fixedConfig(settings,directory);
 if(!same(JSON.parse(await readFile(configPath,'utf8')),config))throw Error('Changed sealed upload configuration');
 const env:NodeJS.ProcessEnv={};
 for(const name of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','CLOUDFLARE_API_TOKEN','NODE_EXTRA_CA_CERTS'])if(process.env[name])env[name]=process.env[name];
 Object.assign(env,{CLOUDFLARE_ACCOUNT_ID:settings.accountId,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_SANITIZE:'true',WRANGLER_LOG:'log',CI:'true',NO_COLOR:'1'});
 // A fresh isolated cwd/config means no dotenv, build hook, framework config or redirect discovery.
 const output=await new Promise<string>((done,reject)=>{
  const child=spawn(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'deploy','--config',configPath,'--strict','--autoconfig=false'],{cwd:dirname(configPath),env,stdio:['ignore','pipe','pipe']});
  let stdout='';child.stdout.on('data',b=>{stdout+=b.toString();if(stdout.length>1024*1024){child.kill();reject(Error('Upload output limit'));}});child.stderr.resume();
  child.once('error',()=>reject(Error('Wrangler upload could not start')));child.once('exit',code=>code===0?done(stdout):reject(Error('Wrangler upload failed; inspect target before retrying')));
 });
 return parseUploadReceipt(output,settings.productionUrl);
}
/** The sole private upload path. No rebuild, mutable dist hardlinks, or caller CLI overrides. */
export async function releasePrivate(options:Options,deps?:ReleaseDependencies):Promise<{url:string;versionId:string;bundleHash:string}>{
 const root=await verificationProject(options.testProjectRoot);
 if(options.testProjectRoot&&!deps)throw Error('Isolated release requires synthetic dependencies');
 const settings=structuredClone(options.settings);validateSettings(settings);if(settings.previewUrls.length)throw Error('Private release requires disabled previews');
 const dist=resolve(root,'dist'),reportPath=resolve(root,'.reports/app-build.json');
 if(resolve(options.distDir)!==dist||resolve(options.reportPath)!==reportPath)throw Error('Canonical final app manifest/dist required');
 const proofPath=resolve(root,'.reports/verification.json'),accessPath=resolve(root,'.reports/access-evidence.json');
 for(const path of [reportPath,proofPath,accessPath])await validateReportPath(path,[dist],root);
 const readSettings=async()=>{const path=resolve(root,'.local/deployment.json');if((await lstat(resolve(root,'.local'))).isSymbolicLink()||(await lstat(path)).isSymbolicLink())throw Error('Symlink settings');const value=JSON.parse(await readFile(path,'utf8'));validateSettings(value);if(settingsFingerprint(value)!==settingsFingerprint(settings))throw Error('Deployment settings changed');};
 await readSettings();const configText=await validateProjectConfig(root);
 const exceptionsPath=resolve(root,'config/content-exceptions.json');
 if((await lstat(resolve(root,'config'))).isSymbolicLink()||(await lstat(exceptionsPath)).isSymbolicLink())throw Error('Symlink exceptions configuration');
 const exceptionsText=await readFile(exceptionsPath,'utf8');
 const reportText=await readFile(reportPath,'utf8'),proofText=await readFile(proofPath,'utf8'),accessText=await readFile(accessPath,'utf8');
 const manifest=JSON.parse(reportText) as BuildReport,proof=JSON.parse(proofText),evidence=JSON.parse(accessText) as ProtectionEvidence;
 await assertCurrentBundle(dist,manifest,root);await assertReleaseProof(root,dist,manifest,proof);
 if(!same(await inventory(dist),manifest.outputs))throw Error('Final bundle size/inventory mismatch');
 const reader=deps?.readAccessSnapshot??readAccessSnapshot;
 const snapshot=await reader(settings);assertReleaseAllowed({settings,snapshot,evidence});
 // Owned copy, not hardlinks: a simultaneous dist rebuild cannot affect uploaded bytes.
 const owned=resolve(root,'.generated'),stage=resolve(owned,'private-release-'+randomUUID());
 await mkdir(owned,{recursive:true});if((await lstat(owned)).isSymbolicLink()||await realpath(owned)!==owned)throw Error('Unsafe release staging root');
 await mkdir(stage);const directory=resolve(stage,'assets'),configPath=resolve(stage,'wrangler.json');
 try{
  await mkdir(directory);
  for(const f of manifest.outputs){const target=resolve(directory,f.path);await mkdir(dirname(target),{recursive:true});await copyFile(resolve(dist,f.path),target);}
  if(!same(await inventory(directory),manifest.outputs))throw Error('Changed bundle during sealing');
  await writeFile(configPath,JSON.stringify(fixedConfig(settings,directory)),{flag:'wx',mode:0o600});
  const receiptPath=resolve(root,'.reports/private-release.json');
  await writeReport({status:'prepared-not-uploaded',bundleHash:manifest.bundleHash,acceptanceComplete:false,checkedAt:new Date().toISOString()},receiptPath,[dist,directory],root);
  // Last live read is after all staging work. Then recheck every mutable local authorization input.
  const current=await reader(settings);assertReleaseAllowed({settings,snapshot:current,evidence});
  if(current.fingerprint!==snapshot.fingerprint)throw Error('Live Access policy changed');
  await readSettings();if(await validateProjectConfig(root)!==configText)throw Error('Wrangler config changed');
  if((await lstat(exceptionsPath)).isSymbolicLink()||await readFile(exceptionsPath,'utf8')!==exceptionsText)throw Error('Exception policy changed');
  for(const [path,text] of [[reportPath,reportText],[proofPath,proofText],[accessPath,accessText]] as const){await validateReportPath(path,[dist],root);if(await readFile(path,'utf8')!==text)throw Error('Release proof changed');}
  await assertCurrentBundle(dist,manifest,root);
  if(!same(await inventory(directory),manifest.outputs)||!same(JSON.parse(await readFile(configPath,'utf8')),fixedConfig(settings,directory)))throw Error('Sealed artifact changed');
  await writeReport({status:'upload-started-outcome-unknown',bundleHash:manifest.bundleHash,acceptanceComplete:false,checkedAt:new Date().toISOString()},receiptPath,[dist,directory],root);
  const receipt=await (deps?.upload??((dir:string)=>runWrangler(root,dir,configPath,settings)))(directory);
  if(receipt.url!==settings.productionUrl||!version.test(receipt.versionId))throw Error('Invalid upload receipt; inspect target before retrying');
  await writeReport({...receipt,bundleHash:manifest.bundleHash,uploadedAt:new Date().toISOString(),status:'uploaded-acceptance-pending',acceptanceComplete:false,policyFingerprint:current.fingerprint,settingsFingerprint:settingsFingerprint(settings)},receiptPath,[dist,directory],root);
  return {...receipt,bundleHash:manifest.bundleHash};
 }finally{
  // Delete only this randomly-created direct child of the canonical owned staging root.
  if(dirname(stage)!==owned||await realpath(stage)!==stage||(await lstat(stage)).isSymbolicLink())throw Error('Unsafe release cleanup');
  await rm(stage,{recursive:true,force:true});
 }
}
export async function runPrivateRelease():Promise<void>{
 try{
 const root=await verificationProject(),settings=JSON.parse(await readFile(resolve(root,'.local/deployment.json'),'utf8'));
 await releasePrivate({settings,distDir:resolve(root,'dist'),reportPath:resolve(root,'.reports/app-build.json')});
 console.log('Private bundle uploaded; real post-deploy AC-12/13 acceptance remains pending');
 }catch{throw Error('Private release failed; no successful acceptance is claimed. Inspect local receipt before retrying.');}
}
