import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runAppPermissionsOperator } from '../../tools/ci/app-permissions.js';

const isolated=vi.hoisted(()=>({root:''}));
vi.mock('../../tools/verification-project.js',()=>({verificationProject:async()=>{if(!isolated.root)throw Error('Fixture required');return isolated.root;}}));
const pairs=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=pairs.privateKey.export({format:'pem',type:'pkcs8'}).toString();
const roles=[
 {role:'reader',appId:5478307,installationId:175423301,repositories:['jjundev/ajou-nonhoesil','jjundev/ajou-life-science','jjundev/ajou-electronic-circuits-2','jjundev/ajou-jagual','jjundev/ajou-ml-basics'],permissions:{contents:'read',metadata:'read'}},
 {role:'dispatch',appId:5478852,installationId:175430013,repositories:['jjundev/ajou-study-hub'],permissions:{actions:'write',metadata:'read'}},
 {role:'ledger',appId:5478953,installationId:175431663,repositories:['jjundev/ajou-study-hub-state'],permissions:{contents:'write',metadata:'read'}},
];
type Change={exchange?:Record<string,unknown>;exchangeStatus?:number;exchangeRedirect?:boolean;unknownExchange?:boolean;inventory?:Record<string,unknown>;link?:string;revokeStatus?:number;probeStatus?:number;app?:Record<string,unknown>;installation?:Record<string,unknown>;response?:Response;throwSecret?:boolean;twoPages?:boolean};
async function fixture(change:Change={}){
 isolated.root=await mkdtemp(join(tmpdir(),'app-permissions-'));await mkdir(join(isolated.root,'.local'));
 for(const r of roles)await writeFile(join(isolated.root,`.local/github-${r.role}-app.json`),JSON.stringify({version:1,observedAt:'2026-10-27T00:00:00.000Z',account:'jjundev',...r,slug:`ajou-study-hub-${r.role}-jjundev`,repositorySelection:'selected',keyStore:`.local/github-${r.role}-key.dpapi`,activeKeyRecordId:1,activeKeyFingerprint:'synthetic-public-fingerprint',activeKeyCountObserved:1,secretsRegisteredOn:r.role==='reader'?'jjundev/ajou-study-hub':[],apiTokenPermissionsTested:false}));
 const env:NodeJS.ProcessEnv={STUDY_HUB_READER_PRIVATE_KEY:pem,STUDY_HUB_DISPATCH_PRIVATE_KEY:pem,STUDY_HUB_LEDGER_PRIVATE_KEY:pem};
 const calls:{url:URL;method:string;auth:string;body:unknown;init:RequestInit}[]=[],revoked=new Set<string>();
 let current=roles[0];
 const repos=(r:typeof current)=>r.repositories.map((name,i)=>({id:i+1,name:name.split('/')[1],full_name:name,private:true,owner:{login:'jjundev'}}));
 const request:typeof fetch=async(input,init={})=>{
  expect(Object.keys(env)).toEqual([]);
  const url=new URL(String(input)),method=init.method??'GET',auth=new Headers(init.headers).get('authorization')??'';
  calls.push({url,method,auth,body:init.body?JSON.parse(String(init.body)):undefined,init});
  const json=(v:unknown,status=200,headers?:HeadersInit)=>new Response(JSON.stringify(v),{status,headers});
  if(url.pathname==='/app'){
   const jwt=auth.slice(7),parts=jwt.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());
   current=roles.find(r=>String(r.appId)===claims.iss)!;
   expect(verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),pairs.publicKey,Buffer.from(parts[2],'base64url'))).toBe(true);
   expect(JSON.parse(Buffer.from(parts[0],'base64url').toString()).alg).toBe('RS256');
   expect(claims.exp-claims.iat).toBeLessThanOrEqual(600);expect(claims.exp*1000).toBeGreaterThan(Date.now());
   if(change.throwSecret)throw Error(pem+' raw-token synthetic-secret');
   return json({id:current.appId,slug:`ajou-study-hub-${current.role}-jjundev`,owner:{login:'jjundev'},permissions:current.permissions,...(current.role==='reader'?change.app:{})});
  }
  if(url.pathname===`/app/installations/${current.installationId}`)return json({id:current.installationId,app_id:current.appId,account:{login:'jjundev'},repository_selection:'selected',permissions:current.permissions,suspended_at:null,...(current.role==='reader'?change.installation:{})});
  if(method==='POST'){
   if(current.role==='reader'&&change.unknownExchange)throw Error('synthetic-secret');
   if(current.role==='reader'&&change.response)return change.response;
   return json({token:`synthetic-${current.role}-token`,expires_at:new Date(Date.now()+3_500_000).toISOString(),permissions:current.permissions,repository_selection:'selected',repositories:repos(current),...(current.role==='reader'?change.exchange:{})},current.role==='reader'?change.exchangeStatus??201:201,current.role==='reader'&&change.exchangeRedirect?{location:'https://evil.invalid/token'}:undefined);
  }
  if(method==='DELETE'){
   revoked.add(auth);return new Response(null,{status:current.role==='reader'?change.revokeStatus??204:204});
  }
  if(url.pathname==='/installation/repositories'){
   if(revoked.has(auth))return new Response(null,{status:current.role==='reader'?change.probeStatus??401:401});
   const page=Number(url.searchParams.get('page'));
   const list=change.twoPages&&current.role==='reader'?(page===1?repos(current).slice(0,2):repos(current).slice(2)):repos(current);
   const link=change.twoPages&&current.role==='reader'&&page===1?'<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"':current.role==='reader'?change.link:undefined;
   return json({total_count:current.repositories.length,repositories:list,...(current.role==='reader'?change.inventory:{})},200,link?{link}:undefined);
  }
  throw Error('Unexpected synthetic endpoint');
 };
 return {env,calls,request,readReport:async()=>JSON.parse(await readFile(join(isolated.root,'.reports/github-app-permissions.json'),'utf8'))};
}
afterEach(async()=>{vi.restoreAllMocks();const root=isolated.root;isolated.root='';if(root)await rm(root,{recursive:true,force:true});});

