import { expect, test } from 'vitest';
import { summarizeCourseObservation } from '../../tools/ci/observe-course-verification.js';

const documents = [
  { id: 'updated', courseId: 'life-science' },
  { id: 'other', courseId: 'ml-basics' },
];
const source = {
  bundleHash: 'a'.repeat(64), catalogHash: 'b'.repeat(64), status: 'complete', passed: true,
  integrityChecks: {
    sourceHashesUnchanged: true, bundleBytesUnchanged: true, sourceTrackingUnchanged: true,
    inputCount: 10, outputCount: 8,
  },
  representatives: { complete: true, scenarios: Array.from({ length: 42 }, () => ({ passed: true })) },
  inputs: [{ courseId: 'life-science', path: 'note.html', sha256: 'c'.repeat(64) }],
  sources: [{ courseId: 'life-science', commit: 'd'.repeat(40), dirty: false, trackedPaths: ['note.html'], explicitUntracked: [] }],
};
const full = {
  ...source, scope: 'actual-app-runtime', deploymentEligible: true, documentsChecked: 2,
  durationMs: 1200, documentScanMs: 800, documents: [{ documentId: 'updated' }, { documentId: 'other' }],
};
const scoped = {
  ...source, scope: 'observed-course-runtime', deploymentEligible: false, documentsChecked: 1,
  durationMs: 800, documentScanMs: 400, documents: [{ documentId: 'updated' }], observedCourses: ['life-science'],
};

test('compares equal bundle coverage and reports only counts and timing', () => {
  expect(summarizeCourseObservation(full, scoped, documents, ['life-science'])).toEqual({
    courses: ['life-science'], fullDocuments: 2, scopedDocuments: 1, representativeScenarios: 42,
    inputCount: 10, outputCount: 8, fullMs: 1200, scopedMs: 800, fullDocumentScanMs: 800, scopedDocumentScanMs: 400,
  });
});

test.each([
  { documents: [{ documentId: 'other' }] }, { bundleHash: 'c'.repeat(64) }, { passed: false },
  { integrityChecks: { ...source.integrityChecks, inputCount: 9 } },
  { representatives: { complete: true, scenarios: [] } },
  { deploymentEligible: true },
  { sources: [{ ...source.sources[0]!, commit: 'e'.repeat(40) }] },
])('rejects a different bundle, missing checks, or publishable scoped proof %#', change => {
  expect(() => summarizeCourseObservation(full, { ...scoped, ...change }, documents, ['life-science'])).toThrow();
});
