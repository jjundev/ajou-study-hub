import { test, expect } from '@playwright/test';
import { recognizedAccessDenial, readVerifiedIdentity } from '../../tools/deploy/access.js';
// Browser-only synthetic responses; these tests never attest a real Access account.
test('synthetic owner body is exact and Access denial does not accept a server failure',async({browser})=>{
 const context=await browser.newContext();const page=await context.newPage();
 const sentinel=Buffer.from('SYNTHETIC_PROTECTION_SENTINEL');
 await page.route('https://protection.invalid/**',async route=>{const path=new URL(route.request().url()).pathname;await route.fulfill({status:path==='/owner'?200:path==='/denied'?403:503,headers:{'cf-ray':'synthetic','content-type':'text/plain'},body:path==='/owner'?sentinel:'Cloudflare Access denied'});});
 const owner=await page.goto('https://protection.invalid/owner');expect(await owner!.body()).toEqual(sentinel);
 const denied=await page.goto('https://protection.invalid/denied');expect(recognizedAccessDenial({status:denied!.status(),headers:denied!.headers(),body:await denied!.body()},sentinel,denied!.url())).toBe(true);
 const failed=await page.goto('https://protection.invalid/failed');expect(recognizedAccessDenial({status:failed!.status(),headers:failed!.headers(),body:await failed!.body()},sentinel,failed!.url())).toBe(false);
 await context.close();
});
test('synthetic identity request uses the confirmed team origin and normal scoped cookies',async({browser})=>{
 const context=await browser.newContext();const page=await context.newPage();
 await context.addCookies([{name:'CF_Authorization',value:'synthetic-team-session',url:'https://synthetic-team.cloudflareaccess.com'},{name:'CF_Authorization',value:'synthetic-worker-session',url:'https://protection.invalid'}]);
 expect((await context.cookies('https://synthetic-team.cloudflareaccess.com')).map(cookie=>cookie.value)).toEqual(['synthetic-team-session']);
 await page.route('https://synthetic-team.cloudflareaccess.com/**',async route=>{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({email:'other@example.test',account_id:'a'.repeat(32),user_uuid:'synthetic-user',service_token_status:false})});});
 const request={get:async(url:string)=>{expect(url).toBe('https://synthetic-team.cloudflareaccess.com/cdn-cgi/access/get-identity');return (await page.goto(url))!;}};
 expect(await readVerifiedIdentity(request,'synthetic-team.cloudflareaccess.com','a'.repeat(32))).toBe('other@example.test');await context.close();
});
