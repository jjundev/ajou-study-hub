import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { boundCourseIds, courseIds, type CourseId, type StaticWorkerProfile } from '../../config/course-workers.js';
import { catalogSlice, isCatalog, mergeCatalogs } from '../../src/content/catalog-validation.js';
import type { Catalog } from '../../src/content/model.js';
import { artifactHash, inspectCourseArtifact } from '../course-worker-proof.js';
import type { BuildReport } from '../content/report.js';
import { inventory } from './bootstrap.js';
import { createCourseWorkerConfig } from './course-worker-release.js';
import { findCourseWorkerId, readCourseWorkerTarget, type CourseWorkerTarget } from './course-worker-target.js';
import { uploadedVersion, withProfiledWrangler } from './profiled-wrangler.js';
import { workerVersionId, type ReadOptions } from './worker-target.js';

export type VerifiedPublicBaseline = { appSha: string; versionId: string; bundleHash: string; catalogHash: string; sourceShas: Record<CourseId, string> };
export type StaticArtifact = { directory: string; manifest: BuildReport; catalog: Catalog };
export type SeedArtifact = StaticArtifact & { courseId: CourseId; sourceSha: string };
export type StaticWorkerBaseline = { courses: SeedArtifact[]; hub: StaticArtifact };

export async function assertStaticInventory(directory: string, manifest: BuildReport) {
  if (await realpath(directory) !== resolve(directory) || (await lstat(directory)).isSymbolicLink()) throw Error('Unsafe static artifact directory');
  const outputs = await inventory(directory);
  if (!isDeepStrictEqual(outputs, manifest.outputs) || artifactHash(outputs) !== manifest.bundleHash ||
      manifest.issues.some(issue => issue.severity === 'error')) throw Error('Static artifact differs from manifest');
}

async function copyArtifact(source: string, directory: string, manifest: BuildReport, catalog: Catalog, files: BuildReport['outputs']) {
  await mkdir(directory);
  if (await realpath(directory) !== resolve(directory)) throw Error('Unsafe static artifact destination');
  for (const { path } of files) {
    if (path === 'catalog.json') continue;
    const target = resolve(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(source, path), target);
  }
  await writeFile(resolve(directory, 'catalog.json'), JSON.stringify(catalog) + '\n', { flag: 'wx' });
  const outputs = await inventory(directory);
  const original = new Map(files.map(file => [file.path, file]));
  if (outputs.filter(file => file.path !== 'catalog.json').some(file => !isDeepStrictEqual(file, original.get(file.path)))) {
    throw Error('Baseline bytes changed during copy');
  }
  return { directory, manifest: { ...manifest, outputs, bundleHash: artifactHash(outputs) }, catalog };
}

export async function assembleHubArtifact(bundleDir: string, manifest: BuildReport, profile: StaticWorkerProfile, directory: string): Promise<StaticArtifact> {
  await assertStaticInventory(bundleDir, manifest);
  const catalog: unknown = JSON.parse(await readFile(resolve(bundleDir, 'catalog.json'), 'utf8'));
  if (!isCatalog(catalog)) throw Error('Invalid hub base catalog');
  const unbound = courseIds.filter(id => !boundCourseIds(profile).includes(id));
  const allowed = new Set<string>(unbound);
  const files = manifest.outputs.filter(file => !file.path.startsWith('content/') || allowed.has(file.path.split('/')[1]!));
  if (profile !== 'all' && catalog.courses.length !== courseIds.length) throw Error('Incomplete legacy catalog');
  return copyArtifact(bundleDir, directory, manifest, mergeCatalogs(unbound.map(id => catalogSlice(catalog, id))), files);
}

