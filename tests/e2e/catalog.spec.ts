import { test, expect } from '@playwright/test';
import type { Catalog, MaterialType } from '../../src/content/model.js';
import { readFile } from 'node:fs/promises';

const names = ['논리회로실험', '생명과학', '전자회로2', '자료구조', '기계학습기초'];
const catalog: Catalog = {
  version: 1,
  courses: names.map((name, i) => ({ id: `c${i}`, name, repo: 'fixture', semester: '2026-2' })),
  groups: names.map((_, i) => ({ id: `g${i}`, courseId: `c${i}`, title: i === 0 ? '실험01' : '10월 12일', sourcePath: 'fixture', kind: i === 0 ? 'experiment' : 'date', date: i === 0 ? null : '2026-10-12', order: i })),
  documents: names.flatMap((name, i) => [
    { id: `d${i}`, courseId: `c${i}`, groupId: `g${i}`, title: `${name} 정리노트`, type: (['note', 'note', 'explanation', 'interactive', 'other'] as MaterialType[])[i]!, sourcePath: 'fixture', url: `/content/${i}.html`, listed: true },
    { id: `hidden${i}`, courseId: `c${i}`, groupId: `g${i}`, title: '본문전용검색어', type: 'other' as const, sourcePath: 'hidden', url: `/content/hidden${i}.html`, listed: false },
  ]),
};
async function open(page: import('@playwright/test').Page) {
  await page.route('**/catalog.json', route => route.fulfill({ json: catalog }));
  await page.goto('/');
}
test('searches catalog metadata and excludes linked-only content', async ({ page }) => {
  await open(page);
  const search = page.getByRole('searchbox', { name: '자료 검색' });
  for (const query of ['2026-10-12', '실험01', '정리노트 전자회로2']) {
    await search.fill(query);
    await expect(page.getByRole('link', { name: /정리노트/ }).first()).toBeVisible();
  }
  await search.fill('본문전용검색어');
  await expect(page.getByText('찾는 자료가 없어요')).toBeVisible();
  await page.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('heading', {name: '모든 수업'})).toBeVisible();
  await expect(page.getByRole('button', {name: '수업 더 보기'})).toBeVisible();
});

test('supports Korean composition and displays the repository for a selected course', async ({ page }) => {
  await open(page);
  await page.getByRole('button', {name: '생명과학', exact:true}).click();
  await expect(page.locator('#course-repository')).toHaveText('fixture');
  await expect(page.locator('#course-repository')).toBeVisible();
  const search = page.getByRole('searchbox');
  await search.focus();
  const whileComposing = await search.evaluate((input: HTMLInputElement) => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '생명과학 정리노트';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    const heading = document.querySelector('#list-heading')?.textContent;
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    return heading;
  });
  expect(whileComposing).toBe('생명과학');
  await expect(page.getByRole('heading', {name:'검색 결과'})).toBeVisible();
  await expect(page.locator('#course-repository')).toBeHidden();
});

