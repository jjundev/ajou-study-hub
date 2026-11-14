import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  checkpointFromReceipt, comparePublicCheckpoint, readPreviousCheckpoint,
} from '../../tools/ci/public-deployment-checkpoint.js';

const runId = '12345678901';
const attempt = 2;
const appSha = 'a'.repeat(40);
const inputHash = 'b'.repeat(64);
const bundleHash = 'c'.repeat(64);
const deploymentId = '11111111-1111-1111-1111-111111111111';
const versionId = '22222222-2222-2222-2222-222222222222';
const changedId = '33333333-3333-3333-3333-333333333333';
const target = {
  accountId: 'd'.repeat(32), workerId: 'e'.repeat(32), workerName: 'ajou-study-hub' as const,
  productionUrl: 'https://ajou-study-hub.johnshin617.workers.dev', previewUrls: [],
};
const active = { deploymentId, versionId };
const receipt = {
  status: 'published-public-verified', url: target.productionUrl, workerId: target.workerId,
  ...active, currentVersionId: versionId, checked: 10, bundleHash,
};
const input = { runId, attempt, appSha, inputHash, target, receipt };

test('requires successful public verification and valid IDs', () => {
  expect(checkpointFromReceipt(input)).toEqual({
    schema: 1, runId, attempt, appSha, inputHash, bundleHash, ...active,
    targetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  for (const update of [
    { status: 'uploaded-postcheck-pending' }, { deploymentId: undefined }, { versionId: 'invalid' },
    { currentVersionId: changedId }, { checked: 2 }, { checked: 20001 },
    { workerId: 'f'.repeat(32) }, { url: 'https://wrong.workers.dev' },
  ]) expect(() => checkpointFromReceipt({ ...input, receipt: { ...receipt, ...update } })).toThrow();
  expect(() => checkpointFromReceipt({ ...input, attempt: 0 })).toThrow();
  expect(() => checkpointFromReceipt({ ...input, runId: '9007199254740992' })).toThrow();
});

test('ties the checkpoint to the target, input, deployment and version', async () => {
  const checkpoint = checkpointFromReceipt(input);
  const matching = { checkpoint, appSha, inputHash, target, readActive: async () => active };
  expect(await comparePublicCheckpoint(matching)).toBe('match');
  for (const update of [
    { checkpoint: null }, { appSha: 'f'.repeat(40) }, { inputHash: 'f'.repeat(64) },
    { target: { ...target, workerId: 'f'.repeat(32) } },
    { readActive: async () => ({ ...active, deploymentId: changedId }) },
    { readActive: async () => ({ ...active, versionId: changedId }) },
    { readActive: async () => { throw Error('private details'); } },
  ]) expect(await comparePublicCheckpoint({ ...matching, ...update })).toBe('build');
});

let scratch: string | undefined;
afterEach(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });
async function history() {
  const root = scratch = await realpath(await mkdtemp(join(tmpdir(), 'hub-public-checkpoint-')));
  const repo = ['-R', 'jjundev/ajou-study-hub'];
  const currentRunId = '12345678903';
  const skippedId = '12345678902';
  const run = {
    databaseId: Number(runId), attempt, headSha: appSha, headBranch: 'main',
    status: 'completed', conclusion: 'success', updatedAt: '2026-11-14T00:00:00Z',
  };
  const calls: string[][] = [];
  const data = {
    runConclusion: 'success', skippedConclusion: 'skipped', skippedAttempt: 1,
    publishStatus: 'completed', publishConclusion: 'success',
    archive: 'ok', checkpoint: checkpointFromReceipt(input), attemptHeadSha: appSha, saved: 'success',
  };
  const publish = (conclusion: string, status = 'completed') => JSON.stringify({
    jobs: [{ name: 'verify', status: 'completed', conclusion: conclusion === 'failure' ? 'failure' : 'success',
      steps: [
        { name: 'Publish the verified bundle to the public Worker', status, conclusion },
        { name: 'Confirm the public deployment checkpoint was saved', status: 'completed', conclusion: data.saved },
      ],
    }],
  });
  const gh = async (args: string[]) => {
    calls.push(args);
    if (args[1] === 'list') {
      expect(args).toEqual(['run', 'list', ...repo, '--workflow', 'study-hub-update.yml', '--branch', 'main',
        '--limit', '20', '--json', 'databaseId,attempt,headSha,headBranch,status,conclusion,updatedAt']);
      return JSON.stringify([{ ...run, conclusion: data.runConclusion },
        { ...run, databaseId: Number(currentRunId), updatedAt: '2026-11-14T02:00:00Z' },
        { ...run, attempt: data.skippedAttempt, databaseId: Number(skippedId), updatedAt: '2026-11-14T01:00:00Z' }]);
    }
    if (args[1] === 'view') {
      expect(args).toEqual(['run', 'view', args[2], ...repo, '--attempt',
        args[2] === skippedId ? String(data.skippedAttempt) : '2', '--json', 'jobs']);
      if (args[2] === skippedId) return publish(data.skippedConclusion);
      expect(args[2]).toBe(runId);
      return publish(data.publishConclusion, data.publishStatus);
    }
    const directory = args.at(-1)!;
    expect(dirname(directory)).toBe(root);
    expect(args).toEqual(['run', 'download', runId, ...repo, '-n', 'public-checkpoint-2', '-D', directory]);
    if (data.archive === 'expired') throw Error('Artifact not available');
    if (data.archive === 'absent') return '';
    await writeFile(join(directory, 'public-checkpoint.json'), data.archive === 'oversized'
      ? ' '.repeat(4097)
      : JSON.stringify({ ...data.checkpoint, appSha: data.attemptHeadSha }));
    if (data.archive === 'extra') await writeFile(join(directory, 'extra.txt'), 'unexpected');
    return '';
  };
  return { read: () => readPreviousCheckpoint({ gh, currentRunId, scratch: root }), root, data, calls, skippedId };
}

test('loads the latest verified publish through an intervening skipped run', async () => {
  const { root, read, data, calls, skippedId } = await history();
  expect(await read()).toEqual(data.checkpoint);
  expect(calls.slice(1).map(args => args.slice(1, 3))).toEqual([
    ['view', skippedId], ['view', runId], ['download', runId],
  ]);
  expect(await readdir(root)).toEqual([]);
});

test('does not use an older attempt after publication failed', async () => {
  const { read, data, calls } = await history();
  data.runConclusion = data.publishConclusion = 'failure';
  expect(await read()).toBeNull();
  expect(calls.some(args => args[1] === 'download')).toBe(false);
});

test('does not use an older run when a skipped rerun may hide a publication attempt', async () => {
  const { read, data, calls } = await history();
  data.skippedAttempt = 2;
  expect(await read()).toBeNull();
  expect(calls.some(args => args[1] === 'download')).toBe(false);
});

test('requires proof that the trusted workflow saved the checkpoint', async () => {
  const { read, data, calls } = await history();
  data.saved = 'skipped';
  expect(await read()).toBeNull();
  expect(calls.some(args => args[1] === 'download')).toBe(false);
});

test.each(['absent', 'expired', 'oversized', 'extra'])('builds when the checkpoint archive is %s', async archive => {
  const { read, data } = await history();
  data.archive = archive;
  expect(await read()).toBeNull();
});

test('rejects a stale attempt or wrong head SHA inside the expected archive', async () => {
  const { read, data } = await history();
  data.checkpoint.attempt = 1;
  expect(await read()).toBeNull();
  data.checkpoint.attempt = attempt;
  data.attemptHeadSha = 'f'.repeat(40);
  expect(await read()).toBeNull();
});
