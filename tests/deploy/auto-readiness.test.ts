import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const isolated=vi.hoisted(()=>({root:''}));
vi.mock('../../tools/verification-project.js',()=>({verificationProject:async()=>{if(!isolated.root)throw Error('No isolated fixture');return isolated.root;}}));
import { assertAutomationReady, assessReadiness, compareLinuxRun, runReadinessCli, type AutomationReadiness } from '../../tools/deploy/auto-readiness.js';
import { digest, sha256, type AccessInspection } from '../../tools/deploy/access-policy.js';
import { settingsFingerprint } from '../../tools/deploy/access.js';
import type { AutomationBaseline } from '../../tools/deploy/access-baseline.js';
import type { LedgerHead } from '../../tools/ci/ledger.js';
const now=Date.parse('2026-10-26T00:00:00.000Z'),time=new Date(now).toISOString();
const settings={accountId:'a'.repeat(32),workerName:'ajou-study-hub',allowedEmail:'owner@example.test',accessAppId:'11111111-1111-1111-1111-111111111111',productionUrl:'https://ajou-study-hub.example.workers.dev',previewUrls:[]};
function fixture(){
 const inspection:AccessInspection={workerId:'immutable-worker-id',versionId:'22222222-2222-2222-2222-222222222222',protectionFingerprint:'a'.repeat(64),snapshot:{accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,allowedEmails:[settings.allowedEmail],workerWide:true,hasBypass:false,hosts:[settings.productionUrl],freePlan:true,fingerprint:'b'.repeat(64),authDomain:'team.cloudflareaccess.com',otpProviderId:'otp-id'}};
 const evidence={version:1 as const,checkedAt:time,settingsFingerprint:settingsFingerprint(settings),protectionFingerprint:inspection.protectionFingerprint,ownerIdentityHash:'1'.repeat(64),otherIdentityHash:'2'.repeat(64),policyChecksHash:'3'.repeat(64),rows:[{path:'catalog.json',sha256:'4'.repeat(64),kind:'catalog' as const,ownerExact:true,anonymousBlocked:true,otherBlocked:true},{path:'content/course/lesson.html',sha256:'5'.repeat(64),kind:'html' as const,ownerExact:true,anonymousBlocked:true,otherBlocked:true}],absentKinds:['nested-html','image','pdf','font']};
 const baseline:AutomationBaseline={version:1,contract:'initial-human-current-policy-v1',approvedAt:time,settingsFingerprint:settingsFingerprint(settings),protectionFingerprint:inspection.protectionFingerprint,workerId:inspection.workerId,humanEvidenceHash:digest(evidence)};
 const ledger:LedgerHead={commitSha:'c'.repeat(40),value:{version:1,targetHash:baseline.settingsFingerprint,baselineHash:digest(baseline),pending:null,verified:{origin:'manual-initial',runId:'manual-initial',attempt:1,inputFingerprint:sha256('manual-initial:'+'d'.repeat(64)),versionId:inspection.versionId,bundleHash:'d'.repeat(64),verifiedAt:time}}};
 const ready:AutomationReadiness={version:1,checkedAt:time,baselineHash:digest(baseline),linuxRunId:'123',initialVersionId:inspection.versionId,ledgerCommitSha:ledger.commitSha,checks:{human:true,devices:true,linux:true,isolation:true,permissions:true,recovery:true,budget:true,sourceDiffAccepted:true}};
 return {inspection,baseline,ledger,ready,evidence,devices:{mobileConfirmedAt:time,pcConfirmedAt:time}};
}
it('readiness_missing_expired_or_partial_fails',()=>{
 const f=fixture(),check=(r:AutomationReadiness,t=now)=>assertAutomationReady(r,f.baseline,f.inspection,f.ledger,t);
 expect(()=>check(f.ready)).not.toThrow();
 for(const key of Object.keys(f.ready.checks))expect(()=>check({...f.ready,checks:{...f.ready.checks,[key]:false}})).toThrow();
 for(const r of [null,{}, {...f.ready,extra:true},{...f.ready,checks:{human:true}}])expect(()=>check(r as AutomationReadiness)).toThrow();
 expect(()=>check(f.ready,now+86400001)).toThrow();expect(()=>check(f.ready,now-1)).toThrow();
});
it('matches exact successful Actions attempt and trusted repository/source to safe report',()=>{
 const summary={appSha:'a'.repeat(40),counts:{sources:5},code:'VERIFY_ONLY_DETECTION_PASSED'};
 const run={id:123,run_attempt:2,status:'completed',conclusion:'success',head_sha:'a'.repeat(40),head_branch:'main',path:'.github/workflows/study-hub-update.yml',event:'workflow_dispatch',repository:{full_name:'jjundev/ajou-study-hub'},head_repository:{full_name:'jjundev/ajou-study-hub'}};
 expect(()=>compareLinuxRun(summary,run,'123',2)).not.toThrow();
 for(const changed of [{id:124},{run_attempt:1},{status:'in_progress'},{conclusion:'failure'},{head_sha:'b'.repeat(40)},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{event:'pull_request'},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'other/repo'}}])expect(()=>compareLinuxRun(summary,{...run,...changed},'123',2)).toThrow();
 expect(()=>compareLinuxRun({...summary,checks:{linux:true}},run,'123',2)).toThrow();
});
it('CLI rejects arbitrary approvals and CI invocation before file or network operations',async()=>{
 const request:typeof fetch=async()=>{throw Error('Network must not be invoked');};
 await expect(runReadinessCli(['--approved'],{},request)).rejects.toThrow();
 await expect(runReadinessCli([],{CI:'true'},request)).rejects.toThrow();
});
it('CLI invalidates a stale successful report before missing inputs fail without network',async()=>{
 isolated.root=await mkdtemp(join(tmpdir(),'readiness-test-'));
 try{
  await mkdir(join(isolated.root,'.reports'));
  await writeFile(join(isolated.root,'.reports/automation-readiness.json'),JSON.stringify({ready:true}));
  let requests=0;const request:typeof fetch=async()=>{requests++;throw Error('Should not fetch');};
  await expect(runReadinessCli([],{},request)).rejects.toThrow();
  expect(requests).toBe(0);
  expect(JSON.parse(await readFile(join(isolated.root,'.reports/automation-readiness.json'),'utf8'))).toEqual({ready:false,status:'blocked',code:'READINESS_INPUTS_UNVERIFIED'});
 }finally{const root=isolated.root;isolated.root='';await rm(root,{recursive:true,force:true});}
});
it.each(['baseline','target','head','version','worker','policy','pending','run','time'])('rejects mismatched %s binding',kind=>{
 const f=fixture();
 if(kind==='baseline')f.ready.baselineHash='e'.repeat(64);
 if(kind==='target')f.ledger.value.targetHash='e'.repeat(64);
 if(kind==='head')f.ready.ledgerCommitSha='e'.repeat(40);
 if(kind==='version')f.ready.initialVersionId='33333333-3333-3333-3333-333333333333';
 if(kind==='worker')f.inspection.workerId='different';
 if(kind==='policy')f.inspection.protectionFingerprint='e'.repeat(64);
 if(kind==='pending')f.ledger.value.pending={runId:'999',attempt:1,inputFingerprint:'e'.repeat(64),bundleHash:'d'.repeat(64),state:'outcome-unknown'};
 if(kind==='run')f.ready.linuxRunId='manual-initial';
 if(kind==='time')f.ready.checkedAt='not a time';
 expect(()=>assertAutomationReady(f.ready,f.baseline,f.inspection,f.ledger,now)).toThrow();
});
it('does not expire baseline or initial readiness after an automatic checkpoint advances',()=>{
 const f=fixture();f.ledger.commitSha='f'.repeat(40);f.ledger.value.verified={...f.ledger.value.verified,origin:'automatic',runId:'456',attempt:2,inputFingerprint:'e'.repeat(64),versionId:'33333333-3333-3333-3333-333333333333'};f.inspection.versionId=f.ledger.value.verified.versionId;
 expect(()=>assertAutomationReady(f.ready,f.baseline,f.inspection,f.ledger,now+10*86400000)).not.toThrow();
 f.inspection.versionId=f.ready.initialVersionId;expect(()=>assertAutomationReady(f.ready,f.baseline,f.inspection,f.ledger,now+10*86400000)).toThrow();
});
it('known evidence is compared but unsupported producers cannot issue readiness',()=>{
 const f=fixture();const result=assessReadiness(settings,f.baseline,f.inspection,f.ledger,f.evidence,f.devices,now);
 expect(result.ready).toBe(false);expect(result.checks).toEqual({human:true,devices:true,linux:false,isolation:false,permissions:false,recovery:false,budget:false,sourceDiffAccepted:false});
 expect(result.missing).toContain('ISOLATION_PRODUCER_MISSING');
 expect(()=>assessReadiness(settings,f.baseline,f.inspection,f.ledger,{...f.evidence,checkedAt:new Date(now-86400001).toISOString()},f.devices,now)).toThrow();
 expect(()=>assessReadiness(settings,f.baseline,f.inspection,f.ledger,f.evidence,{mobileConfirmedAt:time},now)).toThrow();
});
