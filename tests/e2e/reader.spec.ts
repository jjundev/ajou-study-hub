import { test, expect } from '@playwright/test';
import type { Catalog } from '../../src/content/model.js';
const docs = [
 { id:'doc-a', title:'시작 자료', url:'/content/c/노트/a.html', listed:true },
 { id:'doc-b', title:'연결된 설명', url:'/content/c/노트/연결 설명.html', listed:false },
 { id:'doc-missing', title:'누락 자료', url:'/content/c/missing.html', listed:true },
].map(d=>({...d,url:d.url.split('/').map(encodeURIComponent).join('/'),courseId:'c',groupId:'g',sourcePath:d.url,type:'note' as const}));
const catalog: Catalog = {version:1,courses:[{id:'c',name:'과목',repo:'fixture',semester:'2026-2'}],groups:[{id:'g',courseId:'c',title:'묶음',sourcePath:'notes',kind:'supplement',date:null,order:1}],documents:docs};
const documentSearch = '?mode=review&item=one&item=two&value=a%2Bb%2F%ED%95%9C%EA%B8%80';
async function setup(page: import('@playwright/test').Page) {
 await page.route('**/catalog.json',r=>r.fulfill({json:catalog}));
 await page.route(url=>url.pathname.startsWith('/content/'),async r=>{
  const path=decodeURIComponent(new URL(r.request().url()).pathname);
  const doc=docs.find(d=>decodeURIComponent(d.url)===path);
  if(!doc||doc.id==='doc-missing')return r.fulfill({status:404,body:'missing'});
  const content=doc.id==='doc-a' ? `<h1>A</h1><output id="screen"></output><button id="screen-next">다음 화면</button><button id="state-next">상태 화면</button><script>let screen=Number(location.hash.replace('#screen',''))||0;function renderScreen(i){screen=i;document.getElementById('screen').textContent='화면 '+i;}function nextScreen(withState){const i=screen+1;const url=i===0?location.pathname+location.search:'#screen'+i;history.pushState(withState?{screen:i,source:'original'}:null,'',url);renderScreen(i);}document.getElementById('screen-next').onclick=()=>nextScreen(false);document.getElementById('state-next').onclick=()=>nextScreen(true);addEventListener('popstate',()=>renderScreen(history.state?.screen??(Number(location.hash.replace('#screen',''))||0)));renderScreen(screen);</script><a href="연결%20설명.html${documentSearch}#part">쿼리 링크</a><button onclick="location.href='연결%20설명.html${documentSearch}#part'">쿼리 스크립트</button><a href="연결%20설명.html#part">내부 링크</a><a href="#end">아래로</a><a href="연결%20설명.html" target="_blank">별도 열기</a><a href="https://example.com/">외부</a><a href="file.pdf">PDF</a><button onclick="location.href='연결%20설명.html#part'">스크립트 이동</button><button onclick="location.hash='end'">스크립트 앵커</button><div id="end">끝</div>` : `<h1>B</h1><output id="mode"></output><script>const params=new URLSearchParams(location.search);document.getElementById('mode').textContent=params.get('mode')==='review'?'복습: '+params.getAll('item').join(',')+' / '+params.get('value'):'기본 본문';</script><a href="#after">다음 앵커</a><a href="?mode=plain#part">기본 모드</a><div id="after">다음 부분</div><div id="part">연결 부분</div><a href="a.html">시작으로</a>`;
  return r.fulfill({contentType: 'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8">' + content});
 });
}

test('saved routes retain the exact document path, query and anchor', async ({page}) => {
 await setup(page);
 const saved = new URLSearchParams({search: documentSearch, anchor: 'part'});
 await page.goto('/#/read/doc-b?' + saved);
 await expect(page.getByRole('heading', {name:'B'})).toBeVisible();
 expect(new URL(page.url()).pathname).toBe(docs[1]!.url);
 expect(new URL(page.url()).search).toBe(documentSearch);
 expect(new URL(page.url()).hash).toBe('#part');
 await page.reload();
 await expect(page.locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await expect(page.locator('iframe')).toHaveCount(0);
});

test('document links use native browser history for queries, anchors and unlisted documents', async ({page}) => {
 await setup(page);
 await page.goto('/#/catalog?course=c&group=g&q=시작');
 const search = page.getByRole('searchbox');
 await expect(search).toHaveValue('시작');
 await expect(page.locator('#material-list a[data-document="doc-b"]')).toHaveCount(0);
 await page.getByRole('link', {name:/시작 자료/}).click();
 await expect(page).toHaveURL(url => url.pathname === docs[0]!.url);
 await page.getByRole('link', {name:'쿼리 링크'}).click();
 await expect(page.locator('#mode')).toHaveText('복습: one,two / a+b/한글');
 await page.getByRole('link', {name:'다음 앵커'}).click();
 await expect(page).toHaveURL(/#after$/);
 await page.goBack();
 await expect(page).toHaveURL(/#part$/);
 await page.goBack();
 await expect(page.getByRole('heading', {name:'A'})).toBeVisible();
 await page.goBack();
 await expect(search).toHaveValue('시작');
 await page.goForward();
 await expect(page.getByRole('heading', {name:'A'})).toBeVisible();
});

test('source pushState and reload restore the source screen and history state', async ({page}) => {
 await setup(page);
 await page.goto('/#/read/doc-a');
 await page.locator('#screen-next').click();
 await page.locator('#state-next').click();
 await expect(page.locator('#screen')).toHaveText('화면 2');
 expect(await page.evaluate(() => history.state)).toEqual({screen:2,source:'original'});
 await page.goBack();
 await expect(page.locator('#screen')).toHaveText('화면 1');
 await page.goForward();
 await expect(page.locator('#screen')).toHaveText('화면 2');
 await page.reload();
 await expect(page.locator('#screen')).toHaveText('화면 2');
 expect(await page.evaluate(() => history.state)).toEqual({screen:2,source:'original'});
});

test('unknown legacy IDs have a way back to the catalog', async ({page}) => {
 await setup(page);
 await page.goto('/#/read/unknown');
 await expect(page.getByRole('alert')).toContainText('자료를 찾을 수 없습니다');
 await page.getByRole('button', {name:'목록으로 돌아가기'}).click();
 await expect(page).toHaveURL(/#\/catalog$/);
 await expect(page.getByRole('alert')).toBeHidden();
 await expect(page.getByRole('link', {name:/시작 자료/})).toBeVisible();
});

test('a saved read hash entered while browsing resolves in the same tab', async ({page}) => {
 await setup(page);
 await page.goto('/#/catalog');
 await expect(page.getByRole('link', {name:/시작 자료/})).toBeVisible();
 await page.evaluate(() => { location.hash = '#/read/doc-b?anchor=part'; });
 await expect(page.getByRole('heading', {name:'B'})).toBeVisible();
 expect(new URL(page.url()).pathname).toBe(docs[1]!.url);
 expect(new URL(page.url()).hash).toBe('#part');
 await page.goBack();
 await expect(page.getByRole('link', {name:/시작 자료/})).toBeVisible();
});
