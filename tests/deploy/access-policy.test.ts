import { expect, it } from 'vitest';
import { projectProtection, readAccessInspection } from '../../tools/deploy/access-policy.js';
const settings={accountId:'a'.repeat(32),workerName:'ajou-study-hub',allowedEmail:'owner@example.test',accessAppId:'11111111-1111-1111-1111-111111111111',productionUrl:'https://ajou-study-hub.example.workers.dev',previewUrls:[]};
function fixture():any{return {organization:{auth_domain:'team.cloudflareaccess.com'},worker:{id:'immutable-worker-id',name:settings.workerName,references:{domains:[]}},apps:[{id:settings.accessAppId,type:'self_hosted',destinations:[{type:'worker',worker_id:'immutable-worker-id'}],allowed_idps:['otp-id'],options_preflight_bypass:false}],policies:{[settings.accessAppId]:[{id:'policy-id',decision:'allow',include:[{email:{email:settings.allowedEmail}}],exclude:[],require:[]}]},idps:[{id:'otp-id',type:'onetimepin'}],hosts:[settings.productionUrl],subscriptions:[{state:'Paid',price:0,currency:'USD',trial:null,rate_plan:{id:'teams_free',public_name:'Teams Free Base',currency:'USD',scope:'account',externally_managed:false,is_contract:false}}]};}
it('ignores only known Worker deployment metadata and canonicalizes object order',()=>{
 const raw=fixture(),next=structuredClone(raw);next.worker.modified_on='later';next.worker.version='next';
 expect(projectProtection(settings,next)).toEqual(projectProtection(settings,raw));
 const reordered={...raw,worker:{name:settings.workerName,references:{domains:[]},id:'immutable-worker-id'}};
 expect(projectProtection(settings,reordered)).toEqual(projectProtection(settings,raw));
});
it.each(['worker','policy','provider','team','session'])('retains security identity/value change: %s',kind=>{
 const raw=fixture(),next=structuredClone(raw);
 if(kind==='worker'){next.worker.id='new-worker';next.apps[0].destinations[0].worker_id='new-worker';}
 if(kind==='policy')next.policies[settings.accessAppId][0].id='new-policy';
 if(kind==='provider'){next.apps[0].allowed_idps=['new-otp'];next.idps[0].id='new-otp';}
 if(kind==='team')next.organization.auth_domain='other.cloudflareaccess.com';
 if(kind==='session')next.apps[0].session_duration='12h';
 expect(projectProtection(settings,next)).not.toEqual(projectProtection(settings,raw));
});
it.each(['unknown-worker','unknown-app','unknown-policy','unknown-destination','unknown-org','unknown-idp','unknown-subscription','unknown-plan','unknown-references','unknown-nested','missing-policy-id','wildcard','bypass','paid','extra-owner','all-workers','all-previews'])('rejects unsupported or unsafe %s',kind=>{
 const raw=fixture();
 const targets:any={'unknown-worker':raw.worker,'unknown-app':raw.apps[0],'unknown-policy':raw.policies[settings.accessAppId][0],'unknown-destination':raw.apps[0].destinations[0],'unknown-org':raw.organization,'unknown-idp':raw.idps[0],'unknown-subscription':raw.subscriptions[0],'unknown-plan':raw.subscriptions[0].rate_plan,'unknown-references':raw.worker.references};
 if(targets[kind])targets[kind].future_security_option=true;
 if(kind==='unknown-nested')raw.worker.observability={logs:{future:true}};
 if(kind==='missing-policy-id')delete raw.policies[settings.accessAppId][0].id;
 if(kind==='wildcard')raw.apps.push({id:'overlap',domain:'*.workers.dev'});
 if(kind==='bypass')raw.apps[0].options_preflight_bypass=true;
 if(kind==='paid')raw.subscriptions[0].price=1;
 if(kind==='all-workers'||kind==='all-previews'){raw.apps.push({id:'global-app',type:'self_hosted',destinations:[{type:kind==='all-workers'?'all_workers':'all_preview_workers'}]});raw.policies['global-app']=[];}
 if(kind==='extra-owner')raw.policies[settings.accessAppId][0].include.push({email:{email:'other@example.test'}});
 expect(()=>projectProtection(settings,raw)).toThrow();
});
function requestFixture(mode:string):typeof fetch {
 const raw=fixture();return async input=>{
 const url=new URL(String(input));let result:unknown;let collection=false;
 if(url.pathname.endsWith('/workers/workers')){result=[raw.worker];collection=true;}
 else if(url.pathname.endsWith('/workers/workers/immutable-worker-id'))result=raw.worker;
 else if(url.pathname.endsWith('/scripts/ajou-study-hub/subdomain'))result={enabled:true,previews_enabled:false};
 else if(url.pathname.endsWith('/workers/subdomain'))result={subdomain:'example'};
 else if(url.pathname.endsWith('/zones')){result=[];collection=true;}
 else if(url.pathname.endsWith('/access/apps')){result=raw.apps;collection=true;}
 else if(url.pathname.endsWith('/policies')){result=raw.policies[settings.accessAppId];collection=true;}
 else if(url.pathname.endsWith('/identity_providers'))result=raw.idps;
 else if(url.pathname.endsWith('/subscriptions')){result=raw.subscriptions;collection=true;}
 else if(url.pathname.endsWith('/access/organizations'))result=raw.organization;
 else if(url.pathname.endsWith('/deployments')){const deployment:any={id:'44444444-4444-4444-4444-444444444444',strategy:'percentage',versions:[{version_id:'22222222-2222-2222-2222-222222222222',percentage:100}]};if(mode==='mixed')deployment.versions.push({version_id:'33333333-3333-3333-3333-333333333333',percentage:0});if(mode==='partial')deployment.versions[0].percentage=99;if(mode==='invalid-id')deployment.versions[0].version_id='bad';result={deployments:mode==='empty'?[]:[deployment]};if(mode==='array')result=[deployment];}
 else throw Error('Unexpected synthetic request');
 return new Response(JSON.stringify({success:mode!=='api-error',errors:[],result,...(mode==='bad-metadata'&&url.pathname.endsWith('/deployments')?{result_info:{page:1,total_pages:1,count:-1}}:{}),...(collection?{result_info:{page:1,total_pages:1,per_page:100,count:(result as any[]).length,total_count:(result as any[]).length,next_page:false}}:{})}));
 };
}
it('reads an unambiguous active version independently from stable protection',async()=>{
 const value=await readAccessInspection(settings,{fetch:requestFixture('ok'),token:'synthetic'});
 expect(value.workerId).toBe('immutable-worker-id');expect(value.versionId).toBe('22222222-2222-2222-2222-222222222222');expect(value.protectionFingerprint).toMatch(/^[a-f0-9]{64}$/);
});
it.each(['mixed','partial','invalid-id','empty','array','api-error','bad-metadata'])('refuses ambiguous deployment %s',async kind=>{await expect(readAccessInspection(settings,{fetch:requestFixture(kind),token:'synthetic'})).rejects.toThrow();});
it('uses locale-independent code-unit ordering in the semantic projection',()=>{
 const raw=fixture();raw.idps.push({id:'A-id',type:'onetimepin'},{id:'a-id',type:'onetimepin'});
 expect(JSON.parse(projectProtection(settings,raw)).idps.map((p:{id:string})=>p.id)).toEqual(['A-id','a-id','otp-id']);
});
it('rejects duplicate provider IDs instead of selecting a matching OTP row from ambiguous identities',()=>{
 const raw=fixture();raw.idps.push({id:'otp-id',type:'oauth'});
 expect(()=>projectProtection(settings,raw)).toThrow();
});
