import { expect, test } from 'vitest';
import {
  readActiveVersion, readWorkerTarget, validatePublicSettings,
  type PublicDeploymentSettings,
} from '../../tools/deploy/worker-target.js';

const target: PublicDeploymentSettings = {
  accountId: 'a'.repeat(32),
  workerName: 'ajou-study-hub',
  workerId: 'b'.repeat(32),
  productionUrl: 'https://ajou-study-hub.johnshin617.workers.dev',
  previewUrls: [],
};
const versionId = '22222222-2222-2222-2222-222222222222';
const base = '/client/v4/accounts/' + target.accountId;
const zoneId = 'c'.repeat(32);

function api(mode = 'ok') {
  const calls: string[] = [];
  const worker = { id: target.workerId, name: target.workerName, references: { domains: [] as string[] } };
  if (mode === 'worker-id') worker.id = 'd'.repeat(32);
  if (mode === 'domain') worker.references.domains.push('other.example.org');
  const versions = [{ version_id: versionId, percentage: 100 }];
  if (mode === 'split') {
    versions[0]!.percentage = 50;
    versions.push({ version_id: '33333333-3333-3333-3333-333333333333', percentage: 50 });
  }
  const rows: Record<string, unknown> = {
    [base + '/workers/workers']: [worker],
    [base + '/workers/workers/' + worker.id]: worker,
    [base + '/workers/scripts/ajou-study-hub/subdomain']: { enabled: true, previews_enabled: mode === 'preview' },
    [base + '/workers/subdomain']: { subdomain: mode === 'host' ? 'someone-else' : 'johnshin617' },
    '/client/v4/zones': [{ id: zoneId }],
    ['/client/v4/zones/' + zoneId + '/workers/routes']: mode === 'route'
      ? [{ id: 'route-id', pattern: 'example.org/*', script: target.workerName }]
      : [],
    [base + '/workers/scripts/ajou-study-hub/deployments']: {
      deployments: [{ id: '44444444-4444-4444-4444-444444444444', strategy: 'percentage', versions }],
    },
  };
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    expect(url.origin).toBe('https://api.cloudflare.com');
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-read-token');
    if (mode === 'unauthorized') return new Response(null, { status: 401 });
    if (!Object.hasOwn(rows, url.pathname)) throw Error('Unexpected Cloudflare API path');
    return Response.json({
      success: true, errors: [], result: rows[url.pathname],
      ...(url.search ? { result_info: { page: 1, count: 1, total_count: 1, per_page: 100 } } : {}),
    });
  };
  return { calls, options: { fetch: request, token: 'test-read-token' } };
}

test('reads the pinned public Worker and its single active version without Access calls', async () => {
  const { calls, options } = api();
  expect(await readWorkerTarget(target, options)).toMatchObject({
    worker: { id: target.workerId }, hosts: [target.productionUrl],
  });
  expect(await readActiveVersion(target, options)).toBe(versionId);
  expect(calls.some(path => path.includes('/access/'))).toBe(false);
});

test.each(['unauthorized', 'worker-id', 'host', 'preview', 'domain', 'route'])(
  'rejects an unsafe public Worker target: %s', async mode => {
    const { calls, options } = api(mode);
    await expect(readWorkerTarget(target, options)).rejects.toThrow(/Cloudflare Worker target/);
    expect(calls.some(path => path.includes('/access/'))).toBe(false);
  },
);

test('rejects a split active deployment', async () => {
  const { options } = api('split');
  await expect(readActiveVersion(target, options)).rejects.toThrow(/active Worker version/);
});

test('requires the exact public URL, pinned Worker ID and disabled previews in settings', () => {
  expect(() => validatePublicSettings(target)).not.toThrow();
  for (const overrides of [
    { productionUrl: 'https://ajou-study-hub.other.workers.dev' },
    { workerId: '' },
    { previewUrls: ['https://preview.ajou-study-hub.workers.dev'] },
    { accountId: 'bad-account' },
    { extra: true },
  ]) expect(() => validatePublicSettings({ ...target, ...overrides })).toThrow();
});
