import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { transformHtml } from '../../tools/content/transform.js';
import type { Catalog } from '../../src/content/model.js';
const docs = [
 { id:'doc-a', title:'시작 자료', url:'/content/c/노트/a.html', listed:true },
 { id:'doc-b', title:'연결된 설명', url:'/content/c/노트/연결 설명.html', listed:false },
 { id:'doc-missing', title:'누락 자료', url:'/content/c/missing.html', listed:true },
].map(d=>({...d,url:d.url.split('/').map(encodeURIComponent).join('/'),courseId:'c',groupId:'g',sourcePath:d.url,type:'note' as const}));
const catalog: Catalog = {version:1,courses:[{id:'c',name:'과목',repo:'fixture',semester:'2026-2'}],groups:[{id:'g',courseId:'c',title:'묶음',sourcePath:'notes',kind:'supplement',date:null,order:1}],documents:docs};
async function setup(page: import('@playwright/test').Page) {
 const bundle=await build({stdin:{contents:"import {installReaderBridge} from './src/compat/reader-bridge.ts';installReaderBridge(window.__STUDY_HUB__.document.id);",resolveDir:process.cwd()},bundle:true,format:'iife',write:false});
 await page.route('**/catalog.json',r=>r.fulfill({json:catalog}));
 await page.route('**/content/**',r=>{
  const path=decodeURIComponent(new URL(r.request().url()).pathname);
  const doc=docs.find(d=>decodeURIComponent(d.url)===path);
  if(!doc||doc.id==='doc-missing')return r.fulfill({status:404,body:'missing'});
  const content=doc.id==='doc-a' ? `<h1>A</h1><a href="연결%20설명.html#part">내부 링크</a><a href="#end">아래로</a><a href="연결%20설명.html" target="_blank">별도 열기</a><a href="https://example.com/">외부</a><a href="file.pdf">PDF</a><button onclick="location.href='연결%20설명.html#part'">스크립트 이동</button><button onclick="location.hash='end'">스크립트 앵커</button><div id="end">끝</div>` : `<h1>B</h1><div id="part">연결 부분</div><a href="a.html">시작으로</a>`;
  return r.fulfill({contentType:'text/html',body:transformHtml('<!doctype html>'+content,doc,bundle.outputFiles[0]!.text)});
 });
}
test('follows_internal_links and restores_route through refresh/back/forward',async({page})=>{
 await setup(page); await page.goto('/'); await page.getByRole('button',{name:/시작 자료/}).click();
 await expect(page).toHaveURL(/#\/read\/doc-a$/);
 await page.frameLocator('iframe').getByRole('link',{name:'내부 링크'}).click();
 await expect(page).toHaveURL(/doc-b\?anchor=part$/); await expect(page.getByRole('heading',{name:'연결된 설명'})).toBeVisible();
 await expect(page.locator('iframe')).toHaveAttribute('src',/연결|%EC%97%B0/);
 await page.reload(); await expect(page.frameLocator('iframe').getByRole('heading',{name:'B',exact:true})).toBeVisible();
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/); await expect(page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true})).toBeVisible();
 await page.goForward(); await expect(page).toHaveURL(/doc-b\?anchor=part$/);
 await page.getByRole('link',{name:'목록으로'}).click(); await expect(page).toHaveURL(/#\/catalog$/);
});
test('same_document and script navigation synchronize without reloading anchors',async({page})=>{
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true}).waitFor();
 await page.locator('iframe').evaluate((el:any)=>{el.contentWindow.marker=123;el.dataset.identity='native';});
 await page.frameLocator('iframe').getByRole('link',{name:'아래로',exact:true}).click();
 await expect(page).toHaveURL(/anchor=end$/); expect(await page.locator('iframe').evaluate((el:any)=>el.contentWindow.marker)).toBe(123);
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 await page.frameLocator('iframe').getByRole('button',{name:'스크립트 앵커'}).click(); await expect(page).toHaveURL(/anchor=end$/);
 await page.frameLocator('iframe').getByRole('button',{name:'스크립트 이동'}).click(); await expect(page).toHaveURL(/doc-b\?anchor=part$/);
 await expect(page.getByRole('heading',{name:'연결된 설명'})).toBeVisible();
 await expect(page.locator('iframe')).toHaveAttribute('data-identity','native');
 await expect(page.locator('iframe')).toHaveAttribute('title','연결된 설명');
 await page.goBack(); await expect(page).toHaveURL(/doc-a\?anchor=end$/);
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 await page.goForward(); await expect(page).toHaveURL(/doc-a\?anchor=end$/);
 await page.goForward(); await expect(page).toHaveURL(/doc-b\?anchor=part$/);
});
test('ignores_stale_frame and forged origin/source/url/id messages',async({page})=>{
 await setup(page); await page.goto('/#/read/doc-a'); await page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true}).waitFor();
 await page.evaluate(()=>{(window as any).oldFrame=document.querySelector('iframe')!.contentWindow;});
 await page.frameLocator('iframe').getByRole('link',{name:'내부 링크'}).click(); await expect(page).toHaveURL(/doc-b/);
 await page.frameLocator('iframe').getByRole('heading',{name:'B',exact:true}).waitFor();
 await page.evaluate(()=>{
 const source=document.querySelector('iframe')!.contentWindow;
 const data={type:'study-hub:navigate',documentId:'doc-b',url:location.origin+'/content/c/노트/a.html'};
 for(const event of [Object.defineProperty(new MessageEvent('message',{data,origin:location.origin}),'source',{value:(window as any).oldFrame}),new MessageEvent('message',{data,origin:location.origin,source:window}),new MessageEvent('message',{data,origin:'https://evil.invalid',source}),new MessageEvent('message',{data:{...data,documentId:'doc-a'},origin:location.origin,source}),new MessageEvent('message',{data:{...data,url:location.origin+'/unlisted.html'},origin:location.origin,source})])window.dispatchEvent(event);
 });
 await expect(page).toHaveURL(/doc-b\?anchor=part$/);
});
test('opens_external_documents and preserves new-tab/modifier intent with noopener',async({page})=>{
 await setup(page); await page.goto('/#/read/doc-a');
 for(const name of ['별도 열기','외부','PDF']) {
 const popup=page.waitForEvent('popup'); await page.frameLocator('iframe').getByRole('link',{name,exact:true}).click(); const child=await popup;
 expect(await child.evaluate(()=>window.opener===null)).toBe(true); await child.close(); await expect(page).toHaveURL(/doc-a$/);
 }
 const popup=page.context().waitForEvent('page'); await page.frameLocator('iframe').getByRole('link',{name:'내부 링크'}).click({modifiers:['ControlOrMeta']}); const child=await popup;
 expect(await child.evaluate(()=>window.opener===null)).toBe(true); await child.close(); await expect(page).toHaveURL(/doc-a$/);
});
for(const route of ['doc-nope','doc-missing','../bad'])test(`error recovery ${route}`,async({page})=>{
 await setup(page); await page.goto('/#/read/'+route); await expect(page.getByRole('alert')).toBeVisible(); await page.getByRole('link',{name:'목록으로'}).click(); await expect(page.getByRole('button',{name:/시작 자료/})).toBeVisible();
});

test('generated copies run the bundled bridge without route mocks',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:/합성 자료/}).first().click();
 await expect(page.frameLocator('iframe').getByRole('heading',{name:'합성 학습 자료'})).toBeVisible();
 await page.frameLocator('iframe').getByRole('link',{name:'합성 앵커'}).click();
 await expect(page).toHaveURL(/#\/read\/document-[a-f0-9]+\?anchor=section$/);
 await page.reload(); await expect(page.frameLocator('iframe').locator('#section')).toBeVisible();
});
test('catalog route restores filters and repeated selection adds no history',async({page})=>{
 await setup(page); await page.goto('/#/catalog?course=c&group=g&q='+encodeURIComponent('시작'));
 await expect(page.getByRole('searchbox')).toHaveValue('시작');
 await page.getByRole('button',{name:/시작 자료/}).click();
 await expect(page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true})).toBeVisible();
 const before=await page.evaluate(()=>history.length);
 await page.getByRole('button',{name:/시작 자료/}).click();
 await expect(page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>history.length)).toBe(before);
 await page.goBack(); await expect(page.getByRole('searchbox')).toHaveValue('시작');
});
