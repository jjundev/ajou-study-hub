import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { bindCourseSource, resolveCourseRevision } from '../../tools/ci/course-source.js';
import { buildCourseWorker } from '../../tools/ci/course-build.js';

test('builds only the pinned course while a second course contains a broken reference', async () => {
  const project = await realpath(process.cwd());
  await mkdir(resolve(project, '.local'), { recursive: true });
  const fixture = await mkdtemp(resolve(project, '.local/course-build-'));
  const outputDir = resolve(project, '.generated', fixture.split(/[\\/]/).at(-1)!);
  const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    for (const id of ['life-science', 'ml-basics']) {
      const root = resolve(fixture, 'sources', id);
      const notes = resolve(root, '복습노트/1123');
      await mkdir(notes, { recursive: true });
      await writeFile(resolve(notes, '정리노트.html'), id === 'life-science' ? '<title>생명과학</title><h1>생명과학</h1>' : '<a href="missing.html">Missing</a>');
      git(root, 'init', '-q');
      git(root, 'add', '.');
      git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture');
      git(root, 'remote', 'add', 'origin', 'https://github.com/jjundev/ajou-' + id);
    }
    const app = resolve(fixture, 'app');
    await mkdir(app);
    const root = resolve(fixture, 'sources/life-science');
    const sha = git(root, 'rev-parse', 'HEAD');
    const requested: string[] = [];
    const revision = await resolveCourseRevision('life-science', async input => {
      requested.push(String(input));
      return Response.json({ ref: 'refs/heads/main', object: { sha, type: 'commit' } });
    }, 'fixture-token');
    expect(requested).toEqual(['https://api.github.com/repos/jjundev/ajou-life-science/git/ref/heads/main']);
    await expect(bindCourseSource(app, 'a'.repeat(40), { ...revision, root, repository: 'jjundev/ajou-ml-basics' })).rejects.toThrow();
    const snapshot = await bindCourseSource(app, 'a'.repeat(40), { ...revision, root });
    const result = await buildCourseWorker({ project: app, courseId: 'life-science', snapshot, outputDir, reportDir: resolve(project, '.reports', fixture.split(/[\\/]/).at(-1)!) });
    expect(result.catalog.courses.map(course => course.id)).toEqual(['life-science']);
    expect(result.catalog.documents).toHaveLength(1);
    const manifest = JSON.parse(await readFile(result.reportPath, 'utf8'));
    expect(manifest.outputs.map((file: { path: string }) => file.path)).toContain('_headers');
    expect(manifest.outputs.filter((file: { path: string }) => file.path.startsWith('content/')).every((file: { path: string }) => file.path.startsWith('content/life-science/'))).toBe(true);
    expect(manifest.sources.map((source: { courseId: string }) => source.courseId)).toEqual(['life-science']);
  } finally {
    await rm(fixture, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  }
}, 30_000);