export async function deriveStaticWorkerBaseline(input: { bundleDir: string; manifest: BuildReport; receipt: VerifiedPublicBaseline; profile: StaticWorkerProfile; outputRoot: string }): Promise<StaticWorkerBaseline> {
  const { bundleDir, manifest, receipt, profile, outputRoot } = input;
  const sourceShas = Object.fromEntries(manifest.sources.map(source => [source.courseId, source.commit]));
  if (!/^[a-f0-9]{40}$/.test(receipt.appSha) || !workerVersionId.test(receipt.versionId) ||
      receipt.bundleHash !== manifest.bundleHash || receipt.catalogHash !== manifest.outputs.find(file => file.path === 'catalog.json')?.sha256 ||
      Object.keys(receipt.sourceShas).length !== courseIds.length ||
      courseIds.some(id => !/^[a-f0-9]{40}$/.test(receipt.sourceShas[id]) || sourceShas[id] !== receipt.sourceShas[id]) ||
      manifest.sources.length !== courseIds.length || manifest.sources.some(source => source.dirty)) {
    throw Error('Baseline release identity mismatch');
  }
  await assertStaticInventory(bundleDir, manifest);
  const catalog: unknown = JSON.parse(await readFile(resolve(bundleDir, 'catalog.json'), 'utf8'));
  if (!isCatalog(catalog) || catalog.courses.length !== courseIds.length ||
      courseIds.some(id => !catalog.courses.some(course => course.id === id))) throw Error('Invalid baseline catalog');
  await mkdir(outputRoot);
  if (await realpath(outputRoot) !== resolve(outputRoot)) throw Error('Unsafe baseline destination');
  const controls = ['_headers', '_redirects', '404.html'];
  const courses: SeedArtifact[] = [];
  for (const courseId of boundCourseIds(profile)) {
    const files = manifest.outputs.filter(file => controls.includes(file.path) || file.path.startsWith('content/' + courseId + '/'));
    const courseManifest = { ...manifest, sources: manifest.sources.filter(source => source.courseId === courseId),
      inputs: manifest.inputs.filter(file => file.courseId === courseId), issues: manifest.issues.filter(issue => issue.courseId === courseId) };
    const artifact = await copyArtifact(bundleDir, resolve(outputRoot, courseId), courseManifest, catalogSlice(catalog, courseId), files);
    await inspectCourseArtifact(artifact.directory, courseId, artifact.manifest);
    courses.push({ ...artifact, courseId, sourceSha: receipt.sourceShas[courseId] });
  }
  return { courses, hub: await assembleHubArtifact(bundleDir, manifest, profile, resolve(outputRoot, 'hub')) };
}

export async function seedCourseWorker({ project, accountId, artifact, token, readOptions, previous }: {
  project: string; accountId: string; artifact: SeedArtifact; token?: string; readOptions: ReadOptions; previous?: { workerId: string; versionId: string; bundleHash: string };
}): Promise<CourseWorkerTarget> {
  const { courseId, manifest } = artifact;
  const existing = await findCourseWorkerId(accountId, courseId, readOptions);
  const readTarget = (id: string) => readCourseWorkerTarget(courseId, { accountId, workerIds: { [courseId]: id } }, readOptions);
  if (existing) {
    const target = await readTarget(existing);
    if (previous?.workerId === existing && previous.versionId === target.active.versionId && previous.bundleHash === manifest.bundleHash) return target;
    throw Error('Existing course Worker requires its verified seed identity');
  }
  return withProfiledWrangler(project, accountId, token, createCourseWorkerConfig(courseId, artifact.directory), 'course-assets',
    async (_directory, run) => {
      await inspectCourseArtifact(artifact.directory, courseId, manifest);
      if (await findCourseWorkerId(accountId, courseId, readOptions)) throw Error('Course Worker appeared during seed');
      const candidate = uploadedVersion(await run(['deploy', '--strict', '--autoconfig=false']), true);
      const id = await findCourseWorkerId(accountId, courseId, readOptions);
      if (!id) throw Error('Created course Worker ID could not be verified');
      const target = await readTarget(id);
      if (target.active.versionId !== candidate) throw Error('Course seed version identity mismatch');
      return target;
    });
}
