import { createHash } from 'node:crypto';
import { normalizeAccess, readAccessData, validateSettings, type AccessSnapshot, type AccessReadData, type DeploymentSettings, type ReadOptions } from './access.js';
import { readActiveVersion } from './worker-target.js';
export type AccessInspection={snapshot:AccessSnapshot;workerId:string;protectionFingerprint:string;versionId:string};
type RecordValue=Record<string,unknown>;
export const isRecord=(v:unknown):v is RecordValue=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const sha256=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
export function canonical(v:unknown):string {
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(isRecord(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
 throw Error('Unsupported protection value');
}
export const digest=(v:unknown)=>sha256(canonical(v));
function fail():never{throw Error('Unsupported or unsafe Access protection configuration');}
export function exactKeys(v:unknown,allowed:string[],required:string[]=allowed):asserts v is RecordValue {
 if(!isRecord(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail();
}
type Rule=(v:unknown)=>boolean;
const string:Rule=v=>typeof v==='string', bool:Rule=v=>typeof v==='boolean';
const strings:Rule=v=>Array.isArray(v)&&v.every(string),empty:Rule=v=>Array.isArray(v)&&v.length===0;
function shape(v:unknown,rules:Record<string,Rule>,required:string[]=[]):asserts v is RecordValue {
 exactKeys(v,Object.keys(rules),required);for(const [key,value] of Object.entries(v))if(!rules[key]!(value))fail();
}
const nested=(rules:Record<string,Rule>,required:string[]=[]):Rule=>v=>{shape(v,rules,required);return true;};
const items=(rule:Rule):Rule=>v=>Array.isArray(v)&&v.every(rule);
const finite:Rule=v=>typeof v==='number'&&Number.isFinite(v);
const nullable=(rule:Rule):Rule=>v=>v===null||rule(v);
const sample:Rule=v=>finite(v)&&(v as number)>=0&&(v as number)<=1;
const observability=nested({enabled:bool,head_sampling_rate:sample,redact_query_string:bool,issues:nullable(nested({enabled:bool})),logs:nested({destinations:strings,enabled:bool,head_sampling_rate:sample,invocation_logs:bool,persist:bool}),traces:nested({destinations:strings,enabled:bool,head_sampling_rate:sample,persist:bool,propagation_policy:nullable(v=>v==='authenticated'||v==='accept')})});
const isFalse:Rule=v=>v===false, isTrue:Rule=v=>v===true, isNull:Rule=v=>v===null;
const opaqueVersion:Rule=v=>typeof v==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(v);
const opaqueId:Rule=v=>typeof v==='string'&&v.length<=256&&v.trim().length>0&&!/[\u0000-\u001f\u007f]/.test(v);
const timestamp:Rule=v=>{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))return false;
 return new Date(v.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===v.slice(0,10);
};
const sortCanonical=(v:unknown[])=>[...v].sort((a,b)=>{const left=canonical(a),right=canonical(b);return left<right?-1:left>right?1:0;});
function alias(value:RecordValue):void {if(Object.hasOwn(value,'uid')&&value.uid!==value.id)fail();}
const policyRows:Rule=value=>{
 if(!Array.isArray(value))return false;
 for(const row of value){
  shape(row,{id:v=>string(v)&&!!v,uid:string,name:string,decision:string,include:items(nested({email:nested({email:string},['email'])},['email'])),exclude:empty,require:empty,precedence:finite,session_duration:string,created_at:string,updated_at:string,purpose_justification_required:isFalse,approval_required:isFalse,reusable:bool,connection_rules:nested({rdp:nested({})},['rdp'])},['id','decision','include']);
  alias(row);
 }
 if(new Set(value.map(row=>row.id)).size!==value.length)fail();
 return true;
};
function policySecurity(rows:unknown[]):string {
 const fields=['id','uid','decision','include','exclude','require','reusable','connection_rules'];
 return canonical(sortCanonical(rows.map(row=>{const value=row as RecordValue;return Object.fromEntries(fields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));})));
}
const disabledScim=nested({enabled:isFalse,group_member_deprovision:isFalse,seat_deprovision:isFalse,user_deprovision:isFalse},['enabled','group_member_deprovision','seat_deprovision','user_deprovision']);
const fullBilling=['cancel_at_period_end','client_secrets','handler','intent','product','component_values','created_date','external_id'];
function subscriptionShape(value:unknown):void {
 const ratePlan={id:string,public_name:string,currency:string,scope:string,externally_managed:bool,is_contract:bool,sets:isNull};
 const rules:Record<string,Rule>={id:string,state:string,price:finite,currency:string,trial:isNull,rate_plan:nested(ratePlan,['id','public_name','currency','scope','externally_managed','is_contract']),frequency:string,current_period_start:string,current_period_end:string,created_on:string,modified_on:string,
  cancel_at_period_end:isFalse,client_secrets:isNull,handler:v=>v==='stripe',intent:v=>v==='PAYGO',created_date:timestamp,external_id:opaqueId,
  product:nested({name:v=>v==='prod_teams',public_name:v=>v==='Teams Free Base',billing:v=>v==='',period:v=>v==='',duration:v=>v===0},['name','public_name','billing','period','duration']),
  component_values:v=>Array.isArray(v)&&v.length===1&&nested({name:v=>v==='users',display_name:v=>v==='Users',kind:v=>v==='sum',default:v=>v===50,value:v=>v===50},['name','display_name','kind','default','value'])(v[0])};
 shape(value,rules,['state','price','currency','trial','rate_plan']);
 const plan=value.rate_plan as RecordValue;
 // The complete observed catalog is one variant, never independent optional fragments.
 if(fullBilling.some(k=>Object.hasOwn(value,k))||Object.hasOwn(plan,'sets')){
  if(fullBilling.some(k=>!Object.hasOwn(value,k))||!Object.hasOwn(plan,'sets'))fail();
 }
}
// Deliberately conservative supported subset of the official cloudflare-typescript
// Worker, SelfHostedApplication, Policy, IdentityProvider, Organization and
// Subscription schemas. New keys (including nested keys) require explicit review.
// Unsupported account features remain a readiness blocker, never silently ignored.
export function projectProtection(settings:DeploymentSettings,value:unknown):string {
 validateSettings(settings);
 exactKeys(value,['worker','apps','policies','idps','hosts','subscriptions','organization','exposure'],['worker','apps','policies','idps','hosts','subscriptions','organization']);
 shape(value.worker,{id:string,name:string,created_on:string,updated_on:string,modified_on:string,deployed_on:nullable(string),version:string,logpush:bool,observability,references:nested({domains:empty,dispatch_namespace_outbounds:empty,durable_objects:empty,queues:empty,workers:empty}),subdomain:nested({enabled:isTrue,previews_enabled:isFalse,url:v=>v===settings.productionUrl,preview_url_suffix:v=>v==='-'+new URL(settings.productionUrl).hostname},['enabled','previews_enabled']),tags:strings,tail_consumers:empty},['id','name']);
 if(!Array.isArray(value.apps)||!Array.isArray(value.idps)||!Array.isArray(value.subscriptions)||!isRecord(value.policies))fail();
 for(const app of value.apps){
  shape(app,{id:string,uid:string,tags:empty,policies:policyRows,type:string,name:string,aud:string,domain:string,self_hosted_domains:strings,destinations:items(nested({type:v=>v==='worker'||v==='public',worker_id:string,uri:string,overrides:empty},['type'])),allowed_idps:strings,options_preflight_bypass:v=>v===false,allow_iframe:bool,app_launcher_visible:bool,auto_redirect_to_identity:bool,enable_binding_cookie:bool,http_only_cookie_attribute:bool,eager_redirect_cookie_setting:bool,service_auth_401_redirect:bool,skip_interstitial:bool,use_clientless_isolation_app_launcher_url:bool,same_site_cookie_attribute:string,session_duration:string,created_at:string,updated_at:string,custom_deny_message:string,custom_deny_url:string,logo_url:string},['id','type']);alias(app);
 }
 const appIds=value.apps.map(a=>(a as RecordValue).id);
 if(new Set(appIds).size!==appIds.length||Object.keys(value.policies).length!==appIds.length||Object.keys(value.policies).some(id=>!appIds.includes(id)))fail();
 for(const rows of Object.values(value.policies))if(!policyRows(rows))fail();
 for(const app of value.apps){
  if(Object.hasOwn(app,'policies')&&policySecurity(app.policies)!==policySecurity(value.policies[app.id] as unknown[]))fail();
 }
 // The exact observed cache/migration values are a controller-approved compatibility
 // contract, not inferred semantics. They never suppress owner/policy/identity checks.
 shape(value.organization,{auth_domain:string,id:string,name:string,created_at:string,updated_at:string,session_duration:string,is_ui_read_only:bool,user_seat_expiration_inactive_time:string,auto_redirect_to_identity:bool,
  allow_authenticate_via_warp:isFalse,strict_service_token_auth:isTrue,warp_auth_non_browser_401:isFalse,trusted_accounts:empty,deny_unmatched_requests_exempted_zone_names:empty,login_design:nested({}),service_token_inactivity:nested({enabled:isFalse,action:isNull,inactivity_threshold_days:isNull},['enabled','action','inactivity_threshold_days']),cache_device_posture:isTrue,has_migrated_private_apps:isTrue,disable_end_user_app_creation:isFalse,deny_unmatched_requests:isFalse},['auth_domain']);
 const callback='https://'+value.organization.auth_domain+'/cdn-cgi/access/callback';
 for(const idp of value.idps){
  shape(idp,{id:string,uid:string,type:v=>v==='onetimepin'||v==='cloudflare',name:string,version:opaqueVersion,config:v=>{
   const rules:Record<string,Rule>={redirect_url:v=>v===''||v===callback};
   if(idp.type==='cloudflare')rules.restrict_to_account_members=isTrue;
   shape(v,rules);return true;
  },scim_config:disabledScim,created_at:string,updated_at:string},['id','type']);alias(idp);
 }
 if(new Set(value.idps.map(idp=>(idp as RecordValue).id)).size!==value.idps.length)fail();
 for(const subscription of value.subscriptions)subscriptionShape(subscription);
 if(value.exposure!==undefined){
  shape(value.exposure,{subdomain:nested({enabled:v=>v===true,previews_enabled:v=>v===false},['enabled','previews_enabled']),accountSubdomain:nested({subdomain:string},['subdomain']),routes:items(nested({id:string,pattern:string,script:nullable(string)},['id','pattern']))},['subdomain','accountSubdomain','routes']);
 }
 const data=value as AccessReadData;
 normalizeAccess(settings,data);
 const worker={...data.worker};
 // Only these Worker deployment metadata fields are excluded. Creation time and
 // all timestamps on policy/identity/account objects remain bound conservatively.
 for(const key of ['version','modified_on','updated_on','deployed_on'])delete worker[key];
 const sort=sortCanonical;
 return canonical({accountId:settings.accountId,worker,apps:sort(data.apps),policies:Object.fromEntries(Object.entries(data.policies).map(([id,p])=>[id,sort(p)])),idps:sort(data.idps),hosts:sort(data.hosts),subscriptions:sort(data.subscriptions),organization:data.organization,...(data.exposure?{exposure:{...data.exposure,routes:sort(data.exposure.routes)}}:{})});
}
export async function readAccessInspection(settings:DeploymentSettings,options:ReadOptions={}):Promise<AccessInspection>{
 try{
  const opts={...options,token:options.token??process.env.CLOUDFLARE_READ_TOKEN??process.env.CLOUDFLARE_API_TOKEN};
  const data=await readAccessData(settings,opts),snapshot=normalizeAccess(settings,data),protectionFingerprint=sha256(projectProtection(settings,data));
  return {snapshot,workerId:data.worker.id,protectionFingerprint,versionId:await readActiveVersion(settings,opts)};
 }catch{throw Error('Access inspection failed; automation remains unauthorized');}
}
