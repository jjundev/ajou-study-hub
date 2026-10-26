import { expect, it } from 'vitest';
import { readCloudflareList } from '../../tools/deploy/cloudflare-list.js';

it('reads Workers pages using total_count when total_pages is absent', async () => {
  const paths:string[]=[];
  const result=await readCloudflareList(async path=>{
    paths.push(path);
    const page=Number(new URL('https://example.test'+path).searchParams.get('page'));
    return {result:page===1?[{id:'first'},{id:'second'}]:[{id:'last'}],result_info:{page,per_page:2,count:page===1?2:1,total_count:3}};
  },'/workers');
  expect(result.map(x=>x.id)).toEqual(['first','second','last']);
  expect(paths).toHaveLength(2);
});

it('requests subscriptions without unsupported query parameters and proves completeness', async () => {
  const rows=await readCloudflareList(async path=>{
    if(path!=='/subscriptions')throw Error('Subscriptions rejects query parameters');
    return {result:[{id:'free'}],result_info:{page:1,per_page:25,total_pages:1,count:1,total_count:1,next_page:false}};
  },'/subscriptions','single-complete');
  expect(rows).toEqual([{id:'free'}]);
});

it.each([
  {page:1},
  {page:1,per_page:2,count:1,total_count:3},
  {page:1,per_page:2,count:2,total_count:3,total_pages:1},
  {page:1,total_pages:1,next_page:true},
  {page:1,total_pages:1,cursors:{after:'next'}},
  {page:1,total_pages:0},
  {page:1,total_pages:1,count:0},
])('rejects incomplete or contradictory paginated metadata: %j',async info=>{
  await expect(readCloudflareList(async()=>({result:[{id:'one'}],result_info:info}),'/workers')).rejects.toThrow();
});

it.each([undefined,{page:1,total_pages:2},{page:1,total_pages:1,total_count:2,count:1,per_page:25},{page:1,total_pages:1,next_page:true}])('rejects incomplete single-response subscription metadata: %j',async info=>{
  await expect(readCloudflareList(async()=>({result:[{id:'free'}],result_info:info}),'/subscriptions','single-complete')).rejects.toThrow();
});
it('accepts the IdP endpoint default page size of 200 without adding query parameters',async()=>{
  const result=await readCloudflareList(async path=>{
    if(path!=='/identity_providers')throw Error('Unexpected query');
    return {result:[{id:'otp'},{id:'default'}],result_info:{page:1,per_page:200,count:2,total_count:2,total_pages:1}};
  },'/identity_providers','single');
  expect(result.map(x=>x.id)).toEqual(['otp','default']);
});
