import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fixedUploadConfig as fixedConfig } from './wrangler-upload.js';
import { validateSettings, type DeploymentSettings } from './access.js';
import { assertReleaseProof, assertRuntimeFresh } from './release-proof.js';
import { assertCurrentSources } from '../source-binding.js';
import { inventory } from './bootstrap.js';
import { assertCurrentBundle } from '../runtime-server.js';
import { verificationProject } from '../verification-project.js';
import { validateReportPath, type BuildReport } from '../content/report.js';
import { validatePublicSettings, type PublicDeploymentSettings } from './worker-target.js';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function validateProjectConfig(root:string):Promise<string>{
 const path=resolve(root,'wrangler.jsonc');if((await lstat(path)).isSymbolicLink())throw Error('Symlink Wrangler configuration');
 const text=await readFile(path,'utf8');const config=JSON.parse(text);
 const expected={name:'ajou-study-hub',compatibility_date:'2026-10-24',assets:{directory:'./dist',html_handling:'none',not_found_handling:'404-page'}};
 // Deliberately reject unknown options, env/main/routes/hooks/run_worker_first, even if harmless today.
 if(!same(config,expected))throw Error('Unreviewed Wrangler configuration');return text;
}
/** Share identical verified, owned artifact sealing across manual and automatic authorization. */
export async function withSealedArtifact<T>(
 project:string,
 authorize:()=>Promise<void>,
 upload:(directory:string,configPath:string,manifest:BuildReport)=>Promise<T>,
 options?:{publicTarget:PublicDeploymentSettings},
):Promise<T>{
 const canonical=await verificationProject();
 const root=project===canonical?canonical:await verificationProject(project);
 const publicTarget=options && structuredClone(options.publicTarget);
 if(publicTarget)validatePublicSettings(publicTarget);
 const settingsPath=resolve(root,publicTarget?'.local/public-deployment.json':'.local/deployment.json');
 const readSettingsText=async()=>{
  if((await lstat(resolve(root,'.local'))).isSymbolicLink()||!(await lstat(settingsPath)).isFile())throw Error('Unsafe deployment settings path');
  return readFile(settingsPath,'utf8');
 };
 const deploymentText=await readSettingsText();
 const configured:unknown=JSON.parse(deploymentText);
 let settings:DeploymentSettings|PublicDeploymentSettings;
 if(publicTarget){
  validatePublicSettings(configured);
  if(Object.keys(publicTarget).some(key=>!same(publicTarget[key as keyof PublicDeploymentSettings],configured[key as keyof PublicDeploymentSettings])))
   throw Error('Public deployment settings changed');
  settings=publicTarget;
 }else{
  validateSettings(configured);
  if(configured.previewUrls.length)throw Error('Private release requires disabled previews');
  settings=configured;
 }
 const dist=resolve(root,'dist'),reportPath=resolve(root,'.reports/app-build.json');
 const proofPath=resolve(root,'.reports/verification.json');
 for(const path of [reportPath,proofPath])await validateReportPath(path,[dist],root);
 const assertSettingsUnchanged=async()=>{
  if(await readSettingsText()!==deploymentText)throw Error('Deployment settings changed');
 };
 const configText=await validateProjectConfig(root);
 const exceptionsPath=resolve(root,'config/content-exceptions.json');
 if((await lstat(resolve(root,'config'))).isSymbolicLink()||(await lstat(exceptionsPath)).isSymbolicLink())throw Error('Symlink exceptions configuration');
 const exceptionsText=await readFile(exceptionsPath,'utf8');
 const reportText=await readFile(reportPath,'utf8'),proofText=await readFile(proofPath,'utf8');
 const manifest=JSON.parse(reportText) as BuildReport,proof=JSON.parse(proofText);
 await assertCurrentBundle(dist,manifest,root);await assertReleaseProof(root,dist,manifest,proof);
 await assertCurrentSources(root,proof.sourceBinding,manifest);
 if(!same(await inventory(dist),manifest.outputs))throw Error('Final bundle size/inventory mismatch');
 await authorize();
 // Owned copy, not hardlinks: a simultaneous dist rebuild cannot affect uploaded bytes.
 const owned=resolve(root,'.generated'),stage=resolve(owned,(publicTarget?'public-release-':'private-release-')+randomUUID());
 await mkdir(owned,{recursive:true});if((await lstat(owned)).isSymbolicLink()||await realpath(owned)!==owned)throw Error('Unsafe release staging root');
 await mkdir(stage);const directory=resolve(stage,'assets'),configPath=resolve(stage,'wrangler.json');
 try{
  await mkdir(directory);
  for(const f of manifest.outputs){const target=resolve(directory,f.path);await mkdir(dirname(target),{recursive:true});await copyFile(resolve(dist,f.path),target);}
  if(!same(await inventory(directory),manifest.outputs))throw Error('Changed bundle during sealing');
  await writeFile(configPath,JSON.stringify(fixedConfig(settings,directory)),{flag:'wx',mode:0o600});
  // Last live read is after all staging work. Then recheck every mutable local authorization input.
  await authorize();
  await assertSettingsUnchanged();if(await validateProjectConfig(root)!==configText)throw Error('Wrangler config changed');
  if((await lstat(exceptionsPath)).isSymbolicLink()||await readFile(exceptionsPath,'utf8')!==exceptionsText)throw Error('Exception policy changed');
  for(const [path,text] of [[reportPath,reportText],[proofPath,proofText]] as const){await validateReportPath(path,[dist],root);if(await readFile(path,'utf8')!==text)throw Error('Release proof changed');}
  await assertCurrentBundle(dist,manifest,root);
  await assertCurrentSources(root,proof.sourceBinding,manifest);
  await assertSettingsUnchanged();if(await validateProjectConfig(root)!==configText||await readFile(exceptionsPath,'utf8')!==exceptionsText)throw Error('Local configuration changed during source verification');
  for(const [path,text] of [[reportPath,reportText],[proofPath,proofText]] as const){await validateReportPath(path,[dist],root);if(await readFile(path,'utf8')!==text)throw Error('Release proof changed during source verification');}
  if(!same(await inventory(directory),manifest.outputs)||!same(JSON.parse(await readFile(configPath,'utf8')),fixedConfig(settings,directory)))throw Error('Sealed artifact changed');
  assertRuntimeFresh(manifest,proof);
  return await upload(directory,configPath,manifest);
 }finally{
  // Delete only this randomly-created direct child of the canonical owned staging root.
  if(dirname(stage)!==owned||await realpath(stage)!==stage||(await lstat(stage)).isSymbolicLink())throw Error('Unsafe release cleanup');
  await rm(stage,{recursive:true,force:true});
 }
}
