import { expect, it } from 'vitest';
import { approveAutomation, assertAutomationAllowed } from '../../tools/deploy/access-baseline.js';
import { settingsFingerprint } from '../../tools/deploy/access.js';
import type { AccessInspection } from '../../tools/deploy/access-policy.js';
import type { HumanEvidence } from '../../tools/deploy/human-approval.js';
const settings={accountId:'a'.repeat(32),workerName:'ajou-study-hub',allowedEmail:'owner@example.test',accessAppId:'11111111-1111-1111-1111-111111111111',productionUrl:'https://ajou-study-hub.example.workers.dev',previewUrls:[]};
const now=Date.parse('2026-10-26T00:00:00.000Z');
function fixture(){
 const inspection:AccessInspection={workerId:'immutable-worker-id',versionId:'22222222-2222-2222-2222-222222222222',protectionFingerprint:'a'.repeat(64),snapshot:{accountId:settings.accountId,workerName:settings.workerName,accessAppId:settings.accessAppId,allowedEmails:[settings.allowedEmail],workerWide:true,hasBypass:false,hosts:[settings.productionUrl],freePlan:true,fingerprint:'b'.repeat(64),authDomain:'team.cloudflareaccess.com',otpProviderId:'otp-id'}};
 const evidence:HumanEvidence={version:1,checkedAt:new Date(now-1000).toISOString(),settingsFingerprint:settingsFingerprint(settings),protectionFingerprint:inspection.protectionFingerprint,ownerIdentityHash:'1'.repeat(64),otherIdentityHash:'2'.repeat(64),policyChecksHash:'3'.repeat(64),rows:[{path:'catalog.json',sha256:'4'.repeat(64),kind:'catalog',ownerExact:true,anonymousBlocked:true,otherBlocked:true},{path:'content/course/lesson.html',sha256:'5'.repeat(64),kind:'html',ownerExact:true,anonymousBlocked:true,otherBlocked:true}],absentKinds:['nested-html','image','pdf','font']};
 return {inspection,evidence,devices:{mobileConfirmedAt:new Date(now-500).toISOString(),pcConfirmedAt:new Date(now-500).toISOString()}};
}
it('approves explicit fresh human and device proof and binds current policy, independent of deploy version',()=>{
 const f=fixture(),baseline=approveAutomation(settings,f.inspection,f.evidence,f.devices,now);
 expect(baseline).toMatchObject({version:1,contract:'initial-human-current-policy-v1',workerId:'immutable-worker-id',approvedAt:new Date(now).toISOString()});
 expect(baseline.humanEvidenceHash).toMatch(/^[a-f0-9]{64}$/);
 expect(()=>assertAutomationAllowed(settings,{...f.inspection,versionId:'33333333-3333-3333-3333-333333333333'},baseline)).not.toThrow();
 for(const key of ['workerId','protectionFingerprint'] as const)expect(()=>assertAutomationAllowed(settings,{...f.inspection,[key]:'changed'},baseline)).toThrow();
});
it.each(['missing-devices','expired','future','same-identity','invalid-hash','policy-drift','settings-drift','blocked-owner','allowed-other','allowed-anonymous','missing-kind','duplicate-kind','unknown-kind','stale-device','future-device','unknown-field'])('refuses approval with %s',kind=>{
 const f=fixture();let devices:unknown=f.devices;const evidence:any=f.evidence;
 if(kind==='missing-devices')devices={};
 if(kind==='expired')evidence.checkedAt=new Date(now-86400001).toISOString();
 if(kind==='future')evidence.checkedAt=new Date(now+1).toISOString();
 if(kind==='same-identity')evidence.otherIdentityHash=evidence.ownerIdentityHash;
 if(kind==='invalid-hash')evidence.policyChecksHash='invalid';
 if(kind==='policy-drift')evidence.protectionFingerprint='9'.repeat(64);
 if(kind==='settings-drift')evidence.settingsFingerprint='9'.repeat(64);
 if(kind==='blocked-owner')evidence.rows[0].ownerExact=false;
 if(kind==='allowed-other')evidence.rows[0].otherBlocked=false;
 if(kind==='allowed-anonymous')evidence.rows[0].anonymousBlocked=false;
 if(kind==='missing-kind')evidence.rows=[];
 if(kind==='duplicate-kind')evidence.rows.push(evidence.rows[0]);
 if(kind==='unknown-kind')evidence.absentKinds.push('unknown');
 if(kind==='stale-device')f.devices.pcConfirmedAt=new Date(now-86400001).toISOString();
 if(kind==='future-device')f.devices.mobileConfirmedAt=new Date(now+1).toISOString();
 if(kind==='unknown-field')evidence.approved=true;
 expect(()=>approveAutomation(settings,f.inspection,evidence,devices as any,now)).toThrow();
});
it('rejects malformed baseline and unsafe current state without inventing approval',()=>{
 const f=fixture(),baseline=approveAutomation(settings,f.inspection,f.evidence,f.devices,now);
 for(const value of [null,{}, {...baseline,version:2},{...baseline,humanEvidenceHash:''},{...baseline,extra:true}])expect(()=>assertAutomationAllowed(settings,f.inspection,value as any)).toThrow();
 for(const key of ['freePlan','workerWide'] as const)expect(()=>assertAutomationAllowed(settings,{...f.inspection,snapshot:{...f.inspection.snapshot,[key]:false}},baseline)).toThrow();
 expect(()=>assertAutomationAllowed(settings,{...f.inspection,snapshot:{...f.inspection.snapshot,hasBypass:true}},baseline)).toThrow();
});
