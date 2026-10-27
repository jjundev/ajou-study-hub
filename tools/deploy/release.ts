import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runWranglerUpload, parseUploadReceipt } from './wrangler-upload.js';
export { parseUploadReceipt };
import { readAccessSnapshot, settingsFingerprint, validateSettings, type DeploymentSettings, type ProtectionEvidence } from './access.js';
import { assertReleaseAllowed } from './guard.js';
import { verificationProject } from '../verification-project.js';
import { validateReportPath, writeReport, type BuildReport } from '../content/report.js';
export type ReleaseDependencies={readAccessSnapshot:typeof readAccessSnapshot;upload:(directory:string)=>Promise<{url:string;versionId:string}>};
type Options={settings:DeploymentSettings;distDir:string;reportPath:string;testProjectRoot?:string};
const version=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
import { withSealedArtifact } from './release-artifact.js';
import { assertRuntimeFresh } from './release-proof.js';
/** Manual release retains independent fresh identity evidence and its 24-hour guard. */
export async function releasePrivate(options:Options,deps?:ReleaseDependencies):Promise<{url:string;versionId:string;bundleHash:string}>{
 const root=await verificationProject(options.testProjectRoot);
 if(options.testProjectRoot&&!deps)throw Error('Isolated release requires synthetic dependencies');
 const settings=structuredClone(options.settings);validateSettings(settings);
 const dist=resolve(root,'dist'),reportPath=resolve(root,'.reports/app-build.json'),accessPath=resolve(root,'.reports/access-evidence.json');
 if(resolve(options.distDir)!==dist||resolve(options.reportPath)!==reportPath)throw Error('Canonical final app manifest/dist required');
 await validateReportPath(accessPath,[dist],root);
 const accessText=await readFile(accessPath,'utf8'),evidence=JSON.parse(accessText) as ProtectionEvidence;
 let manifest!:BuildReport,proof!:{createdAt:string};
 let fingerprint:string|undefined;
 let current:Awaited<ReturnType<typeof readAccessSnapshot>>;
 const authorize=async()=>{
  await validateReportPath(accessPath,[dist],root);
  if(await readFile(accessPath,'utf8')!==accessText)throw Error('Release evidence changed');
  const local=JSON.parse(await readFile(resolve(root,'.local/deployment.json'),'utf8'));validateSettings(local);
  if(settingsFingerprint(local)!==settingsFingerprint(settings))throw Error('Deployment settings changed');
  const snapshot=await (deps?.readAccessSnapshot??readAccessSnapshot)(settings);
  assertReleaseAllowed({settings,snapshot,evidence});current=snapshot;
  if(fingerprint!==undefined&&snapshot.fingerprint!==fingerprint)throw Error('Live Access policy changed');
  if(fingerprint===undefined){manifest=JSON.parse(await readFile(reportPath,'utf8'));proof=JSON.parse(await readFile(resolve(root,'.reports/verification.json'),'utf8'));await writeReport({status:'prepared-not-uploaded',bundleHash:manifest.bundleHash,acceptanceComplete:false,checkedAt:new Date().toISOString()},resolve(root,'.reports/private-release.json'),[dist],root);}
  fingerprint=snapshot.fingerprint;
 };
 const receiptPath=resolve(root,'.reports/private-release.json');
 return withSealedArtifact(root,authorize,async(directory,configPath)=>{
  // Repeat the time-sensitive manual assertion after the final source verification, without another API call.
  await validateReportPath(accessPath,[dist],root);if(await readFile(accessPath,'utf8')!==accessText)throw Error('Release evidence changed');
  assertReleaseAllowed({settings,snapshot:current!,evidence});
  await writeReport({status:'upload-started-outcome-unknown',bundleHash:manifest.bundleHash,acceptanceComplete:false,checkedAt:new Date().toISOString()},receiptPath,[dist,directory],root);
  assertRuntimeFresh(manifest!,proof!);assertReleaseAllowed({settings,snapshot:current!,evidence});
  const receipt=await (deps?.upload??((dir:string)=>runWranglerUpload(root,dir,configPath,settings)))(directory);
  if(receipt.url!==settings.productionUrl||!version.test(receipt.versionId))throw Error('Invalid upload receipt; inspect target before retrying');
  await writeReport({...receipt,bundleHash:manifest.bundleHash,uploadedAt:new Date().toISOString(),status:'uploaded-acceptance-pending',acceptanceComplete:false,policyFingerprint:fingerprint,settingsFingerprint:settingsFingerprint(settings)},receiptPath,[dist,directory],root);
  return {...receipt,bundleHash:manifest.bundleHash};
 });
}
export async function runPrivateRelease():Promise<void>{
 try{
 const root=await verificationProject(),settings=JSON.parse(await readFile(resolve(root,'.local/deployment.json'),'utf8'));
 await releasePrivate({settings,distDir:resolve(root,'dist'),reportPath:resolve(root,'.reports/app-build.json')});
 console.log('Private bundle uploaded; real post-deploy AC-12/13 acceptance remains pending');
 }catch{throw Error('Private release failed; no successful acceptance is claimed. Inspect local receipt before retrying.');}
}
