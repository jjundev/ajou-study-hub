import { createHash } from 'node:crypto';
import { normalizeAccess, readAccessData, validateSettings, type AccessSnapshot, type AccessReadData, type DeploymentSettings, type ReadOptions } from './access.js';
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
// Deliberately conservative supported subset of the official cloudflare-typescript
// Worker, SelfHostedApplication, Policy, IdentityProvider, Organization and
// Subscription schemas. New keys (including nested keys) require explicit review.
// Unsupported account features remain a readiness blocker, never silently ignored.
export function projectProtection(settings:DeploymentSettings,value:unknown):string {
 validateSettings(settings);
 exactKeys(value,['worker','apps','policies','idps','hosts','subscriptions','organization','exposure'],['worker','apps','policies','idps','hosts','subscriptions','organization']);
 shape(value.worker,{id:string,name:string,created_on:string,updated_on:string,modified_on:string,deployed_on:nullable(string),version:string,logpush:bool,observability,references:nested({domains:empty,dispatch_namespace_outbounds:empty,durable_objects:empty,queues:empty,workers:empty}),subdomain:nested({enabled:v=>v===true,previews_enabled:v=>v===false}),tags:strings,tail_consumers:empty},['id','name']);
 if(!Array.isArray(value.apps)||!Array.isArray(value.idps)||!Array.isArray(value.subscriptions)||!isRecord(value.policies))fail();
 for(const app of value.apps){
  shape(app,{id:string,type:string,name:string,aud:string,domain:string,self_hosted_domains:strings,destinations:items(nested({type:v=>v==='worker'||v==='public',worker_id:string,uri:string,overrides:empty},['type'])),allowed_idps:strings,options_preflight_bypass:v=>v===false,allow_iframe:bool,app_launcher_visible:bool,auto_redirect_to_identity:bool,enable_binding_cookie:bool,http_only_cookie_attribute:bool,eager_redirect_cookie_setting:bool,service_auth_401_redirect:bool,skip_interstitial:bool,use_clientless_isolation_app_launcher_url:bool,same_site_cookie_attribute:string,session_duration:string,created_at:string,updated_at:string,custom_deny_message:string,custom_deny_url:string,logo_url:string},['id','type']);
 }
 const appIds=value.apps.map(a=>(a as RecordValue).id);
 if(new Set(appIds).size!==appIds.length||Object.keys(value.policies).length!==appIds.length||Object.keys(value.policies).some(id=>!appIds.includes(id)))fail();
 for(const policies of Object.values(value.policies)){
  if(!Array.isArray(policies))fail();
  for(const policy of policies)shape(policy,{id:v=>string(v)&&!!v,name:string,decision:string,include:items(nested({email:nested({email:string},['email'])},['email'])),exclude:empty,require:empty,precedence:finite,session_duration:string,created_at:string,updated_at:string,purpose_justification_required:v=>v===false,approval_required:v=>v===false},['id','decision','include']);
 }
 for(const idp of value.idps)shape(idp,{id:string,type:string,name:string,config:nested({}),created_at:string,updated_at:string},['id','type']);
 if(new Set(value.idps.map(idp=>(idp as RecordValue).id)).size!==value.idps.length)fail();
 shape(value.organization,{auth_domain:string,id:string,name:string,created_at:string,updated_at:string,session_duration:string,is_ui_read_only:bool,user_seat_expiration_inactive_time:string,auto_redirect_to_identity:bool},['auth_domain']);
 for(const subscription of value.subscriptions)shape(subscription,{id:string,state:string,price:finite,currency:string,trial:v=>v===null,rate_plan:nested({id:string,public_name:string,currency:string,scope:string,externally_managed:bool,is_contract:bool},['id','public_name','currency','scope','externally_managed','is_contract']),frequency:string,current_period_start:string,current_period_end:string,created_on:string,modified_on:string},['state','price','currency','trial','rate_plan']);
 if(value.exposure!==undefined){
  shape(value.exposure,{subdomain:nested({enabled:v=>v===true,previews_enabled:v=>v===false},['enabled','previews_enabled']),accountSubdomain:nested({subdomain:string},['subdomain']),routes:items(nested({id:string,pattern:string,script:nullable(string)},['id','pattern']))},['subdomain','accountSubdomain','routes']);
 }
 const data=value as AccessReadData;
 normalizeAccess(settings,data);
 const worker={...data.worker};
 // Only these Worker deployment metadata fields are excluded. Creation time and
 // all timestamps on policy/identity/account objects remain bound conservatively.
 for(const key of ['version','modified_on','updated_on','deployed_on'])delete worker[key];
 const sort=(v:unknown[])=>[...v].sort((a,b)=>{const left=canonical(a),right=canonical(b);return left<right?-1:left>right?1:0;});
 return canonical({accountId:settings.accountId,worker,apps:sort(data.apps),policies:Object.fromEntries(Object.entries(data.policies).map(([id,p])=>[id,sort(p)])),idps:sort(data.idps),hosts:sort(data.hosts),subscriptions:sort(data.subscriptions),organization:data.organization,...(data.exposure?{exposure:{...data.exposure,routes:sort(data.exposure.routes)}}:{})});
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function readAccessInspection(settings:DeploymentSettings,options:ReadOptions={}):Promise<AccessInspection>{
 try{
  const opts={...options,token:options.token??process.env.CLOUDFLARE_READ_TOKEN??process.env.CLOUDFLARE_API_TOKEN};
  const data=await readAccessData(settings,opts),snapshot=normalizeAccess(settings,data),protectionFingerprint=sha256(projectProtection(settings,data));
  if(!opts.token)fail();
  const response=await (opts.fetch??fetch)(`https://api.cloudflare.com/client/v4/accounts/${settings.accountId}/workers/scripts/${settings.workerName}/deployments`,{headers:{Authorization:'Bearer '+opts.token},redirect:'error'});
  if(!response.ok)fail();const envelope:unknown=await response.json();
  exactKeys(envelope,['success','errors','messages','result','result_info'],['success','errors','result']);
  if(envelope.success!==true||!Array.isArray(envelope.errors)||envelope.errors.length||envelope.messages!==undefined&&!Array.isArray(envelope.messages))fail();
  if(envelope.result_info!==undefined)shape(envelope.result_info,{page:v=>v===1,total_pages:v=>v===1,count:v=>Number.isSafeInteger(v)&&(v as number)>=0,total_count:v=>Number.isSafeInteger(v)&&(v as number)>=0,per_page:v=>Number.isSafeInteger(v)&&(v as number)>0},[]);
  exactKeys(envelope.result,['deployments']);const deployments=envelope.result.deployments;
  if(!Array.isArray(deployments)||!deployments.length)fail();
  if(isRecord(envelope.result_info)){const info=envelope.result_info;if(info.count!==undefined&&info.count!==deployments.length||info.total_count!==undefined&&info.total_count!==deployments.length||info.per_page!==undefined&&(info.per_page as number)<deployments.length)fail();}
  const current=deployments[0];
  shape(current,{id:v=>typeof v==='string'&&uuid.test(v),strategy:v=>v==='percentage',versions:items(nested({version_id:v=>typeof v==='string'&&uuid.test(v),percentage:v=>v===100},['version_id','percentage'])),created_on:string,source:string,author_email:string,annotations:nested({'workers/message':string,'workers/triggered_by':string})},['id','strategy','versions']);
  if(!Array.isArray(current.versions)||current.versions.length!==1)fail();
  return {snapshot,workerId:data.worker.id,protectionFingerprint,versionId:(current.versions[0] as RecordValue).version_id as string};
 }catch{throw Error('Access inspection failed; automation remains unauthorized');}
}
