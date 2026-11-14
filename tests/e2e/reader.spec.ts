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
const documentSearch = '?mode=review&item=one&item=two&value=a%2Bb%2F%ED%95%9C%EA%B8%80';
async function setup(page: import('@playwright/test').Page, beforeB?: () => Promise<void>, startup = '') {
 const bundle=await build({stdin:{contents:"import {installReaderBridge} from './src/compat/reader-bridge.ts';installReaderBridge(window.__STUDY_HUB__.document.id);",resolveDir:process.cwd()},bundle:true,format:'iife',write:false});
 await page.route('**/catalog.json',r=>r.fulfill({json:catalog}));
 await page.route(url=>url.pathname.startsWith('/content/'),async r=>{
  const path=decodeURIComponent(new URL(r.request().url()).pathname);
  const doc=docs.find(d=>decodeURIComponent(d.url)===path);
  if(!doc||doc.id==='doc-missing')return r.fulfill({status:404,body:'missing'});
  if (doc.id === 'doc-b') await beforeB?.();
  const content=doc.id==='doc-a' ? `<h1>A</h1><output id="screen"></output><button id="screen-next">다음 화면</button><button id="state-next">상태 화면</button><script>let screen=Number(location.hash.replace('#screen',''))||0;function renderScreen(i){screen=i;document.getElementById('screen').textContent='화면 '+i;}function nextScreen(withState){const i=screen+1;const url=i===0?location.pathname+location.search:'#screen'+i;history.pushState(withState?{screen:i,source:'original'}:null,'',url);renderScreen(i);}document.getElementById('screen-next').onclick=()=>nextScreen(false);document.getElementById('state-next').onclick=()=>nextScreen(true);addEventListener('popstate',()=>renderScreen(history.state?.screen??(Number(location.hash.replace('#screen',''))||0)));renderScreen(screen);</script><a href="연결%20설명.html${documentSearch}#part">쿼리 링크</a><button onclick="location.href='연결%20설명.html${documentSearch}#part'">쿼리 스크립트</button><a href="연결%20설명.html#part">내부 링크</a><a href="#end">아래로</a><a href="연결%20설명.html" target="_blank">별도 열기</a><a href="https://example.com/">외부</a><a href="file.pdf">PDF</a><button onclick="location.href='연결%20설명.html#part'">스크립트 이동</button><button onclick="location.hash='end'">스크립트 앵커</button><div id="end">끝</div>` : `<h1>B</h1><output id="mode"></output><script>const params=new URLSearchParams(location.search);document.getElementById('mode').textContent=params.get('mode')==='review'?'복습: '+params.getAll('item').join(',')+' / '+params.get('value'):'기본 본문';</script><a href="#after">다음 앵커</a><a href="?mode=plain#part">기본 모드</a><div id="after">다음 부분</div><div id="part">연결 부분</div><a href="a.html">시작으로</a>`;
  return r.fulfill({contentType:'text/html',body:transformHtml('<!doctype html>'+(doc.id==='doc-a'?startup:'')+content,doc,bundle.outputFiles[0]!.text)});
 });
}
test('follows_internal_links and restores_route through refresh/back/forward',async({page})=>{
 await setup(page); await page.goto('/'); await page.getByRole('button',{name:/시작 자료/}).click();
 await expect(page).toHaveURL(/#\/read\/doc-a$/);
 await page.frameLocator('iframe').getByRole('link',{name:'내부 링크'}).click();
 await expect(page).toHaveURL(/doc-b\?anchor=part$/); await expect(page.getByRole('heading',{name:'연결된 설명'})).toBeVisible();
 await expect(page.getByRole('link',{name:'새 탭에서 열기',exact:true})).toHaveAttribute('href',docs[1]!.url+'#part');
 await expect.poll(() => page.locator('iframe').evaluate((el:any) => el.contentWindow.location.pathname)).toContain('%EC%97%B0');
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
test('ignores stale document instances and forged origin/source/url/id/intent messages',async({page})=>{
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true}).waitFor();
 const old = await page.locator('iframe').evaluate((el:any) => ({
   instance:el.contentWindow.__studyHubReaderInstance, sourceUrl:el.contentWindow.location.href,
 }));
 await page.frameLocator('iframe').getByRole('link',{name:'내부 링크'}).click();
 await expect(page).toHaveURL(/doc-b\?anchor=part$/);
 await page.frameLocator('iframe').getByRole('heading',{name:'B',exact:true}).waitFor();
 const results = await page.evaluate(old => {
   const source = document.querySelector('iframe')!.contentWindow as Window & {__studyHubReaderInstance:string};
   const current = source.location.href;
   const data = {type:'study-hub:navigate',documentId:'doc-b',url:current.replace('#part','#after'),
     sourceUrl:current, instance:source.__studyHubReaderInstance,intent:'navigate'};
   const detached = document.createElement('iframe'); document.body.append(detached);
   const detachedSource = detached.contentWindow; detached.remove();
   const events = [
     {data:{...data,...old,documentId:'doc-a'}}, // The actual queued old-document payload.
     {data:{...data,instance:old.instance}}, // Same WindowProxy, wrong document instance only.
     {source:detachedSource}, {source:window}, {origin:'https://evil.invalid'},
     {data:{...data,documentId:'doc-a'}},
     {data:{...data,url:location.origin+'/unlisted.html'}},
     {data:{...data,sourceUrl:old.sourceUrl}},
     {data:{...data,intent:'sync'}}, {data:{...data,intent:'unknown'}},
   ];
   return events.map(overrides => {
     const init = {data,origin:location.origin,source,...overrides};
     // WebKit rejects detached WindowProxy in the constructor.
     const event = Object.defineProperty(new MessageEvent('message',{data:init.data,origin:init.origin}),
       'source',{value:init.source});
     window.dispatchEvent(event);
     // A wrongly accepted same-document destination changes the child URL synchronously.
     return source.location.href === current;
   });
 },old);
 expect(results).toEqual(Array(10).fill(true));
 await expect(page).toHaveURL(/doc-b\?anchor=part$/);
 // Counterfactual: the same destination with every field valid must be accepted.
 await page.locator('iframe').evaluate((el:any) => {
   const child=el.contentWindow;
   window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:child,data:{
     type:'study-hub:navigate',documentId:'doc-b',url:child.location.href.replace('#part','#after'),
     sourceUrl:child.location.href,instance:child.__studyHubReaderInstance,intent:'navigate',
   }}));
 });
 await expect(page).toHaveURL(/doc-b\?anchor=after$/);
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

