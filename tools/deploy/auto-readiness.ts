import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verificationProject } from '../verification-project.js';
import { writeReport } from '../content/report.js';
import { assertLedgerBinding, type LedgerHead } from '../ci/ledger.js';
import { githubLedgerStore } from '../ci/ledger-github.js';
import { settingsFingerprint, validateSettings, type DeploymentSettings } from './access.js';
import { assertAutomationAllowed, validateBaseline, type AutomationBaseline } from './access-baseline.js';
import { digest, exactKeys, isRecord, readAccessInspection, type AccessInspection } from './access-policy.js';
import { freshTime, hashValue, validateHumanEvidence } from './human-approval.js';

export type AutomationReadiness={version:1;checkedAt:string;baselineHash:string;linuxRunId:string;initialVersionId:string;ledgerCommitSha:string;checks:{human:boolean;devices:boolean;linux:boolean;isolation:boolean;permissions:boolean;recovery:boolean;budget:boolean;sourceDiffAccepted:boolean}};
const keys=['human','devices','linux','isolation','permissions','recovery','budget','sourceDiffAccepted'];
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const runId=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
function fail():never{throw Error('Automatic publication readiness is unproven');}

/** Consumer assertion, not an evidence producer. A caller must obtain readiness from a reviewed issuer. */
export function assertAutomationReady(readiness:AutomationReadiness,baseline:AutomationBaseline,inspection:AccessInspection,ledger:LedgerHead,now:number):void{
 exactKeys(readiness,['version','checkedAt','baselineHash','linuxRunId','initialVersionId','ledgerCommitSha','checks']);
 exactKeys(readiness.checks,keys);
 if(readiness.version!==1||Object.values(readiness.checks).some(v=>v!==true)||!hashValue(readiness.baselineHash)||!runId(readiness.linuxRunId)||!uuid(readiness.initialVersionId)||!sha(readiness.ledgerCommitSha)||typeof readiness.checkedAt!=='string'||!Number.isFinite(now))fail();
 const checked=Date.parse(readiness.checkedAt);
 if(!Number.isFinite(checked)||new Date(checked).toISOString()!==readiness.checkedAt||checked>now)fail();
 validateBaseline(baseline);
 // Reconstruct the settings projection from the current inspection, then reuse its producer's validator.
 if(!isRecord(inspection)||!isRecord(inspection.snapshot)||!Array.isArray(inspection.snapshot.hosts)||inspection.snapshot.hosts.length!==1||!Array.isArray(inspection.snapshot.allowedEmails)||inspection.snapshot.allowedEmails.length!==1)fail();
 const s=inspection.snapshot;
 const settings:DeploymentSettings={accountId:s.accountId,workerName:s.workerName,accessAppId:s.accessAppId,allowedEmail:s.allowedEmails[0]!,productionUrl:s.hosts[0]!,previewUrls:[]};
 assertAutomationAllowed(settings,inspection,baseline);
 assertLedgerBinding(ledger,settingsFingerprint(settings),digest(baseline));
 if(readiness.baselineHash!==digest(baseline)||ledger.value.pending!==null||ledger.value.verified.versionId!==inspection.versionId||Date.parse(baseline.approvedAt)>checked)fail();
 if(ledger.value.verified.origin==='manual-initial'&&(!freshTime(readiness.checkedAt,now)||readiness.initialVersionId!==inspection.versionId||readiness.ledgerCommitSha!==ledger.commitSha))fail();
 // Automatic checkpoints advance head/version. Initial receipt and baseline do not expire daily.
 // The automatic run's successful exact attempt must additionally be checked by the future preflight.
}

/** Preparation only: no arbitrary supplied booleans can become successful operational proof. */
export function assessReadiness(settings:DeploymentSettings,baseline:AutomationBaseline,inspection:AccessInspection,ledger:LedgerHead,human:unknown,devices:unknown,now:number){
 validateSettings(settings);assertAutomationAllowed(settings,inspection,baseline);assertLedgerBinding(ledger,settingsFingerprint(settings),digest(baseline));
 validateHumanEvidence(human);exactKeys(devices,['mobileConfirmedAt','pcConfirmedAt']);
 if(!freshTime(human.checkedAt,now)||!freshTime(baseline.approvedAt,now)||!freshTime(devices.mobileConfirmedAt,now)||!freshTime(devices.pcConfirmedAt,now)||digest(human)!==baseline.humanEvidenceHash||human.settingsFingerprint!==settingsFingerprint(settings)||human.protectionFingerprint!==inspection.protectionFingerprint||ledger.value.pending!==null||ledger.value.verified.origin!=='manual-initial'||ledger.value.verified.versionId!==inspection.versionId)fail();
 return {ready:false as const,checkedAt:new Date(now).toISOString(),baselineHash:digest(baseline),initialVersionId:inspection.versionId,ledgerCommitSha:ledger.commitSha,
  checks:{human:true,devices:true,linux:false,isolation:false,permissions:false,recovery:false,budget:false,sourceDiffAccepted:false},
  missing:['LINUX_ACCEPTANCE_PRODUCER_MISSING','ISOLATION_PRODUCER_MISSING','PERMISSIONS_PRODUCER_MISSING','RECOVERY_EQUIVALENCE_PRODUCER_MISSING','BUDGET_PRODUCER_MISSING','SOURCE_DIFF_ACCEPTANCE_PRODUCER_MISSING','INITIAL_MANIFEST_ACCEPTANCE_PRODUCER_MISSING']};
}

