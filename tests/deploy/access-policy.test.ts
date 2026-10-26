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
function requestFixture(mode:string,raw=fixture()):typeof fetch {
 return async input=>{
 const url=new URL(String(input));let result:unknown;let collection=false;
 if(url.pathname.endsWith('/workers/workers')){result=[raw.worker];collection=true;}
 else if(url.pathname.endsWith('/workers/workers/immutable-worker-id'))result=raw.worker;
 else if(url.pathname.endsWith('/scripts/ajou-study-hub/subdomain'))result={enabled:true,previews_enabled:false};
 else if(url.pathname.endsWith('/workers/subdomain'))result={subdomain:'example'};
 else if(url.pathname.endsWith('/zones')){result=[];collection=true;}
 else if(url.pathname.endsWith('/access/apps')){result=raw.apps;collection=true;}
 else if(url.pathname.endsWith('/policies')){result=raw.policies[url.pathname.split('/').at(-2)!];collection=true;}
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
// Full response shape uses synthetic identities and the reviewed public catalog only.
function fullFixture():any {
 const raw=fixture(),otherApp='55555555-5555-5555-5555-555555555555';
 raw.worker.subdomain={enabled:true,previews_enabled:false,url:settings.productionUrl,preview_url_suffix:'-'+new URL(settings.productionUrl).hostname};
 raw.worker.references={domains:[],workers:[],dispatch_namespace_outbounds:[],durable_objects:[],queues:[]};raw.worker.tail_consumers=[];
 raw.exposure={subdomain:{enabled:true,previews_enabled:false},accountSubdomain:{subdomain:'example'},routes:[]};
 Object.assign(raw.policies[settings.accessAppId][0],{uid:'policy-id',reusable:true,connection_rules:{rdp:{}}});
 Object.assign(raw.apps[0],{uid:settings.accessAppId,tags:[],policies:structuredClone(raw.policies[settings.accessAppId])});
 raw.policies[otherApp]=[{...structuredClone(raw.policies[settings.accessAppId][0]),id:'other-policy',uid:'other-policy'}];
 raw.apps.push({id:otherApp,uid:otherApp,type:'self_hosted',domain:'unrelated.example.test',tags:[],policies:structuredClone(raw.policies[otherApp])});
 const scim={enabled:false,group_member_deprovision:false,seat_deprovision:false,user_deprovision:false};
 Object.assign(raw.idps[0],{uid:'otp-id',version:'synthetic-v1.0',config:{redirect_url:'https://team.cloudflareaccess.com/cdn-cgi/access/callback'},scim_config:{...scim}});
 raw.idps.push({id:'cloudflare-id',uid:'cloudflare-id',type:'cloudflare',version:'synthetic-v1.0',config:{redirect_url:'https://team.cloudflareaccess.com/cdn-cgi/access/callback',restrict_to_account_members:true},scim_config:{...scim}});
 Object.assign(raw.organization,{allow_authenticate_via_warp:false,strict_service_token_auth:true,warp_auth_non_browser_401:false,trusted_accounts:[],deny_unmatched_requests_exempted_zone_names:[],login_design:{},service_token_inactivity:{enabled:false,action:null,inactivity_threshold_days:null},cache_device_posture:true,has_migrated_private_apps:true,disable_end_user_app_creation:false,deny_unmatched_requests:false});
 Object.assign(raw.subscriptions[0],{cancel_at_period_end:false,client_secrets:null,handler:'stripe',intent:'PAYGO',created_date:'2026-10-26T00:00:00Z',external_id:'synthetic-subscription',product:{name:'prod_teams',public_name:'Teams Free Base',billing:'',period:'',duration:0},component_values:[{name:'users',display_name:'Users',kind:'sum',default:50,value:50}]});raw.subscriptions[0].rate_plan.sets=null;
 return raw;
}
it('accepts the reviewed full observed shape without granting alternate auth or changing legacy short variants',()=>{
 const projected=JSON.parse(projectProtection(settings,fullFixture()));
 expect(projected.idps).toHaveLength(2);expect(projected.apps).toHaveLength(2);
 expect(projected.subscriptions[0].component_values).toEqual([{name:'users',display_name:'Users',kind:'sum',default:50,value:50}]);
 expect(()=>projectProtection(settings,fixture())).not.toThrow();
});
const unsafeFullMutations:[string,(r:any)=>void][]=[
 ['worker-url',r=>r.worker.subdomain.url='https://wrong.workers.dev'],['worker-suffix',r=>r.worker.subdomain.preview_url_suffix='-'+new URL(settings.productionUrl).hostname+'.evil.test'],['worker-previews',r=>r.worker.subdomain.previews_enabled=true],['exposure-disagreement',r=>r.exposure.subdomain.enabled=false],
 ['app-uid',r=>r.apps[0].uid='wrong'],['policy-uid',r=>r.policies[settings.accessAppId][0].uid='wrong'],['provider-uid',r=>r.idps[0].uid='wrong'],['uid-only',r=>delete r.apps[0].id],['app-tags',r=>r.apps[0].tags=['extra']],
 ['embedded-missing',r=>r.apps[0].policies=[]],['embedded-extra',r=>r.apps[0].policies.push(r.apps[0].policies[0])],['embedded-owner',r=>r.apps[0].policies[0].include[0].email.email='other@example.test'],['embedded-id',r=>r.apps[0].policies[0].id='different'],['embedded-reusable',r=>r.apps[0].policies[0].reusable=false],['duplicate-policy-id',r=>r.policies[settings.accessAppId].push(r.policies[settings.accessAppId][0])],['reusable-type',r=>r.policies[settings.accessAppId][0].reusable='true'],
 ['rdp-populated',r=>r.policies[settings.accessAppId][0].connection_rules.rdp.clipboard=true],['rdp-missing',r=>r.policies[settings.accessAppId][0].connection_rules={}],['rdp-unknown',r=>r.policies[settings.accessAppId][0].connection_rules.ssh={}],
 ['callback-origin',r=>r.idps[0].config.redirect_url='https://evil.test/cdn-cgi/access/callback'],['callback-credentials',r=>r.idps[0].config.redirect_url='https://x@team.cloudflareaccess.com/cdn-cgi/access/callback'],['callback-query',r=>r.idps[0].config.redirect_url+='?x=1'],['callback-fragment',r=>r.idps[0].config.redirect_url+='#x'],['callback-path',r=>r.idps[0].config.redirect_url+='x'],['version-empty',r=>r.idps[0].version=''],['version-number',r=>r.idps[0].version=1],['version-unsafe',r=>r.idps[0].version='secret/value'],['version-long',r=>r.idps[0].version='a'.repeat(129)],['otp-restriction',r=>r.idps[0].config.restrict_to_account_members=true],['cloudflare-unrestricted',r=>r.idps[1].config.restrict_to_account_members=false],['select-cloudflare',r=>r.apps[0].allowed_idps=['cloudflare-id']],['unknown-provider',r=>r.idps[1].type='oauth'],
 ...['enabled','group_member_deprovision','seat_deprovision','user_deprovision'].map(key=>['scim-'+key,(r:any)=>{r.idps[0].scim_config[key]=true;}] as [string,(r:any)=>void]),['scim-missing',r=>delete r.idps[0].scim_config.enabled],['scim-unknown',r=>r.idps[0].scim_config.secret='synthetic'],
 ...['allow_authenticate_via_warp','strict_service_token_auth','warp_auth_non_browser_401','cache_device_posture','has_migrated_private_apps','disable_end_user_app_creation','deny_unmatched_requests'].map(key=>['org-'+key,(r:any)=>{r.organization[key]=!r.organization[key];}] as [string,(r:any)=>void]),['trusted-account',r=>r.organization.trusted_accounts=['other']],['exempt-zone',r=>r.organization.deny_unmatched_requests_exempted_zone_names=['example.test']],['login-design',r=>r.organization.login_design.extra=true],['inactivity-enabled',r=>r.organization.service_token_inactivity.enabled=true],['inactivity-action',r=>r.organization.service_token_inactivity.action='delete'],['inactivity-threshold',r=>r.organization.service_token_inactivity.inactivity_threshold_days=30],['org-unknown',r=>r.organization.new_auth=true],
 ['cancel',r=>r.subscriptions[0].cancel_at_period_end=true],['secrets',r=>r.subscriptions[0].client_secrets={}],['sets',r=>r.subscriptions[0].rate_plan.sets=[]],['handler',r=>r.subscriptions[0].handler='other'],['intent',r=>r.subscriptions[0].intent='contract'],['product-name',r=>r.subscriptions[0].product.name='paid'],['product-public-name',r=>r.subscriptions[0].product.public_name='Paid'],['billing',r=>r.subscriptions[0].product.billing='monthly'],['period',r=>r.subscriptions[0].product.period='month'],['duration',r=>r.subscriptions[0].product.duration=1],['component-extra',r=>r.subscriptions[0].component_values.push({...r.subscriptions[0].component_values[0]})],['component-name',r=>r.subscriptions[0].component_values[0].name='metered'],['component-label',r=>r.subscriptions[0].component_values[0].display_name='Other'],['component-kind',r=>r.subscriptions[0].component_values[0].kind='usage'],['component-default',r=>r.subscriptions[0].component_values[0].default=51],['component-value',r=>r.subscriptions[0].component_values[0].value=51],['component-unknown',r=>r.subscriptions[0].component_values[0].price=0],['full-fragment',r=>delete r.subscriptions[0].intent],['missing-sets',r=>delete r.subscriptions[0].rate_plan.sets],['bad-date',r=>r.subscriptions[0].created_date='later'],['empty-external-id',r=>r.subscriptions[0].external_id=''],['long-external-id',r=>r.subscriptions[0].external_id='a'.repeat(257)],['paid',r=>r.subscriptions[0].price=1],['trial',r=>r.subscriptions[0].trial={}],['currency',r=>r.subscriptions[0].currency='EUR'],['contract',r=>r.subscriptions[0].rate_plan.is_contract=true],['managed',r=>r.subscriptions[0].rate_plan.externally_managed=true],['owner-bypass',r=>{r.policies[settings.accessAppId][0].decision='bypass';r.apps[0].policies=structuredClone(r.policies[settings.accessAppId]);}],
];
it.each(unsafeFullMutations)('rejects full-response unsafe mutation: %s',(_name,mutate)=>{
 const raw=fullFixture();expect(()=>projectProtection(settings,raw)).not.toThrow();mutate(raw);expect(()=>projectProtection(settings,raw)).toThrow();
});
it.each(['provider-version','external-id','created-date','reusable','uid-presence','callback-presence','org-presence'])('hash-binds accepted added-field drift: %s',kind=>{
 const raw=fullFixture(),changed=structuredClone(raw),before=projectProtection(settings,raw);
 if(kind==='provider-version')changed.idps[0].version='synthetic-v2';
 if(kind==='external-id')changed.subscriptions[0].external_id='other-synthetic';
 if(kind==='created-date')changed.subscriptions[0].created_date='2026-10-27T00:00:00Z';
 if(kind==='reusable'){changed.policies[settings.accessAppId][0].reusable=false;changed.apps[0].policies[0].reusable=false;}
 if(kind==='uid-presence'){delete changed.idps[0].uid;}
 if(kind==='callback-presence')changed.idps[0].config={};
 if(kind==='org-presence')delete changed.organization.cache_device_posture;
 expect(projectProtection(settings,changed)).not.toEqual(before);
});

it('reads the complete reviewed two-app/provider response through the shared GET adapter',async()=>{
 const result=await readAccessInspection(settings,{fetch:requestFixture('ok',fullFixture()),token:'synthetic'});
 expect(result.versionId).toBe('22222222-2222-2222-2222-222222222222');expect(result.snapshot.allowedEmails).toEqual(['owner@example.test']);expect(result.snapshot.otpProviderId).toBe('otp-id');
});
it('retains the entire supported additional state while ignoring only reviewed Worker deployment metadata',()=>{
 const raw=fullFixture(),projected=JSON.parse(projectProtection(settings,raw));
 expect(projected.worker.subdomain).toEqual(raw.worker.subdomain);expect(projected.organization).toEqual(raw.organization);expect(projected.subscriptions).toEqual(raw.subscriptions);
 expect(projected.idps.find((idp:any)=>idp.id==='otp-id')).toEqual(raw.idps[0]);expect(projected.apps.find((app:any)=>app.id===settings.accessAppId)).toEqual(raw.apps[0]);
 const changed=structuredClone(raw);Object.assign(changed.worker,{version:'next',updated_on:'later',modified_on:'later',deployed_on:'later'});expect(projectProtection(settings,changed)).toBe(projectProtection(settings,raw));
});
it.each(['2026-02-31T00:00:00Z','2026-13-01T00:00:00Z'])('rejects nonexistent subscription calendar date %s',created=>{
 const raw=fullFixture();raw.subscriptions[0].created_date=created;expect(()=>projectProtection(settings,raw)).toThrow();
});