for (const native of [false, true]) test(`document query fidelity ${native ? 'native' : 'click'}`, async ({ page }) => {
 await setup(page);
 await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('heading', {name:'A',exact:true}).waitFor();
 await page.locator('iframe').evaluate(el => (el as HTMLElement).dataset.identity='original');
 if (native) await page.frameLocator('iframe').getByRole('button', {name:'쿼리 스크립트'}).click();
 else await page.frameLocator('iframe').getByRole('link', {name:'쿼리 링크'}).click();
 const review = page.frameLocator('iframe').locator('#mode');
 await expect(review).toHaveText('복습: one,two / a+b/한글');
 const routeSearch = () => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('search'));
 await expect.poll(routeSearch).toBe(documentSearch);
 if (native) await expect(page.locator('iframe')).toHaveAttribute('data-identity','original');
 await page.locator('iframe').evaluate((el:any) => el.contentWindow.marker='query');
 await page.frameLocator('iframe').getByRole('link', {name:'다음 앵커'}).click();
 await expect(page).toHaveURL(/anchor=after/);
 await expect.poll(routeSearch).toBe(documentSearch);
 expect(await page.locator('iframe').evaluate((el:any) => el.contentWindow.marker)).toBe('query');
 await page.goBack(); await expect(page).toHaveURL(/anchor=part/);
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 await page.goForward(); await expect(review).toHaveText('복습: one,two / a+b/한글');
 await expect.poll(routeSearch).toBe(documentSearch);
 await page.goForward(); await expect(page).toHaveURL(/anchor=after/);
 await expect(review).toHaveText('복습: one,two / a+b/한글');
 await page.goBack(); await expect(page).toHaveURL(/anchor=part/);
 await page.reload(); await expect(review).toHaveText('복습: one,two / a+b/한글');
 await expect.poll(routeSearch).toBe(documentSearch);
 await page.frameLocator('iframe').getByRole('link', {name:'기본 모드'}).click();
 await expect(review).toHaveText('기본 본문');
 await expect.poll(routeSearch).toBe('?mode=plain');
 await page.goBack(); await expect(review).toHaveText('복습: one,two / a+b/한글');
 await expect.poll(routeSearch).toBe(documentSearch);
});

