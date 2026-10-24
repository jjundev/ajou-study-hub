import { test, expect } from '@playwright/test';
import type { Catalog, MaterialType } from '../../src/content/model.js';

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
for (const width of [390, 1440]) test.describe(`responsive_catalog ${width}`, () => {
 test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });
 test('browses_courses', async ({ page }) => {
  await open(page);
  for (const name of names) await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(page.getByRole('heading', { name: '실험01' })).toBeVisible();
  await expect(page.getByText('정리노트', { exact: true })).toHaveCount(2);
  for (const label of ['문제설명', '인터랙티브', '기타 자료']) await expect(page.getByText(label, { exact: true })).toHaveCount(1);
  await expect(page.getByText('자료 5개', { exact: true })).toBeVisible();
  await expect(page.locator('[data-material-type=review]')).toHaveCount(0);
  if (process.env.CATALOG_SCREENSHOTS) await page.screenshot({ path: `.reports/task-5-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: /생명과학.*1/ }).click();
  await expect(page.getByRole('heading', { name: '10월 12일' })).toBeVisible();
  await page.getByRole('button', { name: /생명과학 정리노트/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '생명과학 정리노트' })).toBeVisible();
  if (width === 390) {
    await expect(page.getByRole('button', { name: '자료 목록 열기' })).toHaveAttribute('aria-expanded', 'false');
    if (process.env.CATALOG_SCREENSHOTS) await page.screenshot({ path: '.reports/task-5-390-collapsed.png', fullPage: true });
    await page.getByRole('button', { name: '자료 목록 열기' }).click();
    await expect(page.getByRole('button', { name: '자료 목록 접기' })).toHaveAttribute('aria-expanded', 'true');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 });
});
test('searches_metadata_only and empty states', async ({ page }) => {
  await open(page);
  const search = page.getByRole('searchbox', { name: '자료 검색' });
  for (const query of ['2026-10-12', '실험01', '전자회로2 정리노트']) {
    await search.fill(query);
    await expect(page.getByRole('button', { name: /정리노트/ }).first()).toBeVisible();
  }
  await search.fill('본문전용검색어');
  await expect(page.getByText('검색 결과가 없습니다')).toBeVisible();
  await page.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('heading', { name: '실험01' })).toBeVisible();
});
test('empty_and_error_states retry malformed and failed catalog', async ({ page }) => {
  let requests = 0;
  await page.route('**/catalog.json', route => ++requests === 1 ? route.fulfill({ status: 500 }) : requests === 2 ? route.fulfill({ json: { version: 1, courses: [{}], groups: [], documents: [] } }) : route.fulfill({ json: catalog }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('자료 목록을 불러오지 못했습니다');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('heading', { name: '실험01' })).toBeVisible();
});
test('generated fixture catalog is served by Vite without route mocks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('자료 5개', { exact: true })).toBeVisible();
  for (const name of names) await expect(page.getByRole('button', { name: `${name} 1`, exact: true })).toBeVisible();
  const response = await page.request.get('/catalog.json');
  const built = await response.json() as Catalog;
  const original = await page.request.get(built.documents[0]!.url);
  expect(original.ok()).toBe(true);
  expect(await original.text()).toContain('합성');
});
test('browse restoration is silent and selection/destroy expose the integration contract', async ({ page }) => {
  await open(page);
  const events = await page.evaluate(async catalog => {
    const modulePath = '/src/app/catalog-view.ts';
    const { mountCatalog } = await import(modulePath);
    const root = document.createElement('div'); document.body.replaceChildren(root);
    const browses: unknown[] = [], selections: string[] = [];
    const view = mountCatalog(root, catalog, (id: string) => selections.push(id), (state: unknown) => browses.push(state));
    view.setBrowseState({ courseId: 'c1', groupId: 'g1', query: '2026-10-12' });
    const countAfterRestore = browses.length;
    view.setSelection('d1');
    const title = root.querySelector('main h2')?.textContent;
    (root.querySelector('.material-button') as HTMLButtonElement).click();
    (root.querySelector('.group-button') as HTMLButtonElement).click();
    view.destroy();
    return { countAfterRestore, title, selections, browses, remaining: root.childElementCount };
  }, catalog);
  expect(events.countAfterRestore).toBe(0);
  expect(events.title).toBe('생명과학 정리노트');
  expect(events.selections).toEqual(['d1']);
  expect(events.browses).toHaveLength(1);
  expect(events.remaining).toBe(0);
});
