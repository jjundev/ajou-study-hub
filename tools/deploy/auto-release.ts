import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verificationProject } from '../verification-project.js';
import { writeReport, validateReportPath, type BuildReport } from '../content/report.js';
import { settingsFingerprint, validateSettings, verifyPolicyBoundNonDisclosure, type DeploymentSettings } from './access.js';
import { assertAutomationAllowed, validateBaseline, type AutomationBaseline } from './access-baseline.js';
import { readAccessInspection, type AccessInspection } from './access-policy.js';
import { withSealedArtifact } from './release-artifact.js';
import { runWranglerUpload } from './wrangler-upload.js';
import { assertRuntimeFresh } from './release-proof.js';
import { representativePaths } from '../representatives.js';

/** No browser, API credential, cookie jar, automatic redirect, or raw response logging. */
async function anonymousBlocked(settings:DeploymentSettings,inspection:AccessInspection,directory:string):Promise<void>{
 const catalog=JSON.parse(await readFile(resolve(directory,'catalog.json'),'utf8'));
 const paths=['catalog.json',...representativePaths.map(([courseId,sourcePath])=>{
  const doc=catalog.documents.find((d:any)=>d.courseId===courseId&&d.sourcePath===sourcePath);
  if(!doc)throw Error('Missing protected representative');return doc.url.slice(1) as string;
 })];
 const request={get:async(url:string)=>{
  const response=await fetch(url,{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(30000)});
  const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>1024*1024)throw Error('Probe response too large');chunks.push(next.value);}}finally{await reader.cancel();}
  const body=Buffer.concat(chunks);
  if(response.status===403&&!/\bCloudflare Access\b/i.test(body.toString('utf8')))throw Error('Unrecognized denial');
  return {status:()=>response.status,headers:()=>Object.fromEntries(response.headers),body:async()=>body,json:async()=>JSON.parse(body.toString('utf8'))};
 }};
 for(const path of paths){const expected=await readFile(resolve(directory,decodeURIComponent(path)));if(!await verifyPolicyBoundNonDisclosure(request,new URL('/'+path,settings.productionUrl).href,inspection.snapshot.authDomain,expected))throw Error('Anonymous protection unverified');}
}
/** Minimal automatic release: approved stable protection, current proof, one sealed upload, live postcheck. */
export async function releaseAutomatic(settings:DeploymentSettings,baseline:AutomationBaseline):Promise<{url:string;versionId:string;bundleHash:string}>{
 settings=structuredClone(settings);baseline=structuredClone(baseline);validateSettings(settings);validateBaseline(baseline);
 const root=await verificationProject(),dist=resolve(root,'dist'),receiptPath=resolve(root,'.reports/automatic-release.json'),baselinePath=resolve(root,'.reports/automation-baseline.json');
 await validateReportPath(baselinePath,[dist],root);const baselineText=await readFile(baselinePath,'utf8');
 if(JSON.stringify(JSON.parse(baselineText))!==JSON.stringify(baseline))throw Error('Automation baseline changed');
 const local=async()=>{
  await validateReportPath(baselinePath,[dist],root);if(await readFile(baselinePath,'utf8')!==baselineText)throw Error('Automation baseline changed');
  const configured=JSON.parse(await readFile(resolve(root,'.local/deployment.json'),'utf8'));validateSettings(configured);
  if(settingsFingerprint(configured)!==settingsFingerprint(settings))throw Error('Deployment settings changed');
 };
 let current:AccessInspection,manifest!:BuildReport,proof!:{createdAt:string};
 const authorize=async()=>{await local();if(!manifest){manifest=JSON.parse(await readFile(resolve(root,'.reports/app-build.json'),'utf8'));proof=JSON.parse(await readFile(resolve(root,'.reports/verification.json'),'utf8'));}current=await readAccessInspection(settings);assertAutomationAllowed(settings,current,baseline);await anonymousBlocked(settings,current,dist);};
 await writeReport({status:'prepared-not-uploaded',acceptanceComplete:false},receiptPath,[dist],root);
 return withSealedArtifact(root,authorize,async(directory,configPath)=>{
  await local();assertAutomationAllowed(settings,current!,baseline);
  await writeReport({status:'upload-started-outcome-unknown',previousVersionId:current!.versionId,bundleHash:manifest.bundleHash,acceptanceComplete:false},receiptPath,[dist,directory],root);
  let receipt:{url:string;versionId:string};
  assertRuntimeFresh(manifest,proof);assertAutomationAllowed(settings,current!,baseline);
  try{receipt=await runWranglerUpload(root,directory,configPath,settings);}catch{throw Error('Automatic upload outcome unknown; inspect current target before retrying');}
  if(receipt.url!==settings.productionUrl||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(receipt.versionId))throw Error('Invalid upload receipt; inspect current target');
  await writeReport({status:'uploaded-postcheck-pending',versionId:receipt.versionId,bundleHash:manifest.bundleHash,acceptanceComplete:false},receiptPath,[dist,directory],root);
  const active=await readAccessInspection(settings);assertAutomationAllowed(settings,active,baseline);
  await writeReport({status:'uploaded-postcheck-pending',versionId:receipt.versionId,currentVersionId:active.versionId,bundleHash:manifest.bundleHash,acceptanceComplete:false},receiptPath,[dist,directory],root);
  await local();if(active.versionId!==receipt.versionId)throw Error('Active version mismatch');
  await anonymousBlocked(settings,active,directory);
  await writeReport({status:'published-protection-verified',versionId:receipt.versionId,bundleHash:manifest.bundleHash,acceptanceComplete:false},receiptPath,[dist,directory],root);
  return {...receipt,bundleHash:manifest.bundleHash};
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void(async()=>{
 if(process.argv.length!==2)throw Error('No automatic release overrides');
 const root=await verificationProject();
 const settings=JSON.parse(await readFile(resolve(root,'.local/deployment.json'),'utf8')),baseline=JSON.parse(await readFile(resolve(root,'.reports/automation-baseline.json'),'utf8'));
 await releaseAutomatic(settings,baseline);console.log('Automatic publication protection verified');
})().catch(()=>{console.error('Automatic publication failed; inspect safe local receipt and current target before retrying');process.exitCode=1;});
