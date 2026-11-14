import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import { courses } from '../../config/courses.js';
import { fingerprintPublicInputDetails } from '../../tools/ci/public-input-fingerprint.js';
import type { SourceSnapshot } from '../../tools/ci/sources.js';

const exec = promisify(execFile);
const fixtureTimeout = process.platform === 'win32' ? 180_000 : 60_000;
const git = async (cwd: string, ...args: string[]) =>
  (await exec('git', ['-c', 'core.autocrlf=false', ...args], { cwd })).stdout.trim();
const commit = async (cwd: string, message: string) => {
  await git(cwd, 'add', '-A');
  await git(cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
};

let scratch: string | undefined;
afterEach(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });

async function fixture() {
  const rootDir = scratch = await realpath(await mkdtemp(join(tmpdir(), 'hub-public-input-')));
  const project = join(rootDir, 'app');
  await mkdir(project);
  await git(project, 'init');
  await writeFile(join(project, 'index.html'), '<main></main>');
  const snapshot: SourceSnapshot = {
    version: 1, appSha: await commit(project, 'hub'), revisions: [],
    inputFingerprint: 'a'.repeat(64), settingsPath: join(project, '.local', 'ci-sources.json'),
  };
  snapshot.revisions = await Promise.all(courses.map(async course => {
    const root = join(rootDir, 'sources', course.id);
    await mkdir(join(root, course.contentRoot), { recursive: true });
    await git(root, 'init');
    await writeFile(join(root, 'README.md'), 'private notes');
    await writeFile(join(root, course.contentRoot, 'note.html'), '<p>one</p>\n');
    await writeFile(join(root, course.contentRoot, 'notes.pdf'), '%PDF-first');
    return { courseId: course.id, repository: course.repo, root, sha: await commit(root, 'source') };
  }));
  const course = snapshot.revisions[0]!;
  return { project, snapshot, course, call: async () => (await fingerprintPublicInputDetails(project, snapshot)).inputHash };
}

test('fingerprints the material actually checked out', async () => {
  const { project, snapshot, course, call } = await fixture();
  const base = await call();
  expect(base).toMatch(/^[a-f0-9]{64}$/);
  await writeFile(join(course.root, 'README.md'), 'edited private notes');
  course.sha = await commit(course.root, 'edit readme');
  expect(await call()).toBe(base);
  await rename(join(course.root, 'README.md'), join(course.root, 'NOTES.md'));
  course.sha = await commit(course.root, 'move excluded file');
  const renamed = await call();
  expect(renamed).not.toBe(base);
  await writeFile(join(course.root, '복습노트', 'notes.pdf'), '%PDF-second');
  course.sha = await commit(course.root, 'edit PDF');
  const withPdf = await call();
  expect(withPdf).not.toBe(renamed);
  await rm(join(course.root, '복습노트', 'note.html'));
  course.sha = await commit(course.root, 'delete HTML');
  const deleted = await call();
  expect(deleted).not.toBe(withPdf);
  await writeFile(join(project, 'index.html'), '<main>changed</main>');
  snapshot.appSha = await commit(project, 'change hub');
  expect(await call()).not.toBe(deleted);
}, fixtureTimeout);

test('includes checked-out bytes after Git attribute conversion', async () => {
  const { course, call } = await fixture();
  await writeFile(join(course.root, '.gitattributes'), '*.html text eol=lf\n');
  course.sha = await commit(course.root, 'use LF');
  const path = '복습노트/note.html';
  const blob = await git(course.root, 'rev-parse', 'HEAD:' + path);
  const before = await call();
  await writeFile(join(course.root, '.gitattributes'), '*.html text eol=crlf\n');
  course.sha = await commit(course.root, 'use CRLF');
  await rm(join(course.root, path));
  await git(course.root, 'checkout', '--', path);
  expect(await git(course.root, 'rev-parse', 'HEAD:' + path)).toBe(blob);
  expect(await git(course.root, 'status', '--porcelain')).toBe('');
  expect(await call()).not.toBe(before);
}, fixtureTimeout);

test('only the edited course digest changes when a published asset is removed', async () => {
  const { project, snapshot, course } = await fixture();
  const before = await fingerprintPublicInputDetails(project, snapshot);
  await rm(join(course.root, '복습노트', 'notes.pdf'));
  course.sha = await commit(course.root, 'delete PDF');
  const after = await fingerprintPublicInputDetails(project, snapshot);
  expect(after.inputHash).not.toBe(before.inputHash);
  expect(Object.keys(after.courseHashes).filter(id => after.courseHashes[id] !== before.courseHashes[id]))
    .toEqual(['logic-lab']);
}, fixtureTimeout);

test('rejects a moved HEAD or an unsafe selected file', async () => {
  const { course, call } = await fixture();
  await writeFile(join(course.root, 'README.md'), 'new HEAD');
  const head = await commit(course.root, 'change HEAD');
  await expect(call()).rejects.toThrow();
  course.sha = head;
  const path = join(course.root, '복습노트', 'note.html');
  await rm(path);
  await mkdir(path);
  await expect(call()).rejects.toThrow();
}, fixtureTimeout);
