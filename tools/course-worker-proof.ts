import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CourseId } from '../config/course-workers.js';
import { isCatalog } from '../src/content/catalog-validation.js';
import { readCourseSnapshot } from './ci/course-source.js';
import type { SourceSnapshot } from './ci/sources.js';
import type { BuildReport } from './content/report.js';
import { inventory } from './deploy/bootstrap.js';
import { assertCurrentSources, inspectBoundSources } from './source-binding.js';
import { createHash } from 'node:crypto';

export type CourseWorkerProof = {
  schema: 'course-worker-v1';
  courseId: CourseId;
  appSha: string;
  sourceSha: string;
  settingsSha256: string;
  bundleHash: string;
  catalogHash: string;
  verifiedAt: string;
  documentsChecked: number;
};
export type CourseWorkerProofInput = { project: string; courseId: CourseId; snapshot: SourceSnapshot; outputDir: string; manifest: BuildReport };
export const artifactHash = (outputs: BuildReport['outputs']) =>
  createHash('sha256').update(outputs.map(file => file.path + '\0' + file.sha256 + '\n').join('')).digest('hex');

export async function inspectCourseArtifact(outputDir: string, courseId: CourseId, manifest: BuildReport) {
  if (await realpath(outputDir) !== resolve(outputDir) || (await lstat(outputDir)).isSymbolicLink()) {
    throw Error('Unsafe course artifact directory');
  }
  const outputs = await inventory(outputDir);
  const catalogHash = outputs.find(file => file.path === 'catalog.json')?.sha256;
  const prefix = 'content/' + courseId + '/';
  const rootFiles = ['catalog.json', '404.html', '_headers', '_redirects'];
  if (!rootFiles.every(path => outputs.some(file => file.path === path)) || !catalogHash ||
      outputs.some(file => !file.path.startsWith(prefix) && !rootFiles.includes(file.path)) ||
      JSON.stringify(outputs) !== JSON.stringify(manifest.outputs) || artifactHash(outputs) !== manifest.bundleHash ||
      manifest.issues.some(issue => issue.severity === 'error')) {
    throw Error('Course artifact has changed or exceeds its scope');
  }
  const catalog: unknown = JSON.parse(await readFile(resolve(outputDir, 'catalog.json'), 'utf8'));
  if (!isCatalog(catalog) || catalog.courses.length !== 1 || catalog.courses[0]?.id !== courseId) {
    throw Error('Course catalog has wrong owner');
  }
  const files = new Set(outputs.map(file => file.path));
  if (catalog.documents.some(doc => !files.has(decodeURIComponent(doc.url).slice(1))) ||
      catalog.groups.some(group => [...group.reviewPdfs ?? [], ...group.answerPdfs ?? []]
        .some(path => !files.has(prefix + path.normalize('NFC'))))) {
    throw Error('Course catalog references a missing asset');
  }
  return { catalog, catalogHash };
}

export async function inspectVerifiedCourseInputs(input: CourseWorkerProofInput) {
  const { project, courseId, snapshot, manifest, outputDir } = input;
  const { config, revision } = await readCourseSnapshot(project, courseId, snapshot);
  const { binding } = await inspectBoundSources(project, snapshot.settingsPath, [config]);
  if (binding.settings.roots[courseId] !== revision.root || manifest.sources.length !== 1 ||
      manifest.sources[0]?.courseId !== courseId || manifest.sources[0].commit !== revision.sha ||
      manifest.sources[0].dirty || manifest.inputs.some(file => file.courseId !== courseId)) {
    throw Error('Course artifact has wrong source provenance');
  }
  await assertCurrentSources(project, binding, manifest, [config]);
  return { ...await inspectCourseArtifact(outputDir, courseId, manifest), config, revision, binding };
}

export async function assertCourseWorkerProof(input: CourseWorkerProofInput & { proof: CourseWorkerProof }): Promise<void> {
  const { courseId, snapshot, manifest, proof } = input;
  const created = Date.parse(proof.verifiedAt);
  const age = Date.now() - created;
  if (proof.schema !== 'course-worker-v1' || proof.courseId !== courseId || proof.appSha !== snapshot.appSha ||
      proof.sourceSha !== snapshot.revisions[0]?.sha || proof.bundleHash !== manifest.bundleHash ||
      proof.catalogHash !== manifest.outputs.find(file => file.path === 'catalog.json')?.sha256 ||
      !Number.isFinite(age) || age < 0 || age > 86_400_000 ||
      !Number.isFinite(Date.parse(manifest.createdAt)) || created < Date.parse(manifest.createdAt)) {
    throw Error('Course proof does not match current build');
  }
  const { binding, catalog, catalogHash } = await inspectVerifiedCourseInputs(input);
  if (binding.settingsSha256 !== proof.settingsSha256 || catalogHash !== proof.catalogHash ||
      catalog.documents.length === 0 || catalog.documents.length !== proof.documentsChecked) {
    throw Error('Course proof does not match verified assets and settings');
  }
}
