import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { transformHtml } from '../../tools/content/transform.js';
import type { DocumentInfo } from '../../src/content/model.js';
const doc: DocumentInfo = {id:'d',courseId:'c',groupId:'g',title:'test',type:'note',sourcePath:'notes/a.html',url:'/a',listed:true};
async function html(course='c', group='g') {
 const bundle = await build({stdin:{contents:`import {installStorage} from './src/compat/storage.ts'; import {storageRules} from './config/storage-rules.ts'; installStorage('study-hub:v1:${course}:${group}:',storageRules);`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
 return transformHtml('<!doctype html><script>window.first=localStorage.getItem("od-note-read:v1:1012");</script><button onclick="localStorage.setItem(\'clicked\',\'yes\');document.querySelector(\'output\').hidden=false">Answer</button><output hidden>answer</output>',doc,bundle.outputFiles[0].text);
}
test('isolates namespaces, shares groups, and preserves Storage operations', async ({page}) => {
 await page.route('https://storage.test/**',async route=>{const u=new URL(route.request().url()); await route.fulfill({contentType:'text/html',body:await html(u.searchParams.get('c')??'c',u.searchParams.get('g')??'g')});});
 await page.goto('https://storage.test/a');
 await page.evaluate(()=>{localStorage.setItem('od-note-read:v1:1012','["q1"]'); localStorage.foo='bar'; sessionStorage.foo='session';});
 expect(await page.evaluate(()=>[[localStorage.key(0),localStorage.key(1)].sort(),localStorage.key(999),localStorage.getItem('missing'),localStorage.missing])).toEqual([['foo','od-note-read:v1:1012'],null,null,undefined]);
 await page.goto('https://storage.test/b');
 expect(await page.evaluate(()=>(window as any).first)).toBe('["q1"]');
 expect(await page.evaluate(()=>[localStorage.foo,sessionStorage.foo,Object.keys(localStorage).sort(),localStorage.length])).toEqual(['bar','session',['foo','od-note-read:v1:1012'],2]);
 await page.goto('https://storage.test/a?c=other'); expect(await page.evaluate(()=>(window as any).first)).toBeNull();
 await page.goto('https://storage.test/a?g=other'); expect(await page.evaluate(()=>(window as any).first)).toBeNull();
 await page.evaluate(()=>localStorage.foo='other'); await page.goto('https://storage.test/a');
 await page.evaluate(()=>{delete localStorage.foo; localStorage.clear();}); expect(await page.evaluate(()=>localStorage.length)).toBe(0);
 await page.goto('https://storage.test/a?g=other'); expect(await page.evaluate(()=>localStorage.foo)).toBe('other');
});
for (const failure of ['getter','quota','none']) test(`recovers invalid shapes and ${failure} failures before first script`,async ({page})=>{
 await page.addInitScript((failure)=>{
 if(failure==='getter') for(const name of ['localStorage','sessionStorage']) Object.defineProperty(window,name,{configurable:true,get(){throw Error('blocked');}});
 else {localStorage.setItem('study-hub:v1:c:g:od-note-read:v1:1012','{}'); if(failure==='quota') Storage.prototype.setItem=function(){throw Error('quota');};}
 },failure);
 await page.route('https://storage.test/**',async route=>route.fulfill({contentType:'text/html',body:await html()}));
 await page.goto('https://storage.test/a');
 expect(await page.evaluate(()=>(window as any).first)).toBe(failure==='getter'?null:'[]');
 expect(await page.evaluate(()=>{localStorage.setItem('unknown-json','{'); return [localStorage.getItem('unknown-json'), JSON.parse('[1]')[0]];})).toEqual(['{',1]);
 for(const invalid of ['{','{}','null','[1]']) {
 expect(await page.evaluate(value=>{localStorage.setItem('od-note-read:x',value);return localStorage.getItem('od-note-read:x');},invalid)).toBe('[]');
 }
 expect(await page.evaluate(()=>{localStorage.setItem('od-panels:x','[]');localStorage.setItem('od-theme','blue');localStorage.setItem('od-review-attempt:v1:x','{}');return [localStorage.getItem('od-panels:x'),localStorage.getItem('od-theme'),localStorage.getItem('od-review-attempt:v1:x')];})).toEqual(['{}','light',null]);
 expect(await page.evaluate(()=>{const record=JSON.stringify({version:'abc123',selected:'2',unsure:true});localStorage.setItem('od-review-attempt:v1:q1',record);return localStorage.getItem('od-review-attempt:v1:q1');})).toBe(JSON.stringify({version:'abc123',selected:'2',unsure:true}));
 await page.getByRole('button').click(); await expect(page.locator('output')).toBeVisible();
 expect(await page.evaluate(()=>{sessionStorage.setItem('x','y');return sessionStorage.getItem('x');})).toBe('y');
});
