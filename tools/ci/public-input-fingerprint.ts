import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { courses } from '../../config/courses.js';
import { sourcePath } from '../content/paths.js';
import { checkFileLimit, type SourceMetrics } from './source-limits.js';
import type { SourceSnapshot } from './sources.js';
import { authorizedRoots, selected } from './sparse-source.js';

const exec = promisify(execFile);
const shaPattern = /^[a-f0-9]{40}$/;
const invalid = () => new Error('CI_PUBLIC_INPUT_UNAVAILABLE');
export type PublicInputFingerprint = { inputHash: string; courseHashes: Record<string, string> };

export function isCourseHashes(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const hashes = value as Record<string, unknown>;
  return Object.keys(hashes).length === courses.length && courses.every(({ id }) =>
    Object.hasOwn(hashes, id) && typeof hashes[id] === 'string' && /^[a-f0-9]{64}$/.test(hashes[id]));
}

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd: root, encoding: 'buffer', maxBuffer: 32 * 1024 ** 2, timeout: 30000,
  });
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(stdout);
}

async function assertHead(root: string, sha: string): Promise<void> {
  if (!shaPattern.test(sha) || await git(root, 'rev-parse', '--show-prefix', 'HEAD') !== '\n' + sha + '\n')
    throw invalid();
}

async function fileHash(root: string, path: string, metrics: SourceMetrics): Promise<string> {
  const target = resolve(root, path);
  const stat = await lstat(target);
  if (!stat.isFile() || await realpath(target) !== target) throw invalid();
  checkFileLimit(metrics, stat.size);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(target)) {
    size += chunk.length;
    if (size > stat.size) throw invalid();
    hash.update(chunk);
  }
  if (size !== stat.size) throw invalid();
  return hash.digest('hex');
}

/** Requires the source limits and binding checks to have run on this checkout. */
export async function fingerprintPublicInputDetails(project: string, snapshot: SourceSnapshot): Promise<PublicInputFingerprint> {
  const app = resolve(project);
  const sourceDir = resolve(app, '../sources');
  if (snapshot.version !== 1 || !Array.isArray(snapshot.revisions) ||
      snapshot.revisions.length !== courses.length || await realpath(app) !== app ||
      await realpath(sourceDir) !== sourceDir) throw invalid();
  await assertHead(app, snapshot.appSha);
  const metrics: SourceMetrics = { files: 0, totalBytes: 0, maxFileBytes: 0, freeBytes: 0 };
  const inputs = [];
  const courseHashes: PublicInputFingerprint['courseHashes'] = {};
  for (const course of courses) {
    const revisions = snapshot.revisions.filter(revision => revision?.courseId === course.id);
    const revision = revisions[0];
    const root = resolve(sourceDir, course.id);
    if (revisions.length !== 1 || !revision || revision.repository !== course.repo ||
        revision.root !== root || await realpath(root) !== root) throw invalid();
    await assertHead(root, revision.sha);
    const tree = await git(root, 'ls-tree', '-r', '-z', '--full-tree', revision.sha);
    if (tree && !tree.endsWith('\0')) throw invalid();
    const paths = new Map<string, string[]>();
    const normalized = new Set<string>();
    const roots = authorizedRoots(course);
    for (const row of tree.split('\0').slice(0, -1)) {
      const entry = /^(100644 blob|100755 blob|120000 blob|160000 commit) [a-f0-9]{40}\t([\s\S]+)$/.exec(row);
      if (!entry) throw invalid();
      const mode = entry[1]!;
      const path = sourcePath(entry[2]!);
      const nfc = path.normalize('NFC');
      if (/[\x00-\x1f\x7f]/.test(path) || path.split('/').some(part => part.toLowerCase() === '.git') ||
          normalized.has(nfc)) throw invalid();
      normalized.add(nfc);
      if (!selected(path, roots)) {
        paths.set(path, [path, mode]);
        continue;
      }
      if (mode !== '100644 blob' && mode !== '100755 blob') throw invalid();
      paths.set(path, [path, mode, await fileHash(root, path, metrics)]);
    }
    await assertHead(root, revision.sha);
    const input = [course.id, course.repo, [...paths.keys()].sort().map(path => paths.get(path))];
    inputs.push(input);
    courseHashes[course.id] = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }
  await assertHead(app, snapshot.appSha);
  return { inputHash: createHash('sha256').update(JSON.stringify([1, snapshot.appSha, inputs])).digest('hex'), courseHashes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void (async () => {
    if (process.argv.length !== 2) throw invalid();
    const path = '.reports/ci-sources.json';
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 16384) throw invalid();
    const snapshot = JSON.parse(await readFile(path, 'utf8')) as SourceSnapshot;
    process.stdout.write(JSON.stringify(await fingerprintPublicInputDetails(process.cwd(), snapshot)) + '\n');
  })().catch(() => {
    process.stderr.write('CI_PUBLIC_INPUT_UNAVAILABLE\n');
    process.exitCode = 1;
  });
}
