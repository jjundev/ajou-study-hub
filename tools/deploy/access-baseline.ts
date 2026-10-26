import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verificationProject } from '../verification-project.js';
import { writeReport } from '../content/report.js';
import { settingsFingerprint, validateSettings, type DeploymentSettings } from './access.js';
import { digest, exactKeys, readAccessInspection, type AccessInspection } from './access-policy.js';
import { freshTime, hashValue, validateHumanEvidence, type HumanEvidence, type DeviceAcceptance } from './human-approval.js';
export type AutomationBaseline={version:1;contract:'initial-human-current-policy-v1';approvedAt:string;settingsFingerprint:string;protectionFingerprint:string;workerId:string;humanEvidenceHash:string};
function fail():never{throw Error('Automation approval is missing or does not match current protection');}
function validateInspection(settings:DeploymentSettings,inspection:AccessInspection):void {
 validateSettings(settings);exactKeys(inspection,['snapshot','workerId','protectionFingerprint','versionId']);
 if(typeof inspection.workerId!=='string'||!inspection.workerId||inspection.workerId===settings.workerName||!hashValue(inspection.protectionFingerprint)||typeof inspection.versionId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(inspection.versionId))fail();
 const snapshot=inspection.snapshot;exactKeys(snapshot,['accountId','workerName','accessAppId','allowedEmails','workerWide','hasBypass','hosts','freePlan','fingerprint','authDomain','otpProviderId']);
 if(snapshot.accountId!==settings.accountId||snapshot.workerName!==settings.workerName||snapshot.accessAppId!==settings.accessAppId||snapshot.workerWide!==true||snapshot.hasBypass!==false||snapshot.freePlan!==true||!hashValue(snapshot.fingerprint)||typeof snapshot.otpProviderId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(snapshot.otpProviderId)||typeof snapshot.authDomain!=='string'||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(snapshot.authDomain))fail();
 if(!Array.isArray(snapshot.allowedEmails)||snapshot.allowedEmails.length!==1||snapshot.allowedEmails[0]!==settings.allowedEmail||!Array.isArray(snapshot.hosts)||snapshot.hosts.some(h=>typeof h!=='string')||digest([...snapshot.hosts].sort())!==digest([settings.productionUrl,...settings.previewUrls].sort()))fail();
}
export function validateBaseline(value:unknown):asserts value is AutomationBaseline {
 exactKeys(value,['version','contract','approvedAt','settingsFingerprint','protectionFingerprint','workerId','humanEvidenceHash']);
 if(value.version!==1||value.contract!=='initial-human-current-policy-v1'||typeof value.approvedAt!=='string'||!Number.isFinite(Date.parse(value.approvedAt))||new Date(value.approvedAt).toISOString()!==value.approvedAt||typeof value.workerId!=='string'||!value.workerId||![value.settingsFingerprint,value.protectionFingerprint,value.humanEvidenceHash].every(hashValue))fail();
}
/** This is an explicit local operator action, never called by automation preflight. */
export function approveAutomation(settings:DeploymentSettings,inspection:AccessInspection,evidence:HumanEvidence,devices:DeviceAcceptance,now:number):AutomationBaseline {
 validateInspection(settings,inspection);validateHumanEvidence(evidence);
 exactKeys(devices,['mobileConfirmedAt','pcConfirmedAt']);
 if(!freshTime(evidence.checkedAt,now)||!freshTime(devices.mobileConfirmedAt,now)||!freshTime(devices.pcConfirmedAt,now)||evidence.settingsFingerprint!==settingsFingerprint(settings)||evidence.protectionFingerprint!==inspection.protectionFingerprint)fail();
 return {version:1,contract:'initial-human-current-policy-v1',approvedAt:new Date(now).toISOString(),settingsFingerprint:settingsFingerprint(settings),protectionFingerprint:inspection.protectionFingerprint,workerId:inspection.workerId,humanEvidenceHash:digest(evidence)};
}
/** No refresh, write, session, timestamp substitution, or self-approval on this path. */
export function assertAutomationAllowed(settings:DeploymentSettings,inspection:AccessInspection,baseline:AutomationBaseline):void {
 validateInspection(settings,inspection);validateBaseline(baseline);
 if(baseline.settingsFingerprint!==settingsFingerprint(settings)||baseline.protectionFingerprint!==inspection.protectionFingerprint||baseline.workerId!==inspection.workerId)fail();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void(async()=>{
 // The explicit flag is an operator assertion; device evidence is never generated here.
 if(process.argv.length!==3||process.argv[2]!=='--confirm-human-approval'||process.env.CI)fail();
 const root=await verificationProject(),dist=resolve(root,'dist'),output=resolve(root,'.reports/automation-baseline.json');
 await writeReport({approved:false,status:'running'},output,[dist],root);
 const settings:unknown=JSON.parse(await readFile(resolve(root,'.local/deployment.json'),'utf8'));validateSettings(settings);
 const evidence:unknown=JSON.parse(await readFile(resolve(root,'.reports/production-access-evidence.json'),'utf8'));validateHumanEvidence(evidence);
 const devices:unknown=JSON.parse(await readFile(resolve(root,'.reports/device-acceptance.json'),'utf8'));exactKeys(devices,['mobileConfirmedAt','pcConfirmedAt']);
 if(typeof devices.mobileConfirmedAt!=='string'||typeof devices.pcConfirmedAt!=='string')fail();
 const acceptance:DeviceAcceptance={mobileConfirmedAt:devices.mobileConfirmedAt,pcConfirmedAt:devices.pcConfirmedAt};
 const baseline=approveAutomation(settings,await readAccessInspection(settings),evidence,acceptance,Date.now());
 await writeReport({version:1,approvedAt:baseline.approvedAt,humanEvidenceHash:baseline.humanEvidenceHash,devices:acceptance,deviceAcceptanceHash:digest(acceptance)},resolve(root,'.reports/automation-approval.json'),[dist],root);
 await writeReport(baseline,output,[dist],root);console.log('Automation baseline approved locally; remote activation remains separate');
})().catch(()=>{console.error('Automation approval failed; no approval is claimed');process.exitCode=1;});
