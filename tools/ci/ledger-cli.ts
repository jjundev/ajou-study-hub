import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { settingsFingerprint, validateSettings } from '../deploy/access.js';
import { validateBaseline } from '../deploy/access-baseline.js';
import { digest } from '../deploy/access-policy.js';
import { assertLedgerBinding, classifyLedger } from './ledger.js';
import { githubLedgerStore } from './ledger-github.js';

/** Read-only CI entry point. Initial approval and ledger initialization are operator tasks. */
export async function runLedgerCli(args:string[],env:NodeJS.ProcessEnv,request:typeof fetch=fetch):Promise<string>{
 const [command,...rest]=args;
 if(!((command==='read'&&rest.length===0)||(command==='classify'&&rest.length===2)))throw Error('Invalid ledger command');
 const settings:unknown=JSON.parse(env.STUDY_HUB_DEPLOYMENT_JSON??'null');validateSettings(settings);
 const baseline:unknown=JSON.parse(env.STUDY_HUB_BASELINE_JSON??'null');validateBaseline(baseline);
 const targetHash=settingsFingerprint(settings);
 if(baseline.settingsFingerprint!==targetHash)throw Error('Ledger approval does not match target');
 const head=await githubLedgerStore(env.GH_TOKEN??'',request).read();
 assertLedgerBinding(head,targetHash,digest(baseline));
 return command==='read'?JSON.stringify(head):classifyLedger(head,rest[0]!,rest[1]!);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 void runLedgerCli(process.argv.slice(2),process.env).then(result=>{process.stdout.write(result+'\n');}).catch(()=>{process.stderr.write('Private deployment ledger check failed; no deployment is authorized.\n');process.exitCode=1;});
}
