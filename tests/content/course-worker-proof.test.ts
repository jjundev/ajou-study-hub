import { expect, test } from 'vitest';
import { assertCourseWorkerProof, type CourseWorkerProofInput } from '../../tools/course-worker-proof.js';

test('rejects a proof for a different course, an expired proof and changed bundle identity', async () => {
  const hash = 'b'.repeat(64);
  const now = new Date().toISOString();
  const input = {
    courseId: 'life-science',
    snapshot: { appSha: 'a'.repeat(40), revisions: [{ sha: 'c'.repeat(40) }] },
    manifest: { createdAt: now, bundleHash: hash, outputs: [{ path: 'catalog.json', sha256: hash }] },
  } as CourseWorkerProofInput;
  const proof = {
    schema: 'course-worker-v1' as const, courseId: 'life-science' as const, appSha: input.snapshot.appSha,
    sourceSha: input.snapshot.revisions[0]!.sha, settingsSha256: hash,
    bundleHash: hash, catalogHash: hash, verifiedAt: now, documentsChecked: 1,
  };
  await expect(assertCourseWorkerProof({ ...input, courseId: 'ml-basics', proof })).rejects.toThrow('Course proof does not match');
  await expect(assertCourseWorkerProof({ ...input, proof: { ...proof, verifiedAt: '2000-01-01T00:00:00.000Z' } })).rejects.toThrow('Course proof does not match');
  await expect(assertCourseWorkerProof({ ...input, proof: { ...proof, bundleHash: 'd'.repeat(64) } })).rejects.toThrow('Course proof does not match');
});
