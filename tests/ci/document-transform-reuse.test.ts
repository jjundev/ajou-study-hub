import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { buildTransformCandidate } from '../../tools/ci/observe-document-transforms.js';
import { buildContent } from '../../tools/content/build.js';
import { documentTransformKey } from '../../tools/content/document-transform-key.js';
import { createPublicTransformRestore, parseTransformIndex, summarizeTransformObservation } from '../../tools/ci/document-transform-reuse.js';
import type { BuildReport } from '../../tools/content/report.js';
import { createSourceFixture } from '../fixtures/source.js';

const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const appSha = 'a'.repeat(40);
const path = 'content/circuits-2/복습노트/1024/확인 문제.html';
const key = sha('previous key');
const bytes = '<title>공개</title>';
const index = { schema: 1 as const, appSha, bundleHash: sha('previous build'), entries: [{ key, sha256: sha(bytes), size: Buffer.byteLength(bytes) }] };

test('keys include the exact HTML injection and normalized output path', () => {
  const args = { appSha, path, kind: 'html' as const, sourceHash: sha('source'), injectionHash: sha('injection') };
  const original = documentTransformKey(args);
  expect(documentTransformKey({ ...args, path: path.normalize('NFD') })).toBe(original);
  for (const update of [{ sourceHash: sha('edit') }, { path: path + '2' }, { appSha: 'b'.repeat(40) }, { injectionHash: sha('new title or bootstrap') }]) {
    expect(documentTransformKey({ ...args, ...update })).not.toBe(original);
  }
});

test('accepts only a bounded previous index with unique keys and a matching identity', () => {
  expect(parseTransformIndex(JSON.stringify(index), appSha, index.bundleHash)).toEqual(index);
  expect(() => parseTransformIndex(JSON.stringify(index), appSha, sha('another bundle'))).toThrow();
  for (const entries of [[...index.entries, ...index.entries], [{ ...index.entries[0], size: 26 * 1024 ** 2 }]]) {
    expect(() => parseTransformIndex(JSON.stringify({ ...index, entries }), appSha, index.bundleHash)).toThrow();
  }
});

test('restores only previous keys with identical public bytes and never follows redirects', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const restore = createPublicTransformRestore('https://example.test', index, { fetch });
  const miss = { path: path + '2', key: sha('new') };
  const restored = await restore.restore([{ path, key }, miss]);
  expect(restored).toEqual(new Map([[path, Buffer.from(bytes)]]));
  expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('%ED%99%95%EC%9D%B8%20'), expect.objectContaining({
    credentials: 'omit', redirect: 'error',
  }));
  expect(restore.metrics).toMatchObject({ hits: 1, misses: 1, rejected: 0, restoredBytes: Buffer.byteLength(bytes) });
});

test('falls back per file for corrupt bytes, redirects, and failed requests', async () => {
  const options = [
    new Response(bytes.replace('공개', '비공'), { headers: { 'content-type': 'text/html' } }),
    new Response(null, { status: 302, headers: { location: 'https://other.test/file' } }),
    new Response(null, { status: 404 }),
    new Response(bytes + 'overflow', { headers: { 'content-type': 'text/html' } }),
  ];
  for (const response of options) {
    const restore = createPublicTransformRestore('https://example.test', index, { fetch: async () => response });
    expect(await restore.restore([{ path, key }])).toEqual(new Map());
    expect(restore.metrics).toMatchObject({ hits: 0, rejected: 1, restoredBytes: 0 });
  }
});

test('separates actual publication time from the estimate and rejects a differing bundle inventory', () => {
  const baseline: BuildReport = {
    createdAt: 'baseline', bundleHash: sha('bundle'), sources: [], inputs: [], issues: [],
    outputs: [{ path: 'catalog.json', sha256: sha('catalog'), size: 7 }],
  };
  const timing = { dispatchAt: 1000, jobStartedAt: 2000, buildStartedAt: 3000, buildFinishedAt: 5000, publishedAt: 10000, candidateBuildMs: 600, indexFetchMs: 200 };
  const metrics = { hits: 1, misses: 0, rejected: 0, restoredBytes: 100, restoreMs: 100 };
  const summary = summarizeTransformObservation(baseline, { ...baseline, createdAt: 'candidate' }, timing, metrics);
  expect(summary).toMatchObject({ status: 'match', actualDeploymentMs: 9000, queueMs: 1000, candidateTotalMs: 800, projectedDeploymentMs: 7800, savingsMs: 1200 });
  expect(summarizeTransformObservation(baseline, { ...baseline, outputs: [] }, timing, metrics)).toMatchObject({ status: 'mismatch', projectedDeploymentMs: null });
  expect(summarizeTransformObservation(baseline, baseline, timing, { ...metrics, hits: 0 })).toMatchObject({ status: 'no-reuse', projectedDeploymentMs: null });
});

