import { afterEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture } from './release-fixture.js';
import { inventory } from '../../tools/deploy/bootstrap.js';
import { releasePublic, verifyPublicDeployment } from '../../tools/deploy/public-release.js';
import type { BuildReport } from '../../tools/content/report.js';

const mocks = vi.hoisted(() => ({ readTarget: vi.fn(), readActive: vi.fn(), upload: vi.fn() }));
vi.mock('../../tools/deploy/worker-target.js', async original => ({
  ...await original<object>(), readWorkerTarget: mocks.readTarget, readActiveVersion: mocks.readActive,
}));
vi.mock('../../tools/deploy/wrangler-upload.js', async original => ({
  ...await original<object>(), runWranglerUpload: mocks.upload,
}));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const target = {
  accountId: 'a'.repeat(32), workerId: 'b'.repeat(32), workerName: 'ajou-study-hub' as const,
  productionUrl: 'https://ajou-study-hub.johnshin617.workers.dev', previewUrls: [],
};
const previous = '11111111-1111-1111-1111-111111111111';
const uploaded = '22222222-2222-2222-2222-222222222222';
const html = '<title>아주 학습 자료실</title><div id="app"></div>';
const catalog = '{"version":1,"courses":[],"groups":[],"documents":[]}';
const file = 'content/복습 노트/문제.pdf';
const fixtures: Record<string, { data: string | Uint8Array; type: string }> = {
  'index.html': { data: html, type: 'text/html; charset=utf-8' },
  'catalog.json': { data: catalog, type: 'application/json' },
  '404.html': { data: '<h1>Missing</h1>', type: 'text/html' },
  [file]: { data: '%PDF-1.7', type: 'application/pdf' },
  'content/그림.png': { data: Uint8Array.from([137, 80, 78, 71, 0, 255]), type: 'image/png' },
  'assets/app.js': { data: 'void 0', type: 'text/javascript' },
  'assets/app.css': { data: 'body {}', type: 'text/css' },
  'assets/font.woff2': { data: 'wOF2', type: 'font/woff2' },
  '_headers': { data: '/*', type: 'text/plain' },
  '_redirects': { data: '/ /index.html 302', type: 'text/plain' },
};
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const manifest: BuildReport = {
  createdAt: '', bundleHash: '', sources: [], inputs: [], issues: [],
  outputs: Object.entries(fixtures).map(([path, { data }]) => ({
    path, size: typeof data === 'string' ? Buffer.byteLength(data) : data.length, sha256: hash(data),
  })),
};

function anonymousRequest(mode = 'ok') {
  const paths: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    expect(url.origin).toBe(target.productionUrl);
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (url.pathname === '/') return new Response(null, {
      status: 302, headers: { location: mode === 'access' ? 'https://team.cloudflareaccess.com/login' : '/index.html' },
    });
    const path = decodeURIComponent(url.pathname.slice(1));
    if (path === 'index.html' && mode === 'login') return new Response('<title>Sign in</title>', { headers: { 'content-type': 'text/html' } });
    if (path === 'catalog.json' && mode === 'stale') return Response.json({ version: 1, documents: [] });
    if (path === file && mode === 'mime') return new Response('%PDF-1.7', { headers: { 'content-type': 'text/html' } });
    if (path === file && mode === 'hash') return new Response('%PDF-1.6', { headers: { 'content-type': 'application/pdf' } });
    if (path === file && mode === 'network' && paths.filter(p => p === url.pathname).length === 1)
      throw new TypeError('Network error');
    const row = fixtures[path];
    if (row) return new Response(Buffer.from(row.data as string), { headers: { 'content-type': row.type } });
    return new Response(fixtures['404.html']!.data as string, {
      status: mode === 'missing-status' ? 200 : 404, headers: { 'content-type': 'text/html' },
    });
  };
  return { paths, request };
}

test('verifies every HTTP-served asset, the root redirect and a missing page anonymously', async () => {
  const { paths, request } = anonymousRequest('network');
  expect(await verifyPublicDeployment(target.productionUrl, manifest, { fetch: request })).toEqual({ checked: 8 });
  expect(paths).toContain('/content/%EB%B3%B5%EC%8A%B5%20%EB%85%B8%ED%8A%B8/%EB%AC%B8%EC%A0%9C.pdf');
  expect(paths).not.toContain('/_headers');
  expect(paths).not.toContain('/_redirects');
  expect(paths).not.toContain('/404.html');
});

test.each(['access', 'login', 'mime', 'hash', 'stale', 'missing-status'])(
  'fails verification for %s', async mode => {
    await expect(verifyPublicDeployment(target.productionUrl, manifest, { fetch: anonymousRequest(mode).request }))
      .rejects.toThrow(/Public/);
  },
);

test('refuses a manifest with a missing required response', async () => {
  const incomplete = { ...manifest, outputs: manifest.outputs.filter(row => row.path !== 'catalog.json') };
  await expect(verifyPublicDeployment(target.productionUrl, incomplete, { fetch: anonymousRequest().request }))
    .rejects.toThrow(/catalog\.json/);
});

