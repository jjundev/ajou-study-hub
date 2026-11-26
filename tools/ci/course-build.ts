import { realpath, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCourseId, type CourseId } from '../../config/course-workers.js';
import { finishAppBuild } from '../app-build.js';
import { buildContent } from '../content/build.js';
import { writeReport, type BuildReport } from '../content/report.js';
import { inspectBoundSources } from '../source-binding.js';
import { readCourseSnapshot } from './course-source.js';
import type { SourceSnapshot } from './sources.js';

export function courseWorkerPaths(project: string, courseId: CourseId) {
  const reportDir = resolve(project, '.reports/course-worker', courseId);
  return { reportDir, outputDir: resolve(project, '.generated/course-worker', courseId, 'assets'),
    manifestPath: resolve(reportDir, 'content-build.json'), proofPath: resolve(reportDir, 'verification.json') };
}

export async function buildCourseWorker(options: {
  project: string; courseId: CourseId; snapshot: SourceSnapshot; outputDir: string; reportDir: string;
}) {
  const { project, courseId, snapshot } = options;
  const { config, revision } = await readCourseSnapshot(project, courseId, snapshot);
  const inspected = await inspectBoundSources(project, snapshot.settingsPath, [config]);
  const source = inspected.snapshot.provenance[0];
  if (inspected.binding.settings.roots[courseId] !== revision.root || source?.commit !== revision.sha || source.dirty) {
    throw Error('Course checkout does not match pinned revision');
  }
  const result = await buildContent({ settings: inspected.binding.settings, configs: [config], outputDir: options.outputDir, reportDir: options.reportDir });
  const built = JSON.parse(await readFile(result.reportPath, 'utf8')) as BuildReport;
  const manifest = await finishAppBuild(result.outputDir, built);
  await writeReport(manifest, result.reportPath, [result.outputDir, revision.root]);
  return { ...result, bundleHash: manifest.bundleHash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const id = process.argv[2] ?? '';
    if (!isCourseId(id) || process.argv.length !== 3) throw Error();
    const project = await realpath(process.cwd());
    const snapshot = JSON.parse(await readFile(resolve(project, '.reports/ci-sources.json'), 'utf8')) as SourceSnapshot;
    const result = await buildCourseWorker({ project, courseId: id, snapshot, ...courseWorkerPaths(project, id) });
    console.log(JSON.stringify({ courseId: id, bundleHash: result.bundleHash }));
  } catch {
    console.error('CI_COURSE_BUILD_FAILED');
    process.exitCode = 1;
  }
}
