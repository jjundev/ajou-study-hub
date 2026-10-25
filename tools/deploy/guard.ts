import { settingsFingerprint, validateSettings, type DeploymentSettings, type AccessSnapshot, type ProtectionEvidence } from './access.js';
export const sentinelPaths=['catalog.json','content/test/한글 공백.html','content/test/.pack/nested.html','content/test/.assets/x.png','content/test/sentinel.pdf','content/test/.assets/sentinel.woff2'];
export function assertReleaseAllowed({settings,snapshot,evidence}:{settings:DeploymentSettings;snapshot:AccessSnapshot;evidence:ProtectionEvidence}):void {
 validateSettings(settings);
 const same=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
 const hosts=[settings.productionUrl,...settings.previewUrls].sort();
 const age=Date.now()-Date.parse(evidence.checkedAt);
 if(!snapshot.freePlan || !snapshot.workerWide || snapshot.hasBypass || !same(snapshot.allowedEmails,[settings.allowedEmail]) || !same(snapshot.hosts,hosts) || !same(evidence.hosts,hosts) || !snapshot.fingerprint || evidence.policyFingerprint!==snapshot.fingerprint || evidence.settingsFingerprint!==settingsFingerprint(settings) || !Number.isFinite(age) || age<0 || age>86400000 || !evidence.anonymousBlocked || !evidence.otherAccountBlocked || !evidence.ownerAllowed) throw Error('Access protection is not verified');
 for(const key of ['accountId','workerName','accessAppId'] as const) if(snapshot[key]!==settings[key] || evidence[key]!==settings[key]) throw Error('Access target mismatch');
 for(const path of sentinelPaths) if(!/^[a-f0-9]{64}$/.test(evidence.sentinelHashes[path]??'')) throw Error('Incomplete sentinel proof');
}
