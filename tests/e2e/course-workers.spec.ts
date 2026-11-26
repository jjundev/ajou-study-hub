import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { bundleProfiledWorker } from '../../tools/deploy/profiled-wrangler.js';
import { courses } from '../../config/courses.js';
import { boundCourseIds, courseIds, type CourseId } from '../../config/course-workers.js';
import { contentUrl } from '../../src/content/model.js';
import { createHubWorkerConfig } from '../../tools/deploy/hub-worker-release.js';
import { createCourseWorkerConfig } from '../../tools/deploy/course-worker-release.js';

const file = '한글 공백.pdf';
const pdf = '%PDF-1.4\n';
const control = { version: 1, groups: [], documents: [] };
const courseMetadata = courses.map(({ id, name, repo, semester }) => ({ id, name, repo, semester }));
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');

test('serves an independent life science rollout, then independently routes all five courses', async ({ request }, info) => {
  test.setTimeout(120_000);
  await mkdir('.generated', { recursive: true });
  const root = await mkdtemp(resolve('.generated/course-workers-e2e-'));
  const activeChildren = new Set<ChildProcess>();
  let generation = 0;

  const stop = async (child: ChildProcess) => {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(done => { child.once('exit', () => done()); child.kill(); });
    }
    activeChildren.delete(child);
  };

  async function start(profile: 'pilot' | 'all', versions: Partial<Record<CourseId, number>>) {
    const stage = resolve(root, String(generation++));
    await mkdir(stage);
    const hubAssets = resolve(stage, 'hub-assets');
    const bound = boundCourseIds(profile);
    const unbound = courseMetadata.filter(course => !bound.includes(course.id as CourseId));
    await mkdir(hubAssets);
    await writeFile(resolve(hubAssets, 'index.html'), '<title>Hub</title><h1>Study Hub</h1>');
    await writeFile(resolve(hubAssets, 'catalog.json'), JSON.stringify({ ...control, courses: unbound }));
    for (const course of unbound) {
      const dir = resolve(hubAssets, 'content', course.id);
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, file), pdf + 'legacy');
    }
    const configs: string[] = [];
    const addConfig = async (path: string, config: object, entry: 'hub' | 'course-assets') => {
      await mkdir(path);
      await bundleProfiledWorker(process.cwd(), entry, resolve(path, 'worker.mjs'));
      const file = resolve(path, 'wrangler.json');
      await writeFile(file, JSON.stringify(config));
      configs.push(file);
    };
    await addConfig(resolve(stage, 'hub'), createHubWorkerConfig(profile, hubAssets), 'hub');
    for (const id of bound) {
      const assets = resolve(stage, id + '-assets');
      const dir = resolve(assets, 'content', id);
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, file), pdf + (versions[id] ?? 1));
      await writeFile(resolve(assets, 'catalog.json'), JSON.stringify({ ...control, courses: courseMetadata.filter(course => course.id === id) }));
      await addConfig(resolve(stage, id), createCourseWorkerConfig(id, assets), 'course-assets');
    }
    const port = 18800 + info.workerIndex * 10 + generation;
    const origin = 'http://127.0.0.1:' + port;
    const child = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', String(port),
      ...configs.flatMap(config => ['--config', config]), '--persist-to', resolve(stage, 'state')],
      { cwd: stage, stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    activeChildren.add(child);
    let logs = '';
    child.stdout?.on('data', data => logs += data);
    child.stderr?.on('data', data => logs += data);
    await expect.poll(async () => {
      if (child.exitCode !== null) throw Error(logs);
      try { return (await fetch(origin + '/_study-hub/routing.json')).status; } catch { return 0; }
    }, { timeout: 25_000 }).toBe(200);
    return { origin, stop: () => stop(child) };
  }

  async function verify(origin: string, profile: 'pilot' | 'all', versions: Partial<Record<CourseId, number>>) {
    const routing = await (await request.get(origin + '/_study-hub/routing.json')).json();
    expect(routing).toEqual({ schema: 1, profile, courseIds: boundCourseIds(profile) });
    const catalogResponse = await request.get(origin + '/catalog.json');
    const catalog = await catalogResponse.json();
    expect(catalog.courses.map((course: { id: string }) => course.id)).toEqual(courseIds);
    expect(catalogResponse.headers()['cache-control']).toBe('private, no-store');
    for (const id of courseIds) {
      const response = await request.get(origin + contentUrl(id, file) + '?download=1', { headers: { Range: 'bytes=0-4' } });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('application/pdf');
      const expected = boundCourseIds(profile).includes(id) ? String(versions[id] ?? 1) : 'legacy';
      expect(await response.text()).toBe(pdf + expected);
    }
    expect((await request.get(origin + '/content/life-science/missing.pdf')).status()).toBe(404);
    expect((await request.get(origin + '/content/unregistered/missing.pdf')).status()).toBe(404);
  }

  try {
    const pilot = await start('pilot', { 'life-science': 2 });
    await verify(pilot.origin, 'pilot', { 'life-science': 2 });
    await pilot.stop();
    for (const courseId of courseIds) {
      const versions = { [courseId]: 2 };
      const all = await start('all', versions);
      await verify(all.origin, 'all', versions);
      await all.stop();
    }
  } finally {
    await Promise.all([...activeChildren].map(stop));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