test('empty_and_error_states retry malformed and failed catalog', async ({ page }) => {
  let requests = 0;
  await page.route('**/catalog.json', route => ++requests === 1 ? route.fulfill({ status: 500 }) : requests === 2 ? route.fulfill({ json: { version: 1, courses: [{}], groups: [], documents: [] } }) : route.fulfill({ json: catalog }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('자료 목록을 불러오지 못했습니다');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('heading', { name: '모든 수업' })).toBeVisible();
  await expect(page.locator('#material-list a')).toHaveCount(4);
});
test('generated fixture catalog is served by Vite without route mocks', async ({ page }) => {
  await page.goto('/');
  for (const name of names) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  const response = await page.request.get('/catalog.json');
  const built = await response.json() as Catalog;
  const original = await page.request.get(built.documents[0]!.url);
  expect(original.ok()).toBe(true);
  expect(await original.text()).toContain('합성');
});

test('downloads the review sheet without leaving the lesson list', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/');

  const search = page.getByRole('searchbox');
  await search.fill('기계학습기초');
  const review = page.getByRole('link', { name: /복습문제 · 열기$/ });
  const pdf = page.getByRole('link', { name: /복습문제 PDF 다운로드$/ });
  await expect(review).toHaveAttribute('href', /^\/content\/ml-basics\/.*\.html$/);
  await expect(pdf).toHaveAttribute('href', /^\/content\/ml-basics\/.*\/\.pack\/.*\.pdf$/);
  const before = page.url();
  const [download] = await Promise.all([page.waitForEvent('download'), pdf.click()]);
  expect(download.suggestedFilename().normalize('NFC')).toBe('복습문제_1001_트리 순회-문제.pdf');
  expect(await readFile((await download.path())!, 'utf8')).toBe('%PDF-1.4\nfixture\n');
  await expect(page).toHaveURL(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect(await page.evaluate(() => localStorage.getItem('study-hub:recent:v1'))).toBeNull();

  await search.fill('전자회로2 복습문제');
  await page.locator('#type-filter').selectOption('review');
  await expect(review).toHaveCount(0);
  await expect(pdf).toBeVisible();
  await search.fill('논리회로실험');
  await expect(pdf).toHaveCount(0);
});

test('displays and searches an automatic description unless a manual description exists', async ({ page }) => {
  const copy: Catalog = {
    version: 1,
    courses: [{id: 'data-structures', name: '자료구조', repo: 'fixture', semester: '2026-2'}],
    groups: [
      {id: 'g1105', courseId: 'data-structures', kind: 'date', date: '2026-11-05', sourcePath: '복습노트/1105', order: 1, title: '자동 제목', description: '탐색과 삽입 · 삭제와 시간복잡도'},
      {id: 'g1109', courseId: 'data-structures', kind: 'date', date: '2026-11-09', sourcePath: '복습노트/1109', order: 0, title: '자동 제목', description: '덮어쓸 자동 소개'},
    ],
    documents: ['1105', '1109'].map(day => ({id: `d${day}`, courseId: 'data-structures', groupId: `g${day}`, type: 'note', title: '정리노트', sourcePath: `복습노트/${day}/정리노트.html`, url: `/content/${day}.html`, listed: true})),
  };
  await page.route('**/catalog.json', route => route.fulfill({ json: copy }));
  await page.goto('/');
  const tree = page.locator('article').filter({ has: page.getByRole('heading', { name: '이진 탐색 트리', exact: true }) });
  await expect(tree.getByText('탐색과 삽입 · 삭제와 시간복잡도', { exact: true })).toBeVisible();
  await expect(page.getByText('우선순위 큐란 · 우선순위 큐 ADT와 최소·최대', { exact: true })).toBeVisible();
  await expect(page.getByText('덮어쓸 자동 소개')).toHaveCount(0);
  await page.getByRole('searchbox').fill('시간복잡도');
  await expect(page.locator('#material-list article')).toHaveCount(1);
  await expect(tree).toBeVisible();
});

for (const malformed of ['duplicate course', 'duplicate group', 'duplicate document', 'cross-course group']) test(`rejects ${malformed} and retries`, async ({ page }) => {
  const invalid = structuredClone(catalog);
  if (malformed === 'duplicate course') invalid.courses.push(invalid.courses[0]!);
  if (malformed === 'duplicate group') invalid.groups.push(invalid.groups[0]!);
  if (malformed === 'duplicate document') invalid.documents.push(invalid.documents[0]!);
  if (malformed === 'cross-course group') invalid.documents[0]!.groupId = invalid.groups[1]!.id;
  let retry = false;
  await page.route('**/catalog.json', route => { const value = retry ? catalog : invalid; retry = true; return route.fulfill({ json: value }); });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('자료 목록을 불러오지 못했습니다');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('heading', { name: '모든 수업' })).toBeVisible();
  await expect(page.locator('#material-list a')).toHaveCount(4);
});
test('displays check and comic material type labels for 확인문제 and 학습만화', async ({ page }) => {
  const withTypes = structuredClone(catalog);
  withTypes.documents.push(
    {
      id: 'd-check',
      courseId: 'c3',
      groupId: 'g3',
      title: '자료구조 확인문제',
      type: 'check',
      sourcePath: '복습노트/1102/확인문제_1102_Tree.html',
      url: '/content/check.html',
      listed: true,
    },
    {
      id: 'd-comic',
      courseId: 'c1',
      groupId: 'g1',
      title: '생명과학 1112 학습만화',
      type: 'comic',
      sourcePath: '복습노트/1112/학습만화_1112_Nervous_and_Sensory_Systems.html',
      url: '/content/comic.html',
      listed: true,
    },
  );
  await page.route('**/catalog.json', route => route.fulfill({ json: withTypes }));
  await page.goto('/');
  const type = page.getByLabel('자료 유형');
  for (const [value, label] of [['check','확인문제'],['comic','학습만화']] as const) {
    await type.selectOption(value);
    await expect(page.locator('#material-list a')).toHaveCount(1);
    await expect(page.locator('#material-list a')).toHaveText(label);
  }
});
