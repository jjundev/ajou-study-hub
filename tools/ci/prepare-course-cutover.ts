import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { courses } from '../../config/courses.js';
import { courseIds } from '../../config/course-workers.js';
import type { VerifiedPublicBaseline } from '../deploy/static-worker-baseline.js';
import { workerVersionId } from '../deploy/worker-target.js';

try {
  const run = JSON.parse(await readFile('.local/cutover/run.json', 'utf8'));
  const checkpoint = JSON.parse(await readFile('.local/cutover/public-checkpoint.json', 'utf8'));
  const summary = JSON.parse(await readFile('.local/cutover/ci-summary.json', 'utf8'));
  const version = /^\d{1,15}$/.test(process.env.BASELINE_RUN ?? '') && process.env.BASELINE_RUN;
  const attempt = Number(process.env.BASELINE_ATTEMPT);
  const catalogHash = process.env.BASELINE_CATALOG_HASH ?? '';
  if (!version || !Number.isSafeInteger(attempt) || attempt < 1 || !/^[a-f0-9]{64}$/.test(catalogHash) ||
      String(run.id) !== version || run.run_attempt !== attempt || run.path !== '.github/workflows/study-hub-update.yml' ||
      run.head_branch !== 'main' || run.repository?.full_name !== 'jjundev/ajou-study-hub' ||
      run.head_repository?.full_name !== 'jjundev/ajou-study-hub' || run.conclusion !== 'success' ||
      run.head_sha !== checkpoint.appSha || !/^[a-f0-9]{40}$/.test(run.head_sha) ||
      summary.appSha !== checkpoint.appSha || summary.code !== 'VERIFICATION_PASSED' ||
      checkpoint.schema !== 3 || checkpoint.runId !== version || checkpoint.attempt !== attempt ||
      !workerVersionId.test(checkpoint.versionId) || !/^[a-f0-9]{64}$/.test(checkpoint.bundleHash) ||
      Object.keys(summary.sourceShas ?? {}).length !== courseIds.length ||
      courseIds.some(id => !/^[a-f0-9]{40}$/.test(summary.sourceShas[id]))) throw Error();
  const receipt: VerifiedPublicBaseline = {
    appSha: checkpoint.appSha, versionId: checkpoint.versionId, bundleHash: checkpoint.bundleHash, catalogHash, sourceShas: summary.sourceShas,
  };
  const revisions = courses.map(course => ({ courseId: course.id, repository: course.repo,
    sha: receipt.sourceShas[course.id as keyof typeof receipt.sourceShas], root: '../sources/' + course.id }));
  await writeFile('.local/cutover/receipt.json', JSON.stringify(receipt), { flag: 'wx' });
  await writeFile('.local/revisions.json', JSON.stringify(revisions), { flag: 'wx' });
  await appendFile(process.env.GITHUB_OUTPUT!, 'app_sha=' + receipt.appSha + '\n' +
    revisions.map(row => row.courseId.replaceAll('-', '_') + '=' + row.sha + '\n').join(''));
} catch {
  console.error('CI_CUTOVER_BASELINE_METADATA_INVALID');
  process.exitCode = 1;
}
