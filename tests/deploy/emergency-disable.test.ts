import { expect, it } from 'vitest';
import { disableEndpoint, rehearseRecovery } from '../../tools/deploy/emergency-disable.js';
const accountId='a'.repeat(32),workerId='immutable-worker-id';
const settings={accountId,workerName:'ajou-study-hub',allowedEmail:'owner@example.test',accessAppId:'11111111-1111-1111-1111-111111111111',productionUrl:'https://ajou-study-hub.example.workers.dev',previewUrls:[]};
function server(change:Record<string,unknown>={},name='ajou-study-hub'){
 let enabled=true;
 const writes:{path:string;body:unknown}[]=[],probes:RequestInit[]=[],calls:string[]=[];
 const request:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));calls.push(url.pathname);
  if(url.hostname!=='api.cloudflare.com'){
   probes.push(init??{});
   return new Response(enabled?'recovery-test':String(change.disabledBody??'error code: 1003'),{status:enabled?200:Number(change.disabledStatus??404),...(change.probeRedirect&&!enabled?{headers:{Location:'https://evil.example'}}:{})});
  }
  if(change.throw)throw Error('private-token-or-body');
  let result:unknown;
  if(init?.method==='POST'){
   writes.push({path:url.pathname.replace('/client/v4',''),body:JSON.parse(String(init.body))});
   if(!change.stuck)enabled=(JSON.parse(String(init.body)) as {enabled:boolean}).enabled;
   result={enabled,previews_enabled:false};
  }else if(url.pathname.endsWith('/workers/workers'))result=[{id:workerId,name}];
  else if(url.pathname.endsWith('/workers/workers/'+workerId))result={id:change.workerId??workerId,name,references:{domains:change.domains??[]}};
  else if(url.pathname.endsWith('/scripts/'+name+'/subdomain'))result={enabled,previews_enabled:change.previews??false};
  else if(url.pathname.endsWith('/workers/subdomain'))result={subdomain:change.accountSubdomain??'example'};
  else if(url.pathname==='/client/v4/zones')result=[];
  else if(url.pathname.endsWith('/scripts/'+name+'/settings'))result={bindings:[],...change.settings as object};
  else if(url.pathname.endsWith('/scripts/'+name))return new Response(String(change.source??'export default {fetch(){return new Response("recovery-test");}};'),{headers:{'content-type':String(change.sourceType??'application/javascript'),'content-disposition':String(change.sourceName??'attachment; filename="index.js"')}});
  else throw Error('Unexpected test route');
  return new Response(JSON.stringify({success:true,errors:Object.hasOwn(change,'errors')?change.errors:[],result,result_info:{page:1,total_pages:1,count:Array.isArray(result)?result.length:undefined}}));
 };
 return {request,writes,probes,calls};
}
it('accepts null errors throughout dedicated empty recovery rehearsal',async()=>{
 const s=server({errors:null},'ajou-study-hub-recovery-test');
 await expect(rehearseRecovery({accountId,workerId,workerName:'ajou-study-hub-recovery-test',productionUrl:'https://ajou-study-hub-recovery-test.example.workers.dev'},s.request,'test-token')).resolves.toEqual({disabledConfirmed:true,restoredConfirmed:true});
 expect(s.writes.map(w=>w.body)).toEqual([{enabled:false,previews_enabled:false},{enabled:true,previews_enabled:false}]);
});
it.each([undefined,'',0,{},[{code:1000}]])('rejects missing or malformed errors before disabling %j',async errors=>{
 const s=server({errors});await expect(disableEndpoint(settings,workerId,s.request,'test-token')).rejects.toThrow();expect(s.writes).toEqual([]);
});
it('recovery_targets_only_one_worker and sends no API credentials to public probes',async()=>{
 const s=server();await disableEndpoint(settings,workerId,s.request,'test-token');
 expect(s.writes).toEqual([{path:'/accounts/'+accountId+'/workers/scripts/ajou-study-hub/subdomain',body:{enabled:false,previews_enabled:false}}]);
 expect(s.probes.length).toBeGreaterThan(0);
 for(const p of s.probes){expect(new Headers(p.headers).has('Authorization')).toBe(false);expect(p.redirect).toBe('error');expect(p.credentials).toBe('omit');expect(p.signal).toBeDefined();}
 expect(s.calls.some(p=>p.includes('/access/'))).toBe(false);
 expect(s.calls.some(p=>p.endsWith('/scripts/ajou-study-hub'))).toBe(false);
});
it.each([{workerId:'other'},{domains:[{hostname:'custom.example'}]},{previews:true},{accountSubdomain:'other'}])('rejects target ambiguity before writing %j',async change=>{
 const s=server(change);await expect(disableEndpoint(settings,workerId,s.request,'test-token')).rejects.toThrow();expect(s.writes).toEqual([]);
});
it('rejects invalid production target without requests',async()=>{
 const s=server();await expect(disableEndpoint({...settings,workerName:'ajou-study-hub-recovery-test'},workerId,s.request,'test-token')).rejects.toThrow();expect(s.calls).toEqual([]);
});
it('recovery_requires_observed_disabled',async()=>{
 const s=server({stuck:true});await expect(disableEndpoint(settings,workerId,s.request,'test-token')).rejects.toThrow();expect(s.writes).toHaveLength(1);
});
it('rejects external redirects and does not retry or expose request errors',async()=>{
 const s=server({probeRedirect:true});await expect(disableEndpoint(settings,workerId,s.request,'test-token')).rejects.toThrow();
 const failed=server({throw:true});await expect(disableEndpoint(settings,workerId,failed.request,'test-token')).rejects.toThrow('Endpoint recovery could not be verified');expect(failed.calls).toHaveLength(1);
});
it('rehearses only the literal empty target and restores only after observed disable',async()=>{
 const s=server({},'ajou-study-hub-recovery-test');
 await expect(rehearseRecovery({accountId,workerId,workerName:'ajou-study-hub-recovery-test',productionUrl:'https://ajou-study-hub-recovery-test.example.workers.dev'},s.request,'test-token')).resolves.toEqual({disabledConfirmed:true,restoredConfirmed:true});
 expect(s.writes.map(w=>w.body)).toEqual([{enabled:false,previews_enabled:false},{enabled:true,previews_enabled:false}]);
});
it.each([{source:'private material'},{sourceType:'multipart/form-data; boundary=x'},{sourceName:'attachment; filename="other.js"'},{settings:{bindings:[{name:'SECRET',type:'secret_text'}]}},{settings:{assets:{}}},{stuck:true}])('refuses unsafe rehearsal or unconfirmed disable %j',async change=>{
 const s=server(change,'ajou-study-hub-recovery-test');await expect(rehearseRecovery({accountId,workerId,workerName:'ajou-study-hub-recovery-test',productionUrl:'https://ajou-study-hub-recovery-test.example.workers.dev'},s.request,'test-token')).rejects.toThrow();
 expect(s.writes.every(w=>JSON.stringify(w.body)==='{"enabled":false,"previews_enabled":false}')).toBe(true);
});
it('rejects oversized API responses before any write',async()=>{
 const methods:string[]=[];const oversized:typeof fetch=async(_input,init)=>{methods.push(init?.method??'GET');return new Response('x'.repeat(1024*1024+1));};
 await expect(disableEndpoint(settings,workerId,oversized,'test-token')).rejects.toThrow();expect(methods).toEqual(['GET']);
});
it('rejects BOM-prefixed source bytes even though UTF-8 decoding strips the BOM',async()=>{
 const s=server({source:'\ufeffexport default {fetch(){return new Response("recovery-test");}};'},'ajou-study-hub-recovery-test');
 await expect(rehearseRecovery({accountId,workerId,workerName:'ajou-study-hub-recovery-test',productionUrl:'https://ajou-study-hub-recovery-test.example.workers.dev'},s.request,'test-token')).rejects.toThrow();
 expect(s.writes).toEqual([]);
});
it.each([{disabledBody:'generic not found'},{disabledStatus:403,disabledBody:'error code: 1003'},{probeRedirect:true}])('does not restore after API disable and unproven external withdrawal %j',async change=>{
 const s=server(change,'ajou-study-hub-recovery-test');
 await expect(rehearseRecovery({accountId,workerId,workerName:'ajou-study-hub-recovery-test',productionUrl:'https://ajou-study-hub-recovery-test.example.workers.dev'},s.request,'test-token')).rejects.toThrow();
 expect(s.writes.every(w=>(w.body as {enabled:boolean}).enabled===false)).toBe(true);
 expect(s.writes).toHaveLength(1);
});
