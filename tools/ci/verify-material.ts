import { appendFile } from 'node:fs/promises';
import { parseCourseRelease } from '../course-release.js';
import { verifyActual } from '../verify-actual.js';

void (async () => {
  const report = await verifyActual('.local/ci-sources.json', {
    courseRelease: parseCourseRelease(process.env.COURSE_RELEASE), quiet: true,
  });
  if (!report.passed || !report.deploymentEligible) throw Error();
  const summary = JSON.stringify({
    scope: report.scope, courses: report.courseRelease?.courses ?? [], documents: report.documentsChecked,
    representativeScenarios: report.representatives.scenarios.length,
    inputs: report.integrityChecks.inputCount, outputs: report.integrityChecks.outputCount,
    durationMs: report.durationMs, documentScanMs: report.documentScanMs,
  });
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, 'Material verification\n\n```json\n' + summary + '\n```\n');
})().catch(() => { process.exitCode = 1; });