it('proves all exact roles with real signed JWTs and revocation but preserves the Actions settings gap',async()=>{
 const s=await fixture();const report=await runAppPermissionsOperator([],s.env,s.request);
 expect(report.rolesVerified).toBe(true);expect(report.verified).toBe(false);expect(report.stateActionsDisabled).toBe(false);
 expect(report.roles).toHaveLength(3);
 expect(report.roles.map((r:any)=>[r.role,r.verified,r.revokeStatus,r.revokedProbeStatus])).toEqual([['reader',true,204,401],['dispatch',true,204,401],['ledger',true,204,401]]);
 expect(await s.readReport()).toEqual(report);
 const exchanges=s.calls.filter(c=>c.method==='POST');
 expect(exchanges.map(c=>c.body)).toEqual([
  {repositories:['ajou-nonhoesil','ajou-life-science','ajou-electronic-circuits-2','ajou-jagual','ajou-ml-basics'],permissions:{contents:'read',metadata:'read'}},
  {repositories:['ajou-study-hub'],permissions:{actions:'write',metadata:'read'}},
  {repositories:['ajou-study-hub-state'],permissions:{contents:'write',metadata:'read'}},
 ]);
 for(const c of s.calls){expect(c.url.origin).toBe('https://api.github.com');expect(c.init.redirect).toBe('manual');expect(c.init.credentials).toBe('omit');expect(c.init.signal).toBeInstanceOf(AbortSignal);}
 expect(s.calls.filter(c=>c.method==='DELETE')).toHaveLength(3);expect(s.calls).toHaveLength(18);
 expect(report.limitations.join(' ')).toContain('Administration:read');expect(Object.hasOwn(report,'readiness')).toBe(false);
 expect(JSON.stringify(report)).not.toContain('synthetic-reader-token');expect(JSON.stringify(report)).not.toContain('PRIVATE KEY');
});
it('completes validated fixed-origin pagination without dropping later repositories',async()=>{
 const s=await fixture({twoPages:true});const r=await runAppPermissionsOperator([],s.env,s.request);expect(r.rolesVerified).toBe(true);expect(s.calls.filter(c=>c.url.searchParams.get('page')==='2')).toHaveLength(1);
});
it.each([
 {exchange:{permissions:{contents:'read',metadata:'read',issues:'write'}}},
 {exchange:{permissions:{contents:'read'}}},
 {exchange:{permissions:null}},
 {exchange:{permissions:{contents:'write',metadata:'read'}}},
 {exchange:{expires_at:'2020-01-01T00:00:00.000Z'}},
 {exchange:{expires_at:'2099-01-01T00:00:00.000Z'}},
 {exchange:{expires_at:'tomorrow'}},
 {exchange:{repository_selection:'all'}},
 {exchange:{repositories:[]}},
 {exchangeStatus:403},
 {exchangeRedirect:true},
 {exchangeStatus:302,exchangeRedirect:true},
 {inventory:{repositories:[{name:'unexpected',full_name:'jjundev/unexpected',private:true,owner:{login:'jjundev'}}]}},
 {inventory:{total_count:6}},
 {inventory:{total_count:4}},
 {inventory:{repositories:[]}},
 {link:'<https://evil.invalid/installation/repositories?page=2>; rel="next"'},
 {link:'<https://api.github.com/installation/repositories?per_page=100&page=1>; rel="next"'},
 {link:'<https://api.github.com/other?per_page=100&page=2>; rel="next"'},
 {link:'<https://attacker@api.github.com/installation/repositories?per_page=100&page=2>; rel="next"'},
 {link:'<https://api.github.com/installation/repositories?per_page=100&page=6>; rel="next"'},
 {link:'broken'},
 {revokeStatus:401},
 {probeStatus:200},
 {probeStatus:403},
])('rejects malformed scope, expiry, incomplete pagination and failed revocation %j',async change=>{
 const s=await fixture(change);const r=await runAppPermissionsOperator([],s.env,s.request);
 expect(r.rolesVerified).toBe(false);expect(r.verified).toBe(false);expect(r.roles[0].verified).toBe(false);
 expect(s.calls.filter(c=>c.method==='POST'&&c.url.pathname.includes('175423301'))).toHaveLength(1);
 expect(s.calls.filter(c=>c.method==='DELETE'&&c.auth==='Bearer synthetic-reader-token')).toHaveLength(1);
 expect(s.calls.filter(c=>c.url.pathname==='/installation/repositories'&&c.auth==='Bearer synthetic-reader-token').at(-1)?.method).toBe('GET');
 expect(s.calls.every(c=>c.url.origin==='https://api.github.com')).toBe(true);
});
it.each([{unknownExchange:true},{exchange:{token:''}},{exchange:{token:null}}])('leaves unknown/unusable exchange unverified without retries %j',async change=>{
 const s=await fixture(change);const r=await runAppPermissionsOperator([],s.env,s.request);expect(r.rolesVerified).toBe(false);expect(r.roles[0].exchangeOutcome).toBe('unknown');
 expect(s.calls.filter(c=>c.method==='POST'&&c.url.pathname.includes('175423301'))).toHaveLength(1);expect(s.calls.filter(c=>c.method==='DELETE')).toHaveLength(2);
});
it.each([{app:{id:42}},{app:{owner:{login:'other'}}},{installation:{app_id:42}},{installation:{account:{login:'other'}}},{installation:{repository_selection:'all'}}])('rejects mismatched live identity before issuing a token %j',async change=>{
 const s=await fixture(change);const r=await runAppPermissionsOperator([],s.env,s.request);expect(r.roles[0].verified).toBe(false);expect(s.calls.filter(c=>c.method==='POST'&&c.url.pathname.includes('175423301'))).toHaveLength(0);
});
it('rejects public repositories even with the exact name',async()=>{
 const s=await fixture({inventory:{repositories:roles[0].repositories.map((name,i)=>({id:i+1,name:name.split('/')[1],full_name:name,private:false,owner:{login:'jjundev'}}))}});
 expect((await runAppPermissionsOperator([],s.env,s.request)).rolesVerified).toBe(false);
});
it.each([{args:['--base-url=https://evil.invalid']},{env:{CI:'true'}},{env:{CI:'false'}},{env:{STUDY_HUB_LEDGER_PRIVATE_KEY:''}}])('rejects local preflight inputs and erases all key env values first %j',async change=>{
 const s=await fixture();Object.assign(s.env,change.env);await expect(runAppPermissionsOperator(change.args??[],s.env,s.request)).rejects.toThrow('GitHub App permission proof remains unverified');
 expect(s.calls).toEqual([]);for(const name of ['READER','DISPATCH','LEDGER'])expect(s.env[`STUDY_HUB_${name}_PRIVATE_KEY`]).toBeUndefined();
});
it('validates all fixed public receipts before issuing any token',async()=>{
 const s=await fixture();await writeFile(join(isolated.root,'.local/github-ledger-app.json'),JSON.stringify({version:1,appId:42}));
 expect((await runAppPermissionsOperator([],s.env,s.request)).rolesVerified).toBe(false);expect(s.calls).toEqual([]);
});
it.each(['appId','installationId','account','slug','repositorySelection','repositories','permissions','keyStore'])('refuses a drifted public receipt projection: %s',async field=>{
 const s=await fixture(),path=join(isolated.root,'.local/github-reader-app.json'),value=JSON.parse(await readFile(path,'utf8'));value[field]='wrong';await writeFile(path,JSON.stringify(value));
 expect((await runAppPermissionsOperator([],s.env,s.request)).rolesVerified).toBe(false);expect(s.calls).toEqual([]);
});
it('accepts the current opaque longer stateless token format and revokes that exact credential',async()=>{
 const token='ghs_5478307_'+['a'.repeat(1000),'b'.repeat(1000),'c'.repeat(1000)].join('.'),s=await fixture({exchange:{token}});
 const r=await runAppPermissionsOperator([],s.env,s.request);expect(r.rolesVerified).toBe(true);expect(s.calls.filter(c=>c.method==='DELETE')[0].auth).toBe('Bearer '+token);expect(JSON.stringify(r)).not.toContain(token);
});
it.each([
 {body:'bad-json',headers:{}},
 {body:'x'.repeat(1048577),headers:{}},
 {body:JSON.stringify({token:'synthetic-reader-token'}),headers:{'content-length':'1048577'}},
])('bounds malformed and oversized exchange bodies without retries',async({body,headers})=>{
 const s=await fixture({response:new Response(body,{status:201,headers:headers as HeadersInit})});const r=await runAppPermissionsOperator([],s.env,s.request);
 expect(r.rolesVerified).toBe(false);expect(s.calls.filter(c=>c.method==='POST'&&c.url.pathname.includes('175423301'))).toHaveLength(1);
 if(body.startsWith('{'))expect(s.calls.filter(c=>c.method==='DELETE'&&c.auth==='Bearer synthetic-reader-token')).toHaveLength(1);
});
it('times out an unknown exchange and does not retry issuance',async()=>{
 const s=await fixture();let started!:()=>void;const issued=new Promise<void>(resolve=>{started=resolve;});
 const request:typeof fetch=async(input,init)=>{if(String(input).includes('/175423301/access_tokens')){started();return new Promise<Response>(()=>{});}return s.request(input,init);};
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 try{
  const pending=runAppPermissionsOperator([],s.env,request);await issued;await vi.advanceTimersByTimeAsync(10001);const r=await pending;
  expect(r.rolesVerified).toBe(false);expect(r.roles[0].exchangeOutcome).toBe('unknown');expect(r.roles[0].revokeStatus).toBeNull();expect(r.roles[1].verified).toBe(true);
 }finally{vi.useRealTimers();}
});
it('never logs or persists raw errors, private keys, JWTs or issued token values',async()=>{
 const log=vi.spyOn(console,'log'),error=vi.spyOn(console,'error'),out=vi.spyOn(process.stdout,'write'),err=vi.spyOn(process.stderr,'write');
 const s=await fixture({throwSecret:true});const r=await runAppPermissionsOperator([],s.env,s.request);
 expect(log).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();expect(out).not.toHaveBeenCalled();expect(err).not.toHaveBeenCalled();
 const saved=JSON.stringify(await s.readReport());for(const secret of [pem,'synthetic-secret','raw-token',...s.calls.map(c=>c.auth.slice(7))])expect(saved).not.toContain(secret);
 expect(r.rolesVerified).toBe(false);
});
