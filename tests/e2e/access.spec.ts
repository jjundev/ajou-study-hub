import { test, expect } from '@playwright/test';
import { recognizedAccessDenial } from '../../tools/deploy/access.js';
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
