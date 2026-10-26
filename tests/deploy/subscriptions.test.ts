import { expect, it } from 'vitest';
import { assertFreeSubscriptions } from '../../tools/deploy/access.js';
export const freeSubscription=()=>({state:'Paid',price:0,currency:'USD',trial:null,rate_plan:{id:'teams_free',public_name:'Teams Free Base',currency:'USD',scope:'account',externally_managed:false,is_contract:false}});
it('recognizes the observed Teams Free subscription with default Workers Free',()=>{
  expect(()=>assertFreeSubscriptions([freeSubscription()])).not.toThrow();
});
it.each(['price','id','name','trial','state','currency','contract','managed','scope','missing-trial','extra','duplicate','empty'])('rejects %s subscriptions',kind=>{
  const sub:any=freeSubscription();let rows:any[]=[sub];
  if(kind==='price')sub.price=5;
  if(kind==='id')sub.rate_plan.id='workers_paid';
  if(kind==='name')sub.rate_plan.public_name='Teams Standard';
  if(kind==='trial')sub.trial={id:'trial'};
  if(kind==='state')sub.state='Trial';
  if(kind==='currency')sub.currency='EUR';
  if(kind==='contract')sub.rate_plan.is_contract=true;
  if(kind==='managed')sub.rate_plan.externally_managed=true;
  if(kind==='scope')sub.rate_plan.scope='zone';
  if(kind==='missing-trial')delete sub.trial;
  if(kind==='extra')rows.push({state:'Paid',price:0,rate_plan:{id:'workers_paid',public_name:'Workers Paid'}});
  if(kind==='duplicate')rows.push(freeSubscription());
  if(kind==='empty')rows=[];
  expect(()=>assertFreeSubscriptions(rows)).toThrow();
});
