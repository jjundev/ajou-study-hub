import { expect, test } from '@playwright/test';
import type { Catalog, DocumentInfo } from '../../src/content/model.js';

const docs: DocumentInfo[] = Array.from({ length: 12 }, (_, index) => ({
  id: 'entry-' + index, courseId: 'c', groupId: 'group-' + index, title: '학습 자료 ' + index,
  sourcePath: 'notes/' + index + '.html', url: '/content/c/' + index + '.html', listed: true, type: 'note',
}));
const catalog: Catalog = {
  version: 1,
  courses: [{ id: 'c', name: '과목', repo: 'example/subject', semester: '2026-2' }],
  groups: docs.map((doc, index) => ({
    id: doc.groupId!, courseId: 'c', title: '수업 ' + index, sourcePath: 'notes/' + index,
    kind: 'date', date: '2026-11-' + String(index + 1).padStart(2, '0'), order: index,
  })),
  documents: docs,
};

test('Back restores filters, loaded rows and list scroll on mobile', async ({page}) => {
  await page.setViewportSize({width: 390, height: 700});
  await page.route('**/catalog.json', route => route.fulfill({json:catalog}));
  await page.route('**/content/c/*.html', route => route.fulfill({contentType: 'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><h1>원본 문서</h1>'}));
  await page.goto('/');
  await page.getByLabel('수업 정렬').selectOption('oldest');
  await page.getByLabel('자료 유형').selectOption('note');
  await page.getByRole('button', {name:'수업 더 보기'}).click();
  const link = page.getByRole('link', {name:/학습 자료 7/});
  await link.scrollIntoViewIfNeeded();
  const top = await page.evaluate(() => window.scrollY);
  expect(top).toBeGreaterThan(0);
  await link.click();
  await expect(page.getByRole('heading', {name:'원본 문서'})).toBeVisible();
  await page.goBack();
  await expect(link).toBeVisible();
  await expect(page.locator('#material-list article')).toHaveCount(8);
  await expect(page.getByLabel('수업 정렬')).toHaveValue('oldest');
  await expect(page.getByLabel('자료 유형')).toHaveValue('note');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(top);
  await page.getByRole('link', {name:'아주 학습 자료실 처음으로'}).click();
  await expect(page.getByRole('region', {name:'최근 열어본 자료'}).getByRole('link')).toHaveAttribute('href', '/content/c/7.html');
});