test('joins reused bytes and current assets into the same app bundle after edits, deletion, and rename', async () => {
  const generated = resolve('.generated');
  const reports = resolve('.reports');
  await mkdir(generated, { recursive: true });
  await mkdir(reports, { recursive: true });
  const prior = await mkdtemp(resolve(generated, 'document-transform-observe-prior-'));
  const baseline = await mkdtemp(resolve(generated, 'document-transform-observe-baseline-'));
  const candidate = await mkdtemp(resolve(generated, 'document-transform-observe-candidate-'));
  const reportDir = await mkdtemp(resolve(reports, 'document-transform-observe-test-'));
  const fixture = await createSourceFixture();
  try {
    const keep = '복습노트/1024/그대로.html';
    const edit = '복습노트/1024/수정.html';
    const deleted = '복습노트/1024/삭제.html';
    const renamed = '복습노트/1024/새 이름.html';
    const css = '복습노트/1024/style.css';
    const retiredCssAsset = '복습노트/1024/old.png';
    const currentCssAsset = '복습노트/1024/new.png';
    const outputPath = (relative: string) => `content/${fixture.config.id}/${relative}`;
    await fixture.write(keep, '<title>그대로</title><link rel="stylesheet" href="style.css">');
    await fixture.write(edit, '<title>이전 제목</title>');
    await fixture.write(deleted, '<title>이름 변경</title>');
    await fixture.write(css, 'body{background:url(old.png)}');
    await fixture.write(retiredCssAsset, 'old');
    await fixture.write(currentCssAsset, 'new');
    await fixture.track();
    const args = { settings: fixture.settings, configs: [fixture.config] };
    const seed = await buildContent({
      ...args, outputDir: resolve(prior, 'content'), reportDir: resolve(reportDir, 'prior'),
      documentTransforms: { appSha },
    });
    expect(seed.documentTransforms).toHaveLength(4);
    await fixture.write(edit, '<title>새 제목</title>');
    await unlink(resolve(fixture.root, deleted));
    await fixture.write(renamed, '<title>이름 변경</title>');
    await fixture.write(css, 'body{background:url(new.png)}');
    await fixture.track();
    const restore = createPublicTransformRestore('https://example.test', {
      schema: 1, appSha, bundleHash: seed.bundleHash, entries: seed.documentTransforms!,
    }, {
      fetch: async input => {
        const requested = decodeURIComponent(new URL(String(input)).pathname.slice(1));
        expect(requested).toBe(outputPath(keep));
        return new Response(await readFile(resolve(seed.outputDir, requested)), { headers: { 'content-type': 'text/html' } });
      },
    });
    const full = await buildTransformCandidate({
      ...args, outputDir: resolve(baseline, 'content'), reportDir: resolve(reportDir, 'baseline'),
    }, resolve(baseline, 'dist'));
    const partial = await buildTransformCandidate({
      ...args, outputDir: resolve(candidate, 'content'), reportDir: resolve(reportDir, 'candidate'),
      documentTransforms: { appSha, restore: restore.restore },
    }, resolve(candidate, 'dist'));
    expect(restore.metrics).toMatchObject({ hits: 1, misses: 3, rejected: 0 });
    expect(partial.bundleHash).toBe(full.bundleHash);
    expect(partial.outputs).toEqual(full.outputs);
    expect(partial.inputs).toEqual(full.inputs);
    expect(partial.issues).toEqual(full.issues);
    expect(partial.outputs.map(file => file.path)).toContain(outputPath(currentCssAsset));
    expect(partial.outputs.map(file => file.path)).toContain(outputPath(renamed));
    expect(partial.outputs.map(file => file.path)).not.toContain(outputPath(deleted));
    expect(partial.outputs.map(file => file.path)).not.toContain(outputPath(retiredCssAsset));
    await expect(buildTransformCandidate({
      ...args, outputDir: resolve(candidate, 'content'), reportDir: resolve(reportDir, 'candidate'),
    }, resolve('dist'))).rejects.toThrow('CI_DOCUMENT_TRANSFORM_OBSERVATION_UNAVAILABLE');
  } finally {
    await fixture.dispose();
    for (const [directory, parent] of [[prior, generated], [baseline, generated], [candidate, generated], [reportDir, reports]] as const) {
      if (dirname(directory) !== parent || await realpath(directory) !== directory) throw Error('Unsafe fixture cleanup');
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 45000);