test('native query document then bridge cross-document traversal keeps history', async ({page}) => {
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true}).waitFor();
 await page.locator('iframe').evaluate(el => (el as HTMLElement).dataset.identity='native-chain');
 await page.frameLocator('iframe').getByRole('button',{name:'쿼리 스크립트'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.frameLocator('iframe').getByRole('link',{name:'시작으로'}).click();
 await expect(page).toHaveURL(/doc-a$/);
 await expect(page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true})).toBeVisible();
 await page.goBack();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await expect(page).toHaveURL(/doc-b\?anchor=part/);
 await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('search'))).toBe(documentSearch);
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 await expect(page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true})).toBeVisible();
 await page.goForward(); await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.goForward(); await expect(page).toHaveURL(/doc-a$/);
 await expect(page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true})).toBeVisible();
});

test('native query history survives explicit catalog selection', async ({page}) => {
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('button',{name:'쿼리 스크립트'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.frameLocator('iframe').getByRole('link',{name:'다음 앵커'}).click();
 await expect(page).toHaveURL(/anchor=after/);
 await page.getByRole('button',{name:/시작 자료/}).click();
 await expect(page).toHaveURL(/doc-a$/);
 await expect(page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true})).toBeVisible();
 await page.goBack(); await expect(page).toHaveURL(/doc-b\?anchor=after/);
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.goBack(); await expect(page).toHaveURL(/doc-b\?anchor=part/);
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 await page.goForward(); await expect(page).toHaveURL(/doc-b\?anchor=part/);
 await page.goForward(); await expect(page).toHaveURL(/doc-b\?anchor=after/);
 await page.goForward(); await expect(page).toHaveURL(/doc-a$/);
});

