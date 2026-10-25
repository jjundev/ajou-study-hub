import { test, expect } from '@playwright/test';
import { buildBootstrap } from '../../tools/deploy/bootstrap.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
let server: ChildProcess;
let origin: string;
test.setTimeout(90000);
test.beforeAll(async ({}, info) => {
  const result = await buildBootstrap(resolve('.generated/bootstrap-tests', randomUUID()));
  const port = 18780 + info.workerIndex;
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--assets', result.directory, '--persist-to', resolve('.generated/bootstrap-tests', randomUUID())], {stdio:'pipe', env:{...process.env, WRANGLER_SEND_METRICS:'false'}});
  let logs = ''; server.stdout?.on('data', d=>logs+=d); server.stderr?.on('data', d=>logs+=d);
  await expect.poll(async()=>{ if(server.exitCode!==null) throw Error(logs); try{return (await fetch(origin+'/index.html')).status;}catch{return 0;} },{timeout:60000}).toBe(200);
});
test.afterAll(async()=>{server?.kill(); if(server && server.exitCode===null) await new Promise<void>(r=>server.once('exit',()=>r()));});
test('serves_exact_html_and_hidden_paths with MIME/private cache', async ({ request }) => {
  const root = await request.get(origin+'/', {maxRedirects:0}); expect(root.status()).toBe(302); expect(root.headers().location).toBe('/index.html');
  for (const [path, mime, marker] of [
    ['/index.html','text/html','app'],
    ['/catalog.json','application/json','documents'],
    ['/content/test/한글 공백.html','text/html','SYNTHETIC_HTML'],
    ['/content/test/.pack/nested.html','text/html','SYNTHETIC_PACK'],
    ['/content/test/.assets/x.png','image/png',''],
    ['/content/test/sentinel.pdf','application/pdf','%PDF'],
    ['/content/test/.assets/sentinel.woff2','font/woff2',''],
  ]) {
    const response = await request.get(origin+path!); expect(response.status(),path).toBe(200);
    expect(response.headers()['content-type'],path).toContain(mime!);
    expect(response.headers()['cache-control'],path).toBe('private, no-store');
    if(marker) expect(await response.text()).toContain(marker);
  }
});
test('missing_is_404 without SPA fallback or sensitive files', async ({ request }) => {
  for(const path of ['/missing.pdf','/missing.html','/content/test/한글 공백','/anything/route','/_headers','/_redirects','/.local/sources.json','/.git/config','/.reports/app-build.json','/src/main.ts']) {
    const response = await request.get(origin+path); expect(response.status(),path).toBe(404);
    expect(await response.text()).toContain('자료를 찾을 수 없습니다');
    expect(await response.text()).not.toContain('SYNTHETIC_HTML');
  }
});
test('empty app and 404 link open catalog', async ({page})=>{
  await page.goto(origin+'/index.html');
  await expect(page.getByRole('heading', {name:'등록된 자료가 없습니다'})).toBeVisible();
  await page.goto(origin+'/missing.html');
  await page.getByRole('link',{name:'목록으로'}).click();
  await expect(page).toHaveURL(origin+'/index.html#/catalog');
});
