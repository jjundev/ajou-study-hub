import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRecoveryOperator } from '../../tools/deploy/recovery-operator.js';
import { readAccessInspection, digest } from '../../tools/deploy/access-policy.js';
import { settingsFingerprint } from '../../tools/deploy/access.js';
const isolated=vi.hoisted(()=>({root:''}));
vi.mock('../../tools/verification-project.js',()=>({verificationProject:async()=>{if(!isolated.root)throw Error('Fixture required');return isolated.root;}}));
const account='a'.repeat(32),name='ajou-study-hub-recovery-test',id='owned-recovery-id',source='export default {fetch(){return new Response("recovery-test");}};';
const settings={accountId:account,workerName:'ajou-study-hub',allowedEmail:'owner@example.test',accessAppId:'11111111-1111-1111-1111-111111111111',productionUrl:'https://ajou-study-hub.example.workers.dev',previewUrls:[]};
const env={CLOUDFLARE_API_TOKEN:'synthetic-token'};
function server(change:Record<string,unknown>={}){
 let exists=!!change.collision,enabled=false,uploaded=false,productionReads=0;
 const writes:{path:string;method:string;body:unknown}[]=[],probes:RequestInit[]=[],calls:string[]=[];
 const production={id:'production-id',name:'ajou-study-hub',references:{domains:[]}};
 const worker=()=>({id,name,logpush:false,observability:{enabled:false},tail_consumers:[],references:{domains:[]},subdomain:{enabled,previews_enabled:false},...change.worker as object});
 const request:typeof fetch=async(input,init)=>{
  const u=new URL(String(input)),p=u.pathname.replace('/client/v4','');calls.push(p);
  if(u.hostname!=='api.cloudflare.com'){probes.push(init??{});return new Response(enabled?'recovery-test':String(change.disabledBody??'error code: 1003'),{status:enabled?200:404});}
  let result:unknown;const method=init?.method??'GET';
  if(method!=='GET'){
   const body=init?.body instanceof FormData?init.body:JSON.parse(String(init?.body));writes.push({path:p,method,body});
   if(change.unknownWrite===writes.length)throw Error('private response/credential');
   if(method==='POST'&&p===`/accounts/${account}/workers/workers`){exists=true;result={...worker(),id:change.createdId??id,name:change.createdName??name};}
   else if(method==='PUT'&&p===`/accounts/${account}/workers/scripts/${name}`){uploaded=true;result={id:name};}
   else if(method==='POST'&&p===`/accounts/${account}/workers/scripts/${name}/subdomain`){enabled=body.enabled;result={enabled,previews_enabled:false};}
   else throw Error('Forbidden write');
  }else if(p.endsWith('/workers/workers'))result=[production,...exists?[worker()]:[]];
  else if(p.endsWith('/workers/workers/production-id')){productionReads++;if(change.postUnavailable&&writes.length)throw Error('unavailable');result=production;}
  else if(p.endsWith('/workers/workers/'+id))result={...worker(),id:change.readbackId??id};
  else if(p.endsWith('/scripts/ajou-study-hub/subdomain'))result={enabled:true,previews_enabled:false};
  else if(p.endsWith('/scripts/'+name+'/subdomain'))result={enabled,previews_enabled:false};
  else if(p.endsWith('/workers/subdomain'))result={subdomain:'example'};
  else if(p==='/zones')result=[];
  else if(p.endsWith('/access/apps'))result=[{id:settings.accessAppId,type:'self_hosted',destinations:[{type:'worker',worker_id:'production-id'}],allowed_idps:['otp-id'],options_preflight_bypass:false}];
  else if(p.endsWith('/policies'))result=[{id:'policy-id',decision:'allow',include:[{email:{email:settings.allowedEmail}}],exclude:[],require:[]}];
  else if(p.endsWith('/identity_providers'))result=[{id:'otp-id',type:'onetimepin'}];
  else if(p.endsWith('/subscriptions'))result=[{state:'Paid',price:0,currency:'USD',trial:null,rate_plan:{id:'teams_free',public_name:'Teams Free Base',currency:'USD',scope:'account',externally_managed:false,is_contract:false}}];
  else if(p.endsWith('/access/organizations'))result={auth_domain:'team.cloudflareaccess.com'};
  else if(p.endsWith('/deployments'))result={deployments:[{id:'44444444-4444-4444-4444-444444444444',strategy:'percentage',versions:[{version_id:change.drift&&writes.length?'33333333-3333-3333-3333-333333333333':'22222222-2222-2222-2222-222222222222',percentage:100}]}]};
  else if(p.endsWith('/scripts/'+name+'/settings'))result={bindings:[],compatibility_date:'2026-10-24',logpush:!!change.configDrift&&writes.length>=5,observability:{enabled:false},tail_consumers:[],...change.scriptSettings as object};
  else if(p.endsWith('/scripts/'+name))return new Response(uploaded?String(change.source??source):'not uploaded',{headers:{'content-type':'application/javascript','content-disposition':'attachment; filename="index.js"'}});
  else throw Error('Unexpected read');
  return new Response(JSON.stringify({success:true,errors:[],result,...(Array.isArray(result)?{result_info:{page:1,total_pages:1,count:result.length,total_count:result.length,per_page:100,next_page:false}}:{})}));
 };
 return {request,writes,probes,calls,get productionReads(){return productionReads;},setExisting(){exists=true;uploaded=true;enabled=true;},disable(){enabled=false;}};
}
async function fixture(change:Record<string,unknown>={}){
 const s=server(change);isolated.root=await mkdtemp(join(tmpdir(),'recovery-operator-'));await mkdir(join(isolated.root,'.local'));await mkdir(join(isolated.root,'.reports'));
 const inspection=await readAccessInspection(settings,{fetch:s.request,token:'synthetic-token'});
 const baseline={version:1,contract:'initial-human-current-policy-v1',approvedAt:'2026-10-26T00:00:00.000Z',settingsFingerprint:settingsFingerprint(settings),protectionFingerprint:inspection.protectionFingerprint,workerId:inspection.workerId,humanEvidenceHash:'b'.repeat(64)};
 await writeFile(join(isolated.root,'.local/deployment.json'),JSON.stringify(settings));await writeFile(join(isolated.root,'.reports/automation-baseline.json'),JSON.stringify(baseline));
 return {...s,baseline,readReceipt:async()=>JSON.parse(await readFile(join(isolated.root,'.reports/recovery-target.json'),'utf8'))};
}
afterEach(async()=>{const root=isolated.root;isolated.root='';if(root)await rm(root,{recursive:true,force:true});});
function envelopes(request:typeof fetch,change:(value:Record<string,unknown>)=>void):typeof fetch{
 return async(input,init)=>{
  const response=await request(input,init),path=new URL(String(input)).pathname;
  if(!path.endsWith('/workers/workers')&&!path.endsWith('/workers/workers/'+id)&&!path.includes('/scripts/'+name+'/'))return response;
  const value=await response.json() as Record<string,unknown>;change(value);
  return new Response(JSON.stringify(value),{status:response.status,headers:response.headers});
 };
}
it('accepts observed null errors on beta lists and successful recovery create/update responses',async()=>{
 const s=await fixture();
 await runRecoveryOperator(['--create-empty-rehearsal'],env,envelopes(s.request,value=>{value.errors=null;}));
 expect(await s.readReceipt()).toMatchObject({phase:'verified',disabledConfirmed:true,restoredConfirmed:true});
});
it.each(['missing','undefined','string','number','object','nonempty','unsuccessful','http'] as const)('rejects malformed recovery envelope %s before writes',async kind=>{
 const s=await fixture();
 const malformed=envelopes(s.request,value=>{
  if(kind==='missing')delete value.errors;
  else if(kind==='undefined')value.errors=undefined;
  else if(kind==='unsuccessful'){value.errors=null;value.success=false;}
  else if(kind==='http')value.errors=null;
  else value.errors={string:'',number:0,object:{},nonempty:[{code:1000}]}[kind];
 });
 const request:typeof fetch=async(input,init)=>{
  const response=await malformed(input,init);
  return kind==='http'&&new URL(String(input)).pathname.endsWith('/workers/workers')?new Response(await response.text(),{status:500}):response;
 };
 await expect(runRecoveryOperator(['--create-empty-rehearsal'],env,request)).rejects.toThrow('Recovery operation remains unverified');
 expect(s.writes).toEqual([]);
});
it('exclusively creates exact empty module, preserves previews false and records only recovery-specific success',async()=>{
 const s=await fixture();await runRecoveryOperator(['--create-empty-rehearsal'],env,s.request);
 expect(s.writes.map(w=>[w.method,w.path])).toEqual([['POST',`/accounts/${account}/workers/workers`],['PUT',`/accounts/${account}/workers/scripts/${name}`],...Array.from({length:3},()=>['POST',`/accounts/${account}/workers/scripts/${name}/subdomain`])]);
 expect(s.writes[0].body).toEqual({name,logpush:false,observability:{enabled:false},subdomain:{enabled:false,previews_enabled:false},tail_consumers:[]});
 const form=s.writes[1].body as FormData;expect([...form.keys()]).toEqual(['metadata','index.js']);
 expect(JSON.parse(await (form.get('metadata') as Blob).text())).toEqual({main_module:'index.js',compatibility_date:'2026-10-24',bindings:[],logpush:false,observability:{enabled:false},tail_consumers:[]});
 const module=form.get('index.js') as File;expect(module.name).toBe('index.js');expect(module.type).toBe('application/javascript+module');expect(Buffer.from(await module.arrayBuffer())).toEqual(Buffer.from(source));
 expect(s.writes.slice(2).map(w=>w.body)).toEqual([{enabled:true,previews_enabled:false},{enabled:false,previews_enabled:false},{enabled:true,previews_enabled:false}]);
 const receipt=await s.readReceipt();expect(receipt).toMatchObject({version:1,baselineHash:digest(s.baseline),phase:'verified',productionUnchanged:true,disabledConfirmed:true,restoredConfirmed:true,target:{accountId:account,workerId:id,workerName:name,productionUrl:`https://${name}.example.workers.dev`}});expect(receipt.ready).toBeUndefined();
 for(const p of s.probes){expect(new Headers(p.headers).has('Authorization')).toBe(false);expect(p.credentials).toBe('omit');expect(p.redirect).toBe('error');}
 expect(s.calls.some(p=>p.endsWith('/scripts/ajou-study-hub'))).toBe(false);
});
it.each([{collision:true},{createdId:'production-id'},{createdName:'ajou-study-hub'},{readbackId:'other-id'}])('rejects collision or wrong immutable ownership %j',async change=>{
 const s=await fixture(change);await expect(runRecoveryOperator(['--create-empty-rehearsal'],env,s.request)).rejects.toThrow();expect(s.writes.some(w=>w.method==='PUT')).toBe(false);
 if(change.collision)expect(s.writes).toEqual([]);
});
it.each([{source:'\ufeff'+source},{scriptSettings:{assets:{}}},{scriptSettings:{bindings:[{type:'secret_text',name:'OTHER'}]}},{scriptSettings:{compatibility_flags:['nodejs_compat']}}])('refuses unsafe uploaded state before any endpoint enable %j',async change=>{
 const s=await fixture(change);await expect(runRecoveryOperator(['--create-empty-rehearsal'],env,s.request)).rejects.toThrow();expect(s.writes.map(w=>w.method)).toEqual(['POST','PUT']);expect((await s.readReceipt()).phase).toBe('unverified');
});
it('does not restore when external withdrawal is generic after API disable',async()=>{
 const s=await fixture({disabledBody:'Not found'});await expect(runRecoveryOperator(['--create-empty-rehearsal'],env,s.request)).rejects.toThrow();
 expect(s.writes.map(w=>w.method)).toEqual(['POST','PUT','POST','POST']);expect(s.writes[3].body).toEqual({enabled:false,previews_enabled:false});
 const receipt=await s.readReceipt();expect(receipt).toMatchObject({phase:'unverified',productionUnchanged:true,disabledConfirmed:false,restoredConfirmed:false});
});
it.each([1,2,3,4,5])('retains partial unverified state and never retries unknown write %s',async write=>{
 const s=await fixture({unknownWrite:write});await expect(runRecoveryOperator(['--create-empty-rehearsal'],env,s.request)).rejects.toThrow('Recovery operation remains unverified');
 expect(s.writes).toHaveLength(write);const receipt=await s.readReceipt();expect(receipt.phase).toBe('unverified');expect(receipt.productionUnchanged).toBe(true);expect(receipt.disabledConfirmed).toBe(false);expect(receipt.restoredConfirmed).toBe(false);
});
it('rejects settings drift after the final restore before issuing a recovery result',async()=>{
 const s=await fixture({configDrift:true});await expect(runRecoveryOperator(['--create-empty-rehearsal'],env,s.request)).rejects.toThrow();expect((await s.readReceipt()).phase).toBe('unverified');
});
it.each([{drift:true},{postUnavailable:true}])('never claims unchanged production when post-read fails or drifts %j',async change=>{
 const s=await fixture(change);await expect(runRecoveryOperator(['--create-empty-rehearsal'],env,s.request)).rejects.toThrow();expect((await s.readReceipt()).productionUnchanged).toBe(false);
});
it('existing mode reuses exact owned receipt without any create or source update',async()=>{
 const s=await fixture();await runRecoveryOperator(['--create-empty-rehearsal'],env,s.request);s.writes.length=0;
 await runRecoveryOperator(['--verify-existing-rehearsal'],env,s.request);
 expect(s.writes.map(w=>w.method)).toEqual(['POST','POST']);expect(s.writes.every(w=>w.path.endsWith('/'+name+'/subdomain'))).toBe(true);
});
it.each(['missing','extra','id','account','baseline','disabled'])('existing mode rejects %s before writes',async kind=>{
 const s=await fixture();if(kind!=='missing')await runRecoveryOperator(['--create-empty-rehearsal'],env,s.request);
 if(kind!=='missing'&&kind!=='disabled'){const r=await s.readReceipt();if(kind==='extra')r.approved=true;if(kind==='id')r.target.workerId='production-id';if(kind==='account')r.target.accountId='b'.repeat(32);if(kind==='baseline')r.baselineHash='c'.repeat(64);await writeFile(join(isolated.root,'.reports/recovery-target.json'),JSON.stringify(r));}
 if(kind==='disabled')s.disable();s.writes.length=0;
 await expect(runRecoveryOperator(['--verify-existing-rehearsal'],env,s.request)).rejects.toThrow();expect(s.writes).toEqual([]);
  if(kind==='disabled')expect((await s.readReceipt()).phase).toBe('unverified');
});
it('does not recreate after a locally recorded unknown creation outcome',async()=>{
 const s=await fixture({unknownWrite:1});await expect(runRecoveryOperator(['--create-empty-rehearsal'],env,s.request)).rejects.toThrow();s.writes.length=0;
 await expect(runRecoveryOperator(['--create-empty-rehearsal'],env,s.request)).rejects.toThrow();expect(s.writes).toEqual([]);
});
it.each(['flags','ci','settings','baseline'])('refuses invalid %s before writes',async kind=>{
 const s=await fixture();if(kind==='settings')await writeFile(join(isolated.root,'.local/deployment.json'),'{}');if(kind==='baseline')await writeFile(join(isolated.root,'.reports/automation-baseline.json'),'{}');
 await expect(runRecoveryOperator(kind==='flags'?['--create-empty-rehearsal','--account','other']:['--create-empty-rehearsal'],kind==='ci'?{...env,CI:'true'}:env,s.request)).rejects.toThrow();expect(s.writes).toEqual([]);
});
