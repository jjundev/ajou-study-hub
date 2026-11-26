import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { courses } from '../../config/courses.js';
import { deriveStaticWorkerBaseline, type VerifiedPublicBaseline } from '../../tools/deploy/static-worker-baseline.js';
import { createHubWorkerConfig } from '../../tools/deploy/hub-worker-release.js';
import { finishAppBuild } from '../../tools/app-build.js';
import type { BuildReport } from '../../tools/content/report.js';

test('seeds every course from one verified bundle and keeps the all-profile hub UI-only', async () => {
  await mkdir('.generated', { recursive: true });
  const workspace = await mkdtemp(resolve('.generated/baseline-test-'));
  try {
    const directory = resolve(workspace, 'original');
    await mkdir(resolve(directory, 'assets'), { recursive: true });
    await writeFile(resolve(directory, 'assets/index.js'), '// App');
    await writeFile(resolve(directory, 'index.html'), '<title>Study Hub</title>');
    const catalog = { version: 1, courses: courses.map(({ id, name, repo, semester }) => ({ id, name, repo, semester })), groups: [], documents: [] };
    await writeFile(resolve(directory, 'catalog.json'), JSON.stringify(catalog));
    for (const course of courses) {
      await mkdir(resolve(directory, 'content', course.id), { recursive: true });
      await writeFile(resolve(directory, 'content', course.id, '노트 1.html'), course.name);
    }
    const provenance: BuildReport['sources'] = courses.map(({ id }) => ({ courseId: id, commit: 'a'.repeat(40), dirty: false, trackedPaths: [], explicitUntracked: [] }));
    const manifest = await finishAppBuild(directory, { createdAt: '', bundleHash: '', sources: provenance, inputs: [], outputs: [], issues: [] });
    const receipt = {
      appSha: 'b'.repeat(40), versionId: '00000000-0000-0000-0000-000000000001',
      bundleHash: manifest.bundleHash, catalogHash: manifest.outputs.find(file => file.path === 'catalog.json')!.sha256,
      sourceShas: Object.fromEntries(provenance.map(source => [source.courseId, source.commit])),
    } as VerifiedPublicBaseline;
    const all = await deriveStaticWorkerBaseline({ bundleDir: directory, manifest, receipt, profile: 'all', outputRoot: resolve(workspace, 'all') });
    expect(all.courses.map(({ courseId }) => courseId)).toEqual(courses.map(({ id }) => id));
    expect(all.hub.manifest.outputs.filter(({ path }) => path.startsWith('content/'))).toEqual([]);
    expect(createHubWorkerConfig('pilot', './assets').assets.run_worker_first)
      .toEqual(['/catalog.json', '/_study-hub/routing.json', '/content/life-science/*']);
    await expect(deriveStaticWorkerBaseline({
      bundleDir: directory, manifest, receipt: { ...receipt, catalogHash: '0'.repeat(64) }, profile: 'pilot', outputRoot: resolve(workspace, 'invalid'),
    })).rejects.toThrow('Baseline release identity mismatch');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
