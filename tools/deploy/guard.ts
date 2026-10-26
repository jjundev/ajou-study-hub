import { settingsFingerprint, validateSettings, type DeploymentSettings, type AccessSnapshot, type ProtectionEvidence } from './access.js';
export const sentinelPaths=['catalog.json','content/test/한글 공백.html','content/test/.pack/nested.html','content/test/.assets/x.png','content/test/sentinel.pdf','content/test/.assets/sentinel.woff2'];
export function assertReleaseAllowed({settings,snapshot,evidence}:{settings:DeploymentSettings;snapshot:AccessSnapshot;evidence:ProtectionEvidence}):void {
 validateSettings(settings);
 if(evidence.version!==2||evidence.method!=='independent-identity-policy-and-nondisclosure'||![evidence.ownerIdentityHash,evidence.otherIdentityHash,evidence.policyChecksHash].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||evidence.ownerIdentityHash===evidence.otherIdentityHash)throw Error('Independent identity/policy proof required');
 const same=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
 const hosts=[settings.productionUrl,...settings.previewUrls].sort();
 const age=Date.now()-Date.parse(evidence.checkedAt);
 if(typeof snapshot.otpProviderId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(snapshot.otpProviderId)||snapshot.freePlan!==true || snapshot.workerWide!==true || snapshot.hasBypass!==false || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(snapshot.authDomain) || !same(snapshot.allowedEmails,[settings.allowedEmail]) || !same(snapshot.hosts,hosts) || !same(evidence.hosts,hosts) || !/^[a-f0-9]{64}$/.test(snapshot.fingerprint) || evidence.policyFingerprint!==snapshot.fingerprint || evidence.settingsFingerprint!==settingsFingerprint(settings) || !Number.isFinite(age) || age<0 || age>86400000 || evidence.anonymousBlocked!==true || evidence.otherAccountBlocked!==true || evidence.ownerAllowed!==true) throw Error('Access protection is not verified');
 for(const key of ['accountId','workerName','accessAppId'] as const) if(snapshot[key]!==settings[key] || evidence[key]!==settings[key]) throw Error('Access target mismatch');
 for(const path of sentinelPaths) if(!/^[a-f0-9]{64}$/.test(evidence.sentinelHashes[path]??'')) throw Error('Incomplete sentinel proof');
}