/** Compares known verification metadata to an exact live Actions attempt; does not claim isolation/Linux acceptance. */
export function compareLinuxRun(summary:unknown,run:unknown,expectedRunId:string,attempt:number):void{
 exactKeys(summary,['appSha','counts','code']);exactKeys(summary.counts,['sources']);
 if(!sha(summary.appSha)||summary.counts.sources!==5||summary.code!=='VERIFY_ONLY_DETECTION_PASSED'||!runId(expectedRunId)||!Number.isSafeInteger(attempt)||attempt<1||!isRecord(run)||String(run.id)!==expectedRunId||run.run_attempt!==attempt||run.status!=='completed'||run.conclusion!=='success'||run.head_sha!==summary.appSha||run.head_branch!=='main'||run.path!=='.github/workflows/study-hub-update.yml'||!['push','workflow_dispatch','repository_dispatch'].includes(String(run.event))||!isRecord(run.repository)||run.repository.full_name!=='jjundev/ajou-study-hub'||!isRecord(run.head_repository)||run.head_repository.full_name!=='jjundev/ajou-study-hub')fail();
}
async function localJson(root:string,path:string):Promise<unknown>{
 const handle=await open(resolve(root,path),'r');
 try{
  const stat=await handle.stat();if(!stat.isFile()||stat.size>1024*1024)fail();
  const bytes=Buffer.alloc(1024*1024+1);let used=0;
  for(;;){const read=await handle.read(bytes,used,bytes.length-used,null);if(read.bytesRead===0)break;used+=read.bytesRead;if(used>1024*1024)fail();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used)));
 }finally{await handle.close();}
}
function boundedRead(request:typeof fetch):typeof fetch{
 const signal=AbortSignal.timeout(120_000);let requests=0;
 return async(input,init)=>{
  const url=new URL(String(input));
  if(++requests>1000||!['https://api.cloudflare.com','https://api.github.com'].includes(url.origin)||url.username||url.password||init?.method&&init.method!=='GET')fail();
  const response=await request(input,{...init,redirect:'error',signal});
  if(response.redirected||response.status>=300&&response.status<400||response.headers.has('location'))fail();
  const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>1024*1024))fail();
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader)try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>1024*1024)fail();chunks.push(chunk.value);}}finally{await reader.cancel();}
  return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
 };
}
/** Local operator command: invalidates output first, reads known producers, and emits only a blocked assessment. */
export async function runReadinessCli(args:string[],env:NodeJS.ProcessEnv,request:typeof fetch=fetch):Promise<void>{
 if(env.CI||args.length!==0&&!(args.length===4&&args[0]==='--linux-run'&&runId(args[1])&&args[2]==='--attempt'&&/^[1-9][0-9]{0,5}$/.test(args[3]!)))fail();
 const root=await verificationProject(),output=resolve(root,'.reports/automation-readiness.json'),dist=resolve(root,'dist');
 await writeReport({ready:false,status:'running'},output,[dist],root);
 try{
  request=boundedRead(request);
  const settings=await localJson(root,'.local/deployment.json');validateSettings(settings);
  const baseline=await localJson(root,'.reports/automation-baseline.json');validateBaseline(baseline);
  const human=await localJson(root,'.reports/production-access-evidence.json'),devices=await localJson(root,'.reports/device-acceptance.json');
  if(!env.CLOUDFLARE_READ_TOKEN||!env.GH_TOKEN)fail();
  const inspection=await readAccessInspection(settings,{token:env.CLOUDFLARE_READ_TOKEN,fetch:request});
  const ledger=await githubLedgerStore(env.GH_TOKEN,request).read();
  const assessment=assessReadiness(settings,baseline,inspection,ledger,human,devices,Date.now());
  let linuxObservation:unknown=null;
  if(args.length){
   const summary=await localJson(root,'.reports/linux-ci-summary.json');
   const response=await request(`https://api.github.com/repos/jjundev/ajou-study-hub/actions/runs/${args[1]}/attempts/${args[3]}`,{headers:{Authorization:'Bearer '+env.GH_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(30_000)});
   if(!response.ok||response.redirected)fail();const bytes=await response.text();if(Buffer.byteLength(bytes)>1024*1024)fail();
   compareLinuxRun(summary,JSON.parse(bytes),args[1]!,Number(args[3]));
   linuxObservation={runId:args[1],attempt:Number(args[3]),summaryHash:digest(summary),accepted:false,code:'RUN_MATCHED_ARTIFACT_PROVENANCE_AND_ACCEPTANCE_UNPROVEN'};
  }
  await writeReport({...assessment,linuxObservation},output,[dist],root);
 }catch{await writeReport({ready:false,status:'blocked',code:'READINESS_INPUTS_UNVERIFIED'},output,[dist],root);fail();}
 // A blocked report cannot be mistaken for successful issuance by shell callers.
 fail();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void runReadinessCli(process.argv.slice(2),process.env).catch(()=>{console.error('Automatic readiness remains blocked; inspect safe local readiness codes');process.exitCode=1;});