test('native query history survives catalog return and filtered reselection', async ({page}) => {
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('button',{name:'쿼리 스크립트'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.frameLocator('iframe').getByRole('link',{name:'다음 앵커'}).click();
 await expect(page).toHaveURL(/anchor=after/);
 await page.getByRole('link',{name:'목록으로'}).click();
 await expect(page).toHaveURL(/#\/catalog$/);
 await page.getByRole('searchbox').fill('시작');
 await expect(page).toHaveURL(/#\/catalog\?q=/);
 await page.getByRole('button',{name:/시작 자료/}).click();
 await expect(page).toHaveURL(/doc-a$/);
 await page.goBack(); await expect(page).toHaveURL(/#\/catalog\?q=/);
 await expect(page.getByRole('searchbox')).toHaveValue('시작');
 await page.goBack(); await expect(page).toHaveURL(/#\/catalog$/);
 await expect(page.getByRole('searchbox')).toHaveValue('');
 await page.goBack(); await expect(page).toHaveURL(/doc-b\?anchor=after/);
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.goBack(); await expect(page).toHaveURL(/doc-b\?anchor=part/);
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 await page.goForward(); await expect(page).toHaveURL(/doc-b\?anchor=part/);
 await page.goForward(); await expect(page).toHaveURL(/doc-b\?anchor=after/);
 await page.goForward(); await expect(page).toHaveURL(/#\/catalog$/);
 await page.goForward(); await expect(page).toHaveURL(/#\/catalog\?q=/);
 await page.goForward(); await expect(page).toHaveURL(/doc-a$/);
});


test('new selection cancels an older preflight completion', async ({page}) => {
 let release!: () => void, started!: () => void;
 const gate = new Promise<void>(resolve => {release=resolve;});
 const waiting = new Promise<void>(resolve => {started=resolve;});
 await setup(page, async () => {started(); await gate;});
 await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('link',{name:'내부 링크'}).click();
 await waiting;
 await page.getByRole('button',{name:/시작 자료/}).click();
 const response = page.waitForResponse(r => decodeURIComponent(new URL(r.url()).pathname).endsWith('연결 설명.html'));
 release(); await response;
 await page.frameLocator('iframe').getByRole('link',{name:'아래로',exact:true}).click();
 await expect(page).toHaveURL(/doc-a\?anchor=end$/);
 await expect(page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true})).toBeVisible();
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
});

test('catalog entries preserve original document history state', async ({page}) => {
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true}).waitFor();
 await page.locator('iframe').evaluate((el:any) => el.contentWindow.history.replaceState({lesson:'original',score:[1,2]},''));
 await page.getByRole('link',{name:'목록으로'}).click();
 await expect(page).toHaveURL(/#\/catalog$/);
 expect(await page.locator('iframe').evaluate((el:any) => el.contentWindow.history.state.lesson)).toBe('original');
 await page.getByRole('button',{name:/시작 자료/}).click();
 await expect(page).toHaveURL(/doc-a$/);
 expect(await page.locator('iframe').evaluate((el:any) => el.contentWindow.history.state)).toEqual({lesson:'original',score:[1,2]});
 await page.goBack(); await expect(page).toHaveURL(/#\/catalog$/);
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 expect(await page.locator('iframe').evaluate((el:any) => el.contentWindow.history.state)).toEqual({lesson:'original',score:[1,2]});
 await page.goForward(); await expect(page).toHaveURL(/#\/catalog$/);
 await page.goForward(); await expect(page).toHaveURL(/doc-a$/);
});


test('refresh preserves earlier native query and catalog history', async ({page}) => {
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('button',{name:'쿼리 스크립트'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.frameLocator('iframe').getByRole('link',{name:'다음 앵커'}).click();
 await expect(page).toHaveURL(/anchor=after/);
 await page.getByRole('link',{name:'목록으로'}).click();
 await expect(page).toHaveURL(/#\/catalog$/);
 await page.reload();
 await expect(page.getByRole('heading',{name:'오늘 공부할 자료를 선택하세요'})).toBeVisible();
 await page.goBack(); await expect(page).toHaveURL(/doc-b\?anchor=after/);
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.goBack(); await expect(page).toHaveURL(/doc-b\?anchor=part/);
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 await page.goForward(); await expect(page).toHaveURL(/doc-b\?anchor=part/);
 await page.goForward(); await expect(page).toHaveURL(/doc-b\?anchor=after/);
 await page.goForward(); await expect(page).toHaveURL(/#\/catalog$/);
});

test('native assign adds one route and native replace replaces that route', async ({page}) => {
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true}).waitFor();
 const before = await page.evaluate(() => history.length);
 await page.frameLocator('iframe').getByRole('button',{name:'쿼리 스크립트'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 expect(await page.evaluate(() => history.length)).toBe(before+1);
 await page.frameLocator('iframe').locator('#mode').evaluate(() => location.replace('?mode=plain#part'));
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('기본 본문');
 await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('search'))).toBe('?mode=plain');
 expect(await page.evaluate(() => history.length)).toBe(before+1);
 await page.reload(); await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('기본 본문');
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 await expect(page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true})).toBeVisible();
 await page.goForward(); await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('기본 본문');
});

test('approved native replacement is exact and consumed once', async ({page}) => {
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true}).waitFor();
 await page.evaluate(() => {
   const host = (window as any).__studyHubReader;
   const consume = host.consume;
   (window as any).authorizationChecks = [];
   host.consume = (source:Window,instance:string,from:string,url:string,kind:string) => {
     if (kind !== 'replace') return consume(source,instance,from,url,kind);
     const checks = [
       consume(window,instance,from,url,kind),
       consume(source,'stale-instance',from,url,kind),
       consume(source,instance,from+'#stale',url,kind),
       consume(source,instance,from,url+'-wrong-target',kind),
       consume(source,instance,from,url,'push'),
     ];
     const accepted = consume(source,instance,from,url,kind);
     checks.push(accepted,consume(source,instance,from,url,kind));
     (window as any).authorizationChecks.push(checks);
     return accepted;
   };
 });
 await page.frameLocator('iframe').getByRole('button',{name:'쿼리 스크립트'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 expect(await page.evaluate(() => (window as any).authorizationChecks)).toEqual([[false,false,false,false,false,true,false]]);
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
});

test('bridge clicks and native URL sync remain available without Navigation API', async ({page}) => {
 await page.addInitScript(() => Object.defineProperty(window,'navigation',{value:undefined}));
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('link',{name:'쿼리 링크'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 await page.frameLocator('iframe').getByRole('button',{name:'쿼리 스크립트'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('search'))).toBe(documentSearch);
});


for (const withState of [false,true]) test(`source screen pushState restores rendering and state ${withState}`, async ({page}) => {
 await setup(page); await page.goto('/#/read/doc-a');
 const screen=page.frameLocator('iframe').locator('#screen');
 await expect(screen).toHaveText('화면 0');
 const before=await page.evaluate(()=>history.length);
 // Two synchronous source pushes must each remain traversable, even though the
 // current child hash has advanced by the time the first message is delivered.
 await page.frameLocator('iframe').locator(withState?'#state-next':'#screen-next').evaluate((el:any)=>{el.click();el.click();});
 await expect(screen).toHaveText('화면 2');
 await expect(page).toHaveURL(/anchor=screen2$/);
 expect(await page.evaluate(()=>history.length)).toBe(before+2);
 await page.reload(); await expect(screen).toHaveText('화면 2');
 await page.goBack(); await expect(screen).toHaveText('화면 1');
 expect(await screen.evaluate(()=>history.state)).toEqual(withState?{screen:1,source:'original'}:null);
 await page.goBack(); await expect(screen).toHaveText('화면 0');
 expect(await screen.evaluate(()=>history.state)).toBe(null);
 await page.goForward(); await expect(screen).toHaveText('화면 1');
 await page.goForward(); await expect(screen).toHaveText('화면 2');
 expect(await screen.evaluate(()=>history.state)).toEqual(withState?{screen:2,source:'original'}:null);
 await page.frameLocator('iframe').getByRole('link',{name:'쿼리 링크'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.goBack(); await expect(screen).toHaveText('화면 2');
 expect(await screen.evaluate(()=>history.state)).toEqual(withState?{screen:2,source:'original'}:null);
});

test('source replaceState remains synchronous and serialization failures remain native', async ({page}) => {
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true}).waitFor();
 const before=await page.evaluate(()=>history.length);
 const result=await page.frameLocator('iframe').locator('#screen').evaluate(()=>{
   history.replaceState({screen:4,source:'replace'},'', '#screen4');
   const immediate={hash:location.hash,state:history.state};
   let error='';
   try {history.pushState(()=>{},'', '#invalid');} catch(e) {error=(e as DOMException).name;}
   return {immediate,error,after:{hash:location.hash,state:history.state}};
 });
 expect(result).toEqual({immediate:{hash:'#screen4',state:{screen:4,source:'replace'}},error:'DataCloneError',after:{hash:'#screen4',state:{screen:4,source:'replace'}}});
 await expect(page).toHaveURL(/anchor=screen4$/);
 expect(await page.evaluate(()=>history.length)).toBe(before);
 await page.reload(); await expect(page.frameLocator('iframe').locator('#screen')).toHaveText('화면 4');
 expect(await page.frameLocator('iframe').locator('#screen').evaluate(()=>history.state)).toEqual({screen:4,source:'replace'});
});


test('a child sync cannot overwrite a traversed route before its handler runs', async ({page}) => {
 await page.addInitScript(() => {
   if (window !== top) return;
   addEventListener('popstate', () => {
     const child = document.querySelector('iframe')?.contentWindow as any;
     if (!child?.__studyHubReaderInstance) return;
     const id=child.location.pathname.endsWith('/a.html')?'doc-a':'doc-b';
     if (location.hash.startsWith('#/read/'+id)) return;
     (window as any).injectedSync=((window as any).injectedSync??0)+1;
     // Browser traversal has committed the parent URL, but its app listener has
     // not run yet. Deliver the otherwise-valid old-document sync at this boundary.
     const committedRoute=location.hash;
     window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:child,data:{
       type:'study-hub:navigate',documentId:id,url:child.location.href,sourceUrl:child.location.href,
       instance:child.__studyHubReaderInstance,intent:'sync',
     }}));
     if (location.hash!==committedRoute) (window as any).overwrittenRoute=true;
   },{capture:true});
 });
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('link',{name:'쿼리 링크'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.goBack(); await expect(page).toHaveURL(/doc-a$/);
 await page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true}).waitFor();
 await page.goForward(); await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 expect(await page.evaluate(()=>(window as any).injectedSync)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>(window as any).overwrittenRoute??false)).toBe(false);
});

for (const intent of ['navigate','history'] as const) test(`a stale child ${intent} cannot replace a traversed route or its forward branch`, async ({page}) => {
 await page.addInitScript(intent => {
   if (window !== top) return;
   addEventListener('popstate', () => {
     const child=document.querySelector('iframe')?.contentWindow as any;
     if (location.hash!=='#/read/doc-a' || !child?.__studyHubReaderInstance || child.location.pathname.endsWith('/a.html')) return;
     const committed=location.hash;
     const previousUrl=child.location.href;
     const previousState=child.history.state;
     const destination=new URL(previousUrl); destination.hash='after';
     let data:any={type:'study-hub:navigate',documentId:'doc-b',url:destination.href,
       sourceUrl:previousUrl,instance:child.__studyHubReaderInstance,intent,history:'push'};
     if (intent==='history') {
       // Commit through the actual source wrapper, then deliver its valid ordered
       // payload at the boundary before the queued postMessage would normally run.
       child.history.pushState({late:true},'',destination.href);
       data={...data,sourceUrl:child.location.href,sequence:child.__studyHubReaderHistory.sequence,
         state:child.history.state,previousUrl,previousState};
     }
     window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:child,data}));
     (window as any).staleIntentProbe={committed,after:location.hash};
   },{capture:true});
 },intent);
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').getByRole('link',{name:'쿼리 링크'}).click();
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.goBack();
 expect(await page.evaluate(()=>(window as any).staleIntentProbe)).toEqual({committed:'#/read/doc-a',after:'#/read/doc-a'});
 await expect(page).toHaveURL(/doc-a$/);
 await expect(page.frameLocator('iframe').getByRole('heading',{name:'A',exact:true})).toBeVisible();
 await page.goForward();
 await expect(page).toHaveURL(/doc-b\?anchor=part/);
 await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
});

test('stale navigation cannot replace a traversed entry with the same route', async ({page}) => {
 await page.addInitScript(() => {
   if (window!==top) return;
   addEventListener('popstate',()=>{
     const child=document.querySelector('iframe')?.contentWindow as any;
     if (location.hash!=='#/read/doc-a' || history.state?.studyHub?.state?.screen===1 || !child?.__studyHubReaderInstance) return;
     const entry=history.state.studyHub.entryId;
     const destination=new URL(child.location.href); destination.hash='end';
     window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:child,data:{
       type:'study-hub:navigate',documentId:'doc-a',url:destination.href,sourceUrl:child.location.href,
       instance:child.__studyHubReaderInstance,intent:'navigate',history:'push',
     }}));
     (window as any).sameRouteProbe={route:location.hash,sameEntry:history.state.studyHub.entryId===entry};
   },{capture:true});
 });
 await setup(page); await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').locator('#screen').evaluate(()=>history.pushState({screen:1},'',location.href));
 await expect.poll(()=>page.evaluate(()=>history.state?.studyHub?.state?.screen)).toBe(1);
 await page.goBack();
 expect(await page.evaluate(()=>(window as any).sameRouteProbe)).toEqual({route:'#/read/doc-a',sameEntry:true});
 await page.goForward();
 await expect.poll(()=>page.frameLocator('iframe').locator('#screen').evaluate(()=>history.state)).toEqual({screen:1});
 await expect(page).toHaveURL(/doc-a$/);
});


