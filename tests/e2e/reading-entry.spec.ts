import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { transformHtml } from '../../tools/content/transform.js';
import type { Catalog } from '../../src/content/model.js';
test.use({ viewport: { width: 390, height: 844 } });

const docs = Array.from({ length: 31 }, (_, i) => ({ id: 'entry-' + i, title: '학습 자료 ' + i, url: '/content/c/' + i + '.html', listed: i < 30, courseId: 'c', groupId: 'g', sourcePath: 'notes/' + i + '.html', type: 'note' as const }));
const catalog: Catalog = { version: 1, courses: [{ id: 'c', name: '과목', repo: 'synthetic', semester: '2026-2' }], groups: [{ id: 'g', courseId: 'c', title: '긴 자료 목록', sourcePath: 'notes', kind: 'supplement', date: null, order: 0 }], documents: docs };
const search = '?mode=review&item=one&item=two&value=a%2Bb%2F%ED%95%9C%EA%B8%80';
async function setup(page: Page) {
    const bundle = await build({ stdin: { contents: "import {installReaderBridge} from './src/compat/reader-bridge.ts';installReaderBridge(window.__STUDY_HUB__.document.id);", resolveDir: process.cwd() }, bundle: true, format: 'iife', write: false });
    await page.route('**/catalog.json', r => r.fulfill({ json: catalog }));
    await page.context().route(url => url.pathname.startsWith('/content/'), r => {
        const doc = docs.find(d => d.url === new URL(r.request().url()).pathname)!;
        return r.fulfill({ contentType: 'text/html', body: transformHtml('<!doctype html><h1>' + doc.title + '</h1><p>본문에는 별도 열기 링크가 없습니다.</p><div id="part">본문</div>', doc, bundle.outputFiles[0]!.text) });
    });
}
async function readingInViewport(page: Page) {
    await expect(page.getByRole('button', { name: '자료 목록 열기' })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.frameLocator('iframe').getByRole('heading')).toBeVisible();
    await expect.poll(async () => { const box = await page.locator('iframe').boundingBox(); return !!box && box.y >= 0 && box.y < page.viewportSize()!.height - 150; }).toBe(true);
}
test('mobile direct entry refresh and traversal keep the reader in the viewport with a long list', async ({ page }) => {
    await setup(page); await page.goto('/#/read/entry-0');
    await readingInViewport(page); await page.reload(); await readingInViewport(page);
    await page.getByRole('button', { name: '자료 목록 열기' }).click();
    await page.evaluate(() => dispatchEvent(new HashChangeEvent('hashchange')));
    await expect(page.getByRole('button', { name: '자료 목록 접기' })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: '정리노트 학습 자료 29', exact: true }).click(); await readingInViewport(page);
    await page.goBack(); await expect(page).toHaveURL(/read\/entry-0$/); await readingInViewport(page);
    await page.goForward(); await expect(page).toHaveURL(/read\/entry-29$/); await readingInViewport(page);
    await expect(page.locator('iframe')).toHaveCount(1);
});
test('app standalone action opens a document without original links with its opaque query and anchor', async ({ page }) => {
    await setup(page); const route = new URLSearchParams({ anchor: 'part', search });
    await page.goto('/#/read/entry-0?' + route.toString());
    await expect(page.frameLocator('iframe').getByRole('link')).toHaveCount(0);
    const link = page.getByRole('link', { name: '새 탭에서 열기', exact: true });
    await expect(link).toHaveAttribute('href', docs[0]!.url + search + '#part');
    await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', 'noopener');
    const opened = page.context().waitForEvent('page'); await link.click(); const child = await opened;
    await expect(child).toHaveURL(new RegExp('/content/c/0.html\\?')); expect(new URL(child.url()).search).toBe(search); expect(new URL(child.url()).hash).toBe('#part');
    expect(await child.evaluate(() => opener === null)).toBe(true); await child.close();
    await page.frameLocator('iframe').locator('body').evaluate(() => location.assign('/content/c/30.html?x=one&x=two#part'));
    await expect(link).toHaveAttribute('href', '/content/c/30.html?x=one&x=two#part');
    await expect(page.getByRole('heading', { name: '학습 자료 30', exact: true })).toBeVisible();
    await page.goto('/#/read/not-in-catalog'); await expect(link).toHaveCount(0);
});
test('a working reader has no unfinished implementation placeholder', async ({ page }) => {
    await setup(page); await page.goto('/#/read/entry-0');
    await expect(page.frameLocator('iframe').getByRole('heading')).toBeVisible();
    await expect(page.getByText('자료를 선택했습니다. 본문 보기는 다음 단계에서 연결됩니다.')).toHaveCount(0);
});
