import { expect, test } from 'vitest';
import { readCourseWorkerTarget } from '../../tools/deploy/course-worker-target.js';
import { assertProductionRouting, publishCourseVersion } from '../../tools/deploy/course-worker-release.js';
import { publicProductionUrl } from '../../tools/deploy/worker-target.js';

const settings = { accountId: 'a'.repeat(32), workerIds: { 'life-science': 'b'.repeat(32) } };
const active = { deploymentId: '00000000-0000-0000-0000-000000000001', versionId: '00000000-0000-0000-0000-000000000002' };
const candidate = '00000000-0000-0000-0000-000000000003';
const target = { ...settings, courseId: 'life-science' as const, workerName: 'ajou-study-hub-life-science', workerId: settings.workerIds['life-science'], active };
const proof = { bundleHash: 'c'.repeat(64), catalogHash: 'd'.repeat(64), sourceSha: 'b'.repeat(40) };

test('rejects a wrong immutable worker id and public course endpoints', async () => {
  const urls: string[] = [];
  const read = (id: string) => async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    urls.push(path);
    const worker = { id, name: target.workerName, references: { domains: [] } };
    const result = path.endsWith('/workers/workers') ? [worker] : path.endsWith('/subdomain')
      ? { enabled: true, previews_enabled: false } : worker;
    return Response.json({ success: true, errors: [], result, ...(Array.isArray(result) ? { result_info: { page: 1, total_pages: 1 } } : {}) });
  };
  await expect(readCourseWorkerTarget('life-science', settings, { token: 'test', fetch: read('c'.repeat(32)) })).rejects.toThrow();
  expect(urls).toHaveLength(1);
  await expect(readCourseWorkerTarget('life-science', settings, { token: 'test', fetch: read(target.workerId) })).rejects.toThrow();
  expect(urls.at(-1)).toMatch(/\/subdomain$/);
});

test('promotes and rolls back the selected course after a definitive failed postcheck', async () => {
  let current = active;
  const writes: string[] = [];
  const receipt = await publishCourseVersion({
    courseId: target.courseId, proof, checkpoint: { courseId: target.courseId, workerId: target.workerId, versionId: active.versionId, ...proof, bundleHash: 'e'.repeat(64) },
    async probePrevious() { return true; },
    async readTarget() { return { ...target, active: current }; },
    async checkRouting() {},
    async upload() { return candidate; },
    async promote(worker) { writes.push(worker.workerName); current = { deploymentId: candidate, versionId: candidate }; },
    async probe() { return false; },
    async rollback(worker) { writes.push(worker.workerName); current = { ...active, deploymentId: candidate }; },
  });
  expect(receipt.status).toBe('rolled-back');
  expect(writes).toEqual([target.workerName, target.workerName]);
});

test('reconciles an ambiguous upload without overwriting another version', async () => {
  let changed = false;
  const fail = () => { throw new Error('unexpected write'); };
  const receipt = await publishCourseVersion({
    courseId: target.courseId, proof, checkpoint: { courseId: target.courseId, workerId: target.workerId, versionId: active.versionId, ...proof, bundleHash: 'e'.repeat(64) },
    async probePrevious() { return true; },
    async readTarget() { return { ...target, active: changed ? { deploymentId: candidate, versionId: candidate } : active }; },
    async checkRouting() {},
    async upload() { changed = true; throw Error('No receipt'); },
    promote: fail, rollback: fail, async probe() { return true; },
  });
  expect(receipt.status).toBe('outcome-unknown');
  expect(receipt.active).toEqual({ deploymentId: candidate, versionId: candidate });
});

test('rejects routing drift before any upload', async () => {
  const request = async () => Response.json({ schema: 1, profile: 'pilot', courseIds: ['life-science'] });
  await expect(assertProductionRouting('all', publicProductionUrl, request)).rejects.toThrow('Production routing');
  await expect(assertProductionRouting('pilot', publicProductionUrl, request)).resolves.toBeUndefined();
});
