import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Catalog } from '../../src/content/model.js';
import { verifyActual } from '../verify-actual.js';
import { verifierProject } from '../verification-project.js';

type ObservedProof = Pick<Awaited<ReturnType<typeof verifyActual>>,
  'bundleHash' | 'catalogHash' | 'status' | 'passed' | 'scope' | 'deploymentEligible' | 'documentsChecked' |
  'durationMs' | 'documentScanMs' | 'observedCourses' | 'integrityChecks' | 'inputs' | 'sources'> & {
  documents: { documentId: string }[];
  representatives: { complete: boolean; scenarios: { passed: boolean }[] };
};

function verifiesDocuments(report: ObservedProof, expected: Set<string>) {
  return report.documentsChecked === expected.size && report.documents.length === expected.size &&
    new Set(report.documents.map(row => row.documentId)).size === expected.size &&
    report.documents.every(row => expected.has(row.documentId));
}

export function summarizeCourseObservation(
  full: ObservedProof, scoped: ObservedProof, documents: Pick<Catalog['documents'][number], 'id' | 'courseId'>[],
  courses: string[],
) {
  const all = new Set(documents.map(row => row.id));
  const changed = new Set(documents.filter(row => courses.includes(row.courseId)).map(row => row.id));
  const valid = (report: ObservedProof) => {
    const integrity = report.integrityChecks;
    return report.status === 'complete' && report.passed === true &&
      integrity.sourceHashesUnchanged === true && integrity.bundleBytesUnchanged === true &&
      integrity.sourceTrackingUnchanged === true && report.representatives.complete === true &&
      report.representatives.scenarios.length === 42 && report.representatives.scenarios.every(row => row.passed === true) &&
      [report.durationMs, report.documentScanMs, integrity.inputCount, integrity.outputCount]
        .every(value => Number.isSafeInteger(value) && value >= 0) && report.documentScanMs <= report.durationMs;
  };
  if (!valid(full) || !valid(scoped) || full.scope !== 'actual-app-runtime' || full.deploymentEligible !== true ||
      scoped.scope !== 'observed-course-runtime' || scoped.deploymentEligible !== false ||
      scoped.observedCourses?.join(',') !== courses.join(',') ||
      !/^[a-f0-9]{64}$/.test(full.bundleHash) || !/^[a-f0-9]{64}$/.test(full.catalogHash) ||
      scoped.bundleHash !== full.bundleHash || scoped.catalogHash !== full.catalogHash ||
      JSON.stringify(scoped.inputs) !== JSON.stringify(full.inputs) ||
      JSON.stringify(scoped.sources) !== JSON.stringify(full.sources) ||
      full.integrityChecks.inputCount !== scoped.integrityChecks.inputCount ||
      full.integrityChecks.outputCount !== scoped.integrityChecks.outputCount ||
      all.size !== documents.length || changed.size >= all.size ||
      !verifiesDocuments(full, all) || !verifiesDocuments(scoped, changed))
    throw Error('CI_COURSE_COMPARISON_MISMATCH');
  return {
    courses, fullDocuments: full.documentsChecked, scopedDocuments: scoped.documentsChecked,
    representativeScenarios: full.representatives.scenarios.length,
    inputCount: full.integrityChecks.inputCount, outputCount: full.integrityChecks.outputCount,
    fullMs: full.durationMs, scopedMs: scoped.durationMs,
    fullDocumentScanMs: full.documentScanMs, scopedDocumentScanMs: scoped.documentScanMs,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void (async () => {
    const [, , sources, changed] = process.argv;
    if (process.argv.length !== 4 || !sources || !changed) throw Error();
    const courses = changed.split(',');
    const proofPath = resolve(verifierProject, '.reports/verification.json');
    const proof = await readFile(proofPath, 'utf8');
    const catalog = JSON.parse(await readFile(resolve(verifierProject, 'dist/catalog.json'), 'utf8')) as Catalog;
    const scoped = await verifyActual(sources, { observeCourses: courses, quiet: true });
    if (await readFile(proofPath, 'utf8') !== proof) throw Error();
    const summary = JSON.stringify(summarizeCourseObservation(JSON.parse(proof), scoped, catalog.documents, courses));
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, 'Changed-course browser verification (observe)\n\n```json\n' + summary + '\n```\n');
  })().catch(() => {
    console.error('CI_COURSE_COMPARISON_UNAVAILABLE');
    process.exitCode = 1;
  });
}
