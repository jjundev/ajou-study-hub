import { expect, test } from 'vitest';
import { dispatchUpdate } from '../../tools/ci/notify.js';

test('dispatch_is_fixed', async () => {
  const calls: {url:string; options?:RequestInit}[]=[];
  const request:typeof fetch=async (url,options)=>{calls.push({url:String(url),options});return new Response(null,{status:204});};
  await dispatchUpdate('jjundev/ajou-life-science','secret-token',request);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe('https://api.github.com/repos/jjundev/ajou-study-hub/actions/workflows/study-hub-update.yml/dispatches');
  expect(JSON.parse(String(calls[0]!.options!.body))).toEqual({ref:'main',inputs:{source_repository:'jjundev/ajou-life-science'}});
  expect(calls[0]!.options!.method).toBe('POST');
  expect(calls[0]!.options!.redirect).toBe('error');
});
test('rejects_injected_repo_or_ref before HTTP', async () => {
  let calls=0;
  const request:typeof fetch=async ()=>{calls++;return new Response(null,{status:204});};
  for(const value of ['x; echo injected','jjundev/ajou-life-science@other','https://evil.invalid',''])
    await expect(dispatchUpdate(value,'secret',request)).rejects.toThrow();
  await expect(dispatchUpdate('jjundev/ajou-life-science','',request)).rejects.toThrow();
  expect(calls).toBe(0);
});
test('HTTP and transport failures do not expose credentials or response bodies', async () => {
  for(const request of [async()=>new Response('secret-token',{status:403}),async()=>{throw Error('secret-token');}]) {
    await expect(dispatchUpdate('jjundev/ajou-life-science','secret-token',request)).rejects.toThrow(/^Study hub dispatch failed$/);
  }
});