for (const transition of ['refresh','return'] as const) test(`restored startup pushes drain before saved URL and state ${transition}`, async ({page}) => {
 await setup(page,undefined,`<script>if(sessionStorage.getItem('reader-startup')==='yes'){history.pushState({startup:1},'', '#one');history.pushState({startup:2},'', '#two');}</script>`);
 await page.goto('/#/read/doc-a');
 await page.frameLocator('iframe').locator('#screen').evaluate(()=>{
   history.replaceState({screen:7,saved:true},'', '#saved');
   sessionStorage.setItem('reader-startup','yes');
 });
 await expect(page).toHaveURL(/doc-a\?anchor=saved$/);
 if (transition==='return') {
   await page.frameLocator('iframe').getByRole('link',{name:'쿼리 링크'}).click();
   await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 }
 const entries=await page.evaluate(()=>history.length);
 if (transition==='refresh') await page.reload();
 else await page.goBack();
 await expect(page.frameLocator('iframe').locator('#screen')).toHaveText('화면 7');
 expect(await page.frameLocator('iframe').locator('#screen').evaluate(()=>({hash:location.hash,state:history.state})))
   .toEqual({hash:'#saved',state:{screen:7,saved:true}});
 await expect(page).toHaveURL(/doc-a\?anchor=saved$/);
 await expect(page.getByText('자료를 불러오는 중입니다…',{exact:true})).not.toBeVisible();
 expect(await page.evaluate(()=>history.length)).toBe(entries);
 if (transition==='return') {
   await page.goForward();
   await expect(page.frameLocator('iframe').locator('#mode')).toHaveText('복습: one,two / a+b/한글');
   await page.goBack();
   await expect(page.frameLocator('iframe').locator('#screen')).toHaveText('화면 7');
 }
 await page.frameLocator('iframe').getByRole('button',{name:'상태 화면'}).click();
 await expect(page.frameLocator('iframe').locator('#screen')).toHaveText('화면 8');
 await expect(page).toHaveURL(/doc-a\?anchor=screen8$/);
 expect(await page.evaluate(()=>history.length)).toBe(entries+(transition==='refresh'?1:0));
 await page.goBack();
 await expect(page.frameLocator('iframe').locator('#screen')).toHaveText('화면 7');
 await page.goForward();
 await expect(page.frameLocator('iframe').locator('#screen')).toHaveText('화면 8');
});
