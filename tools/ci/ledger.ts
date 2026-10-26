export type VerifiedCheckpoint={origin:'manual-initial'|'automatic';runId:string;attempt:number;inputFingerprint:string;versionId:string;bundleHash:string;verifiedAt:string};
export type Attempt={runId:string;attempt:number;inputFingerprint:string;bundleHash:string;state:'upload-intent'|'outcome-unknown'|'quarantined';versionId?:string};
export type Ledger={version:1;targetHash:string;baselineHash:string;verified:VerifiedCheckpoint;pending:Attempt|null};
export type LedgerHead={commitSha:string;value:Ledger};
export type LedgerStore={read():Promise<LedgerHead>;compareAndWrite(expected:LedgerHead,next:Ledger):Promise<LedgerHead>};
import { canonical, exactKeys, sha256 } from '../deploy/access-policy.js';
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const run=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v);
function fail():never{throw Error('Deployment ledger is invalid or requires operator recovery');}
function identity(v:Record<string,unknown>):void{if(!run(v.runId)||!Number.isSafeInteger(v.attempt)||(v.attempt as number)<1||!hash(v.inputFingerprint)||!hash(v.bundleHash))fail();}
function checkpoint(v:unknown):asserts v is VerifiedCheckpoint{
 exactKeys(v,['origin','runId','attempt','inputFingerprint','versionId','bundleHash','verifiedAt']);
 if(!['manual-initial','automatic'].includes(v.origin as string)||!uuid(v.versionId)||typeof v.verifiedAt!=='string'||!Number.isFinite(Date.parse(v.verifiedAt))||new Date(v.verifiedAt).toISOString()!==v.verifiedAt)fail();
 if(v.origin==='manual-initial'){
  if(v.runId!=='manual-initial'||v.attempt!==1||!hash(v.bundleHash)||v.inputFingerprint!==sha256('manual-initial:'+v.bundleHash))fail();
 }else identity(v);
}
function pending(v:unknown):asserts v is Attempt{
 exactKeys(v,['runId','attempt','inputFingerprint','bundleHash','state','versionId'],['runId','attempt','inputFingerprint','bundleHash','state']);identity(v);
 if(!['upload-intent','outcome-unknown','quarantined'].includes(v.state as string)||(Object.hasOwn(v,'versionId')&&!uuid(v.versionId)))fail();
}
export function validateLedger(value:unknown):asserts value is Ledger{
 exactKeys(value,['version','targetHash','baselineHash','verified','pending']);
 if(value.version!==1||!hash(value.targetHash)||!hash(value.baselineHash)||Buffer.byteLength(canonical(value))>16*1024)fail();
 checkpoint(value.verified);if(value.pending!==null)pending(value.pending);
}
export function validateLedgerHead(value:unknown):asserts value is LedgerHead{
 exactKeys(value,['commitSha','value']);if(typeof value.commitSha!=='string'||!/^[a-f0-9]{40}$/.test(value.commitSha))fail();validateLedger(value.value);
}
export function assertLedgerBinding(head:LedgerHead,expectedTargetHash:string,expectedBaselineHash:string):void{
 validateLedgerHead(head);if(!hash(expectedTargetHash)||!hash(expectedBaselineHash)||head.value.targetHash!==expectedTargetHash||head.value.baselineHash!==expectedBaselineHash)fail();
}
export function classifyLedger(head:LedgerHead,currentVersionId:string,inputFingerprint:string):'build'|'skip'|'blocked'{
 validateLedgerHead(head);if(!uuid(currentVersionId)||!hash(inputFingerprint))fail();
 if(head.value.pending||head.value.verified.versionId!==currentVersionId)return 'blocked';
 return head.value.verified.origin==='automatic'&&head.value.verified.inputFingerprint===inputFingerprint?'skip':'build';
}
export function beginAttempt(head:LedgerHead,attempt:Attempt):Ledger{
 validateLedgerHead(head);pending(attempt);if(head.value.pending||attempt.state!=='upload-intent'||attempt.versionId!==undefined)fail();
 const next=structuredClone({...head.value,pending:attempt});validateLedger(next);return next;
}
const sameIdentity=(a:Attempt,b:Attempt|VerifiedCheckpoint)=>a.runId===b.runId&&a.attempt===b.attempt&&a.inputFingerprint===b.inputFingerprint&&a.bundleHash===b.bundleHash;
export function finishAttempt(head:LedgerHead,verified:VerifiedCheckpoint):Ledger{
 validateLedgerHead(head);checkpoint(verified);const intent=head.value.pending;
 if(!intent||intent.state!=='upload-intent'||verified.origin!=='automatic'||!sameIdentity(intent,verified)||(intent.versionId!==undefined&&intent.versionId!==verified.versionId))fail();
 return structuredClone({...head.value,verified,pending:null});
}
/** Store writes accept only identity-bound state transitions, never arbitrary replacement. */
export function assertLedgerTransition(head:LedgerHead,next:Ledger):void{
 validateLedgerHead(head);validateLedger(next);assertLedgerBinding(head,next.targetHash,next.baselineHash);
 const previous=head.value;
 if(!previous.pending){if(!next.pending||canonical(beginAttempt(head,next.pending))!==canonical(next))fail();return;}
 if(next.pending===null){if(canonical(finishAttempt(head,next.verified))!==canonical(next))fail();return;}
 const a=previous.pending,b=next.pending;
 if(canonical(previous.verified)!==canonical(next.verified)||!sameIdentity(a,b)||a.state==='quarantined'||!(['outcome-unknown','quarantined'].includes(b.state))||a.state===b.state||(a.versionId!==undefined&&a.versionId!==b.versionId))fail();
}
