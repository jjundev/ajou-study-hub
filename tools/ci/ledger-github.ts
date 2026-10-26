import { canonical, isRecord } from '../deploy/access-policy.js';
import { assertLedgerTransition, validateLedger, validateLedgerHead, type LedgerHead, type LedgerStore } from './ledger.js';
const base='https://api.github.com/repos/jjundev/ajou-study-hub-state';
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
function fail():never{throw Error('Private deployment ledger operation failed; read state and resolve before continuing');}
/** No retry: a timed-out write may have persisted and must block the caller. */
export function githubLedgerStore(token:string,request:typeof fetch=fetch):LedgerStore{
 if(!token||/[\r\n]/.test(token))fail();
 async function api(path:string,method='GET',body?:unknown):Promise<Record<string,unknown>>{
  try{
   const response=await request(base+path,{method,redirect:'error',signal:AbortSignal.timeout(30_000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(!response.ok)fail();const value:unknown=await response.json();if(!isRecord(value))fail();return value;
  }catch{fail();}
 }
 async function ref():Promise<string>{const r=await api('/git/ref/heads/main');if(r.ref!=='refs/heads/main'||!isRecord(r.object)||r.object.type!=='commit'||!sha(r.object.sha))fail();return r.object.sha;}
 async function readSnapshot():Promise<{head:LedgerHead;bytes:Buffer}>{
  const repo=await api('');if(repo.private!==true||repo.full_name!=='jjundev/ajou-study-hub-state'||repo.default_branch!=='main')fail();
  const commitSha=await ref(),commit=await api('/git/commits/'+commitSha);
  if(commit.sha!==commitSha||!isRecord(commit.tree)||!sha(commit.tree.sha))fail();
  const tree=await api('/git/trees/'+commit.tree.sha);
  if(tree.sha!==commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree)||tree.tree.length!==1)fail();
  const entry:unknown=tree.tree[0];if(!isRecord(entry)||entry.path!=='state.json'||entry.type!=='blob'||entry.mode!=='100644'||!sha(entry.sha))fail();
  const blob=await api('/git/blobs/'+entry.sha);
  if(blob.sha!==entry.sha||blob.encoding!=='base64'||!Number.isSafeInteger(blob.size)||(blob.size as number)<1||(blob.size as number)>16*1024||typeof blob.content!=='string'||blob.content.length>24*1024)fail();
  const encoded=blob.content.replace(/\n/g,'');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail();
  const bytes=Buffer.from(encoded,'base64');if(bytes.length!==blob.size||bytes.toString('base64')!==encoded)fail();
  let value:unknown,content:string;try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=JSON.parse(content);}catch{fail();}validateLedger(value);
  // Detect a ref change while following immutable commit/tree/blob objects.
  if(await ref()!==commitSha)fail();return {head:{commitSha,value},bytes};
 }
 async function read():Promise<LedgerHead>{return (await readSnapshot()).head;}
 return {read,async compareAndWrite(expected,next){
  validateLedgerHead(expected);assertLedgerTransition(expected,next);
  // Keep validation and eventual serialization bound across asynchronous calls.
  expected=structuredClone(expected);next=structuredClone(next);
  const before=await read();if(before.commitSha!==expected.commitSha||canonical(before.value)!==canonical(expected.value))fail();
  const content=canonical(next),blob=await api('/git/blobs','POST',{content,encoding:'utf-8'});if(!sha(blob.sha))fail();
  const tree=await api('/git/trees','POST',{tree:[{path:'state.json',mode:'100644',type:'blob',sha:blob.sha}]});if(!sha(tree.sha))fail();
  const commit=await api('/git/commits','POST',{message:'Record deployment ledger transition',tree:tree.sha,parents:[expected.commitSha]});
  if(!sha(commit.sha)||!isRecord(commit.tree)||commit.tree.sha!==tree.sha||!Array.isArray(commit.parents)||commit.parents.length!==1||!isRecord(commit.parents[0])||commit.parents[0].sha!==expected.commitSha)fail();
  await api('/git/refs/heads/main','PATCH',{sha:commit.sha,force:false});
  const confirmed=await readSnapshot();if(confirmed.head.commitSha!==commit.sha||!confirmed.bytes.equals(Buffer.from(content,'utf8')))fail();return confirmed.head;
 }};
}
