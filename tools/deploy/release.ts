import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fixedUploadConfig as fixedConfig, runWranglerUpload, parseUploadReceipt } from './wrangler-upload.js';
export { parseUploadReceipt };
import { readAccessSnapshot, settingsFingerprint, validateSettings, type DeploymentSettings, type ProtectionEvidence } from './access.js';
import { assertReleaseAllowed } from './guard.js';
import { assertReleaseProof, assertRuntimeFresh } from './release-proof.js';
import { assertCurrentSources } from '../source-binding.js';
import { inventory } from './bootstrap.js';
import { assertCurrentBundle } from '../runtime-server.js';
import { verificationProject } from '../verification-project.js';
import { validateReportPath, writeReport, type BuildReport } from '../content/report.js';
export type ReleaseDependencies={readAccessSnapshot:typeof readAccessSnapshot;upload:(directory:string)=>Promise<{url:string;versionId:string}>};
type Options={settings:DeploymentSettings;distDir:string;reportPath:string;testProjectRoot?:string};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const version=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function validateProjectConfig(root:string):Promise<string>{
 const path=resolve(root,'wrangler.jsonc');if((await lstat(path)).isSymbolicLink())throw Error('Symlink Wrangler configuration');
 const text=await readFile(path,'utf8');const config=JSON.parse(text);
 const expected={name:'ajou-study-hub',compatibility_date:'2026-10-24',assets:{directory:'./dist',html_handling:'none',not_found_handling:'404-page'}};
 // Deliberately reject unknown options, env/main/routes/hooks/run_worker_first, even if harmless today.
 if(!same(config,expected))throw Error('Unreviewed Wrangler configuration');return text;
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
 let deploymentText:string|undefined;
 const readSettings=async()=>{const path=resolve(root,'.local/deployment.json');if((await lstat(resolve(root,'.local'))).isSymbolicLink()||(await lstat(path)).isSymbolicLink())throw Error('Symlink settings');const text=await readFile(path,'utf8'),value=JSON.parse(text);validateSettings(value);if(settingsFingerprint(value)!==settingsFingerprint(settings)||(deploymentText!==undefined&&deploymentText!==text))throw Error('Deployment settings changed');deploymentText=text;};
 await readSettings();const configText=await validateProjectConfig(root);
 const exceptionsPath=resolve(root,'config/content-exceptions.json');
 if((await lstat(resolve(root,'config'))).isSymbolicLink()||(await lstat(exceptionsPath)).isSymbolicLink())throw Error('Symlink exceptions configuration');
 const exceptionsText=await readFile(exceptionsPath,'utf8');
 const reportText=await readFile(reportPath,'utf8'),proofText=await readFile(proofPath,'utf8'),accessText=await readFile(accessPath,'utf8');
 const manifest=JSON.parse(reportText) as BuildReport,proof=JSON.parse(proofText),evidence=JSON.parse(accessText) as ProtectionEvidence;
 await assertCurrentBundle(dist,manifest,root);await assertReleaseProof(root,dist,manifest,proof);
 await assertCurrentSources(root,proof.sourceBinding,manifest);
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
  await assertCurrentSources(root,proof.sourceBinding,manifest);
  await readSettings();if(await validateProjectConfig(root)!==configText||await readFile(exceptionsPath,'utf8')!==exceptionsText)throw Error('Local configuration changed during source verification');
  for(const [path,text] of [[reportPath,reportText],[proofPath,proofText],[accessPath,accessText]] as const){await validateReportPath(path,[dist],root);if(await readFile(path,'utf8')!==text)throw Error('Release proof changed during source verification');}
  if(!same(await inventory(directory),manifest.outputs)||!same(JSON.parse(await readFile(configPath,'utf8')),fixedConfig(settings,directory)))throw Error('Sealed artifact changed');
  await writeReport({status:'upload-started-outcome-unknown',bundleHash:manifest.bundleHash,acceptanceComplete:false,checkedAt:new Date().toISOString()},receiptPath,[dist,directory],root);
  assertRuntimeFresh(manifest,proof);
  assertReleaseAllowed({settings,snapshot:current,evidence});
  const receipt=await (deps?.upload??((dir:string)=>runWranglerUpload(root,dir,configPath,settings)))(directory);
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
