import { expect, test } from '@playwright/test';

test('keeps all course buttons in a scrollable single row at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '과목 필터' });
  const courses = nav.getByRole('button');
  await expect(courses).toHaveCount(6);
  const positions = await courses.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top));
  expect(new Set(positions).size).toBe(1);
  expect(await nav.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await courses.last().focus();
  await page.keyboard.press('Enter');
  await expect(courses.last()).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('opens a generated document in the current tab and restores the filter on Back', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox');
  await search.fill('합성 자료');
  const link = page.getByRole('link', { name: /합성 자료/ }).first();
  await expect(link).toHaveAttribute('href', /^\/content\//);
  await link.click();
  await expect(page).toHaveURL(/\/content\//);
  await expect(page.getByRole('heading', { name: '합성 학습 자료' })).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  await page.goBack();
  await expect(search).toHaveValue('합성 자료');
});
