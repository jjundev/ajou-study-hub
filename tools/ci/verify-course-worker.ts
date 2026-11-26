import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { isCourseId, type CourseId } from '../../config/course-workers.js';
import { finishAppBuild } from '../app-build.js';
import { inspectVerifiedCourseInputs, type CourseWorkerProof, type CourseWorkerProofInput } from '../course-worker-proof.js';
import { writeReport, type BuildReport } from '../content/report.js';
import { verifyActual } from '../verify-actual.js';
import { courseWorkerPaths } from './course-build.js';
import type { SourceSnapshot } from './sources.js';

export async function verifyCourseWorker(input: CourseWorkerProofInput): Promise<CourseWorkerProof> {
  const { project, courseId, snapshot, outputDir, manifest } = input;
  const verified = await inspectVerifiedCourseInputs(input);
  const generated = resolve(await realpath(project), '.generated');
  await mkdir(generated, { recursive: true });
  if (await realpath(generated) !== generated) throw Error('Unsafe verification directory');
  const browserDir = await mkdtemp(resolve(generated, 'course-verification-'));
  try {
    await build({ root: project, configFile: false, publicDir: false, logLevel: 'warn', build: { outDir: browserDir } });
    for (const name of ['catalog.json', 'content', '_headers', '_redirects', '404.html']) {
      await cp(resolve(outputDir, name), resolve(browserDir, name), { recursive: true, force: false, errorOnExist: true });
    }
    const browserManifest = await finishAppBuild(browserDir, manifest);
    const evidence = await verifyActual(snapshot.settingsPath, {
      quiet: true, courseArtifact: { config: verified.config, outputDir: browserDir, manifest: browserManifest },
    });
    if (!evidence.passed || !evidence.documentsChecked || evidence.documentsChecked !== verified.catalog.documents.length) {
      await writeReport(evidence, resolve(project, '.reports/course-worker', courseId, 'browser-failure.json'), [outputDir], project);
      const issues = [...new Set(evidence.issues.filter(issue => issue.severity === 'error').map(issue => issue.code))];
      console.error(JSON.stringify({ code: 'CI_COURSE_BROWSER_CHECKS_FAILED', checked: evidence.documentsChecked,
        expected: verified.catalog.documents.length, issues, representativeFailures: evidence.representatives.scenarios.filter(scenario => !scenario.passed).length }));
      throw Error('Course browser checks failed');
    }
    const after = await inspectVerifiedCourseInputs(input);
    if (verified.binding.settingsSha256 !== after.binding.settingsSha256 || verified.catalogHash !== after.catalogHash) {
      throw Error('Course settings changed during browser checks');
    }
    return { schema: 'course-worker-v1', courseId, appSha: snapshot.appSha, sourceSha: verified.revision.sha,
      settingsSha256: verified.binding.settingsSha256, bundleHash: manifest.bundleHash, catalogHash: verified.catalogHash,
      verifiedAt: new Date().toISOString(), documentsChecked: evidence.documentsChecked };
  } finally {
    await rm(browserDir, { recursive: true, force: true });
  }
}

export async function readCourseArtifacts(project: string, courseId: CourseId) {
  const paths = courseWorkerPaths(project, courseId);
  const snapshot = JSON.parse(await readFile(resolve(project, '.reports/ci-sources.json'), 'utf8')) as SourceSnapshot;
  const manifest = JSON.parse(await readFile(paths.manifestPath, 'utf8')) as BuildReport;
  return { ...paths, snapshot, manifest, project, courseId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const id = process.argv[2] ?? '';
    if (!isCourseId(id) || process.argv.length !== 3) throw Error();
    const input = await readCourseArtifacts(await realpath(process.cwd()), id);
    await writeReport({ status: 'running' }, input.proofPath, [input.outputDir], input.project);
    const proof = await verifyCourseWorker(input);
    await writeReport(proof, input.proofPath, [input.outputDir], input.project);
    console.log(JSON.stringify({ courseId: id, documentsChecked: proof.documentsChecked }));
  } catch {
    console.error('CI_COURSE_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}