async function releaseFixture() {
  const f = await fixture();
  await f.put('.local/public-deployment.json', target);
  await f.put('dist/index.html', html);
  await f.put('dist/404.html', '<h1>Missing</h1>');
  const existingCatalog = JSON.parse(await readFile(resolve(f.root, 'dist/catalog.json'), 'utf8'));
  await f.put('dist/catalog.json', { ...existingCatalog, version: 1, courses: [], groups: [] });
  const outputs = await inventory(resolve(f.root, 'dist'));
  const bundleHash = hash(outputs.map(row => `${row.path}\0${row.sha256}\n`).join(''));
  await f.put('.reports/app-build.json', { ...f.manifest, outputs, bundleHash });
  await f.put('.reports/verification.json', {
    ...f.proof, bundleHash, catalogHash: outputs.find(row => row.path === 'catalog.json')!.sha256,
    integrityChecks: { ...f.proof.integrityChecks, outputCount: outputs.length },
  });
  vi.stubEnv('CLOUDFLARE_READ_TOKEN', 'test-read-token');
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-write-token');
  let active = previous;
  mocks.readTarget.mockResolvedValue({});
  mocks.readActive.mockImplementation(async () => active);
  mocks.upload.mockImplementation(async () => {
    active = uploaded;
    return { url: target.productionUrl, versionId: uploaded };
  });
  const preflight = anonymousRequest();
  vi.stubGlobal('fetch', (async (input, init) => {
    const path = decodeURIComponent(new URL(String(input)).pathname.slice(1));
    if (active === previous || path === '') return preflight.request(input, init);
    const row = outputs.find(row => row.path === path);
    const bytes = await readFile(resolve(f.root, 'dist', row?.path ?? '404.html'));
    const type = fixtures[path]?.type ?? 'text/html';
    return new Response(new Uint8Array(bytes), { status: row ? 200 : 404, headers: { 'content-type': type } });
  }) satisfies typeof fetch);
  return {
    ...f, bundleHash, outputs,
    run: () => releasePublic({ testProjectRoot: f.root, activationDelays: [] }),
    report: async () => JSON.parse(await readFile(resolve(f.root, '.reports/public-release.json'), 'utf8')),
  };
}

test('publishes the sealed bundle once and records the previous and confirmed versions', async () => {
  const f = await releaseFixture();
  await f.run();
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(await f.report()).toMatchObject({
    status: 'published-public-verified', previousVersionId: previous, versionId: uploaded,
    currentVersionId: uploaded, bundleHash: f.bundleHash, checked: f.outputs.length,
  });
  expect(JSON.stringify(await f.report())).not.toContain('test-read-token');
});

test.each(['upload', 'version', 'body'])('preserves the receipt on %s failure without uploading again', async mode => {
  const f = await releaseFixture();
  if (mode === 'upload') mocks.upload.mockRejectedValue(Error('untrusted provider details'));
  if (mode === 'version') mocks.upload.mockResolvedValue({ url: target.productionUrl, versionId: uploaded });
  if (mode === 'body') mocks.upload.mockImplementation(async () => {
    vi.stubGlobal('fetch', anonymousRequest('login').request);
    mocks.readActive.mockResolvedValue(uploaded);
    return { url: target.productionUrl, versionId: uploaded };
  });
  await expect(f.run()).rejects.toThrow();
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  const report = await f.report();
  expect(report).toMatchObject({
    status: mode === 'upload' ? 'upload-started-outcome-unknown' : 'uploaded-postcheck-pending',
    previousVersionId: previous, bundleHash: f.bundleHash,
  });
  expect(report.versionId).toBe(mode === 'upload' ? undefined : uploaded);
  expect(JSON.stringify(report)).not.toContain('untrusted provider details');
});

test('blocks upload if the pinned public Worker ID changes during staging', async () => {
  const f = await releaseFixture();
  mocks.readTarget.mockImplementationOnce(async () => {
    await f.put('.local/public-deployment.json', { ...target, workerId: 'c'.repeat(32) });
  });
  await expect(f.run()).rejects.toThrow(/settings changed/i);
  expect(mocks.upload).not.toHaveBeenCalled();
});

test('refuses a verified bundle whose source worktree is dirty', async () => {
  const f = await releaseFixture();
  await f.put('source/working-notes.txt', 'uncommitted content');
  const { inspectBoundSources } = await import('../../tools/source-binding.js');
  const { snapshot, binding } = await inspectBoundSources(f.root, '.local/sources.json');
  const manifest = JSON.parse(await readFile(resolve(f.root, '.reports/app-build.json'), 'utf8'));
  const proof = JSON.parse(await readFile(resolve(f.root, '.reports/verification.json'), 'utf8'));
  await f.put('.reports/app-build.json', { ...manifest, sources: snapshot.provenance });
  await f.put('.reports/verification.json', { ...proof, sources: snapshot.provenance, sourceBinding: binding });
  await expect(f.run()).rejects.toThrow(/clean pinned course/);
  expect(mocks.upload).not.toHaveBeenCalled();
});
