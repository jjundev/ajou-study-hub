import { readCloudflareList } from './cloudflare-list.js';

export type WorkerTarget = {
  accountId: string;
  workerName: 'ajou-study-hub';
  productionUrl: string;
  previewUrls: string[];
};
// Existing private settings declare workerName as string and validate it at runtime.
type TargetInput = Omit<WorkerTarget, 'workerName'> & { workerName: string; workerId?: string };
export type PublicDeploymentSettings = WorkerTarget & { workerId: string };
export type ReadOptions = { fetch?: typeof fetch; token?: string };
type RecordValue = Record<string, unknown>;
type WorkerInspection = {
  worker: RecordValue & { id: string };
  hosts: string[];
  exposure: { subdomain: RecordValue; accountSubdomain: RecordValue; routes: RecordValue[] };
};

export const publicProductionUrl = 'https://ajou-study-hub.johnshin617.workers.dev';
export const workerVersionId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hexId = /^[a-f0-9]{32}$/;
const isRecord = (value: unknown): value is RecordValue =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (): never => { throw Error('Invalid Cloudflare Worker target or response'); };

function isWorkerOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const url = URL.parse(value);
  return url?.origin === value && url.protocol === 'https:' && url.port === '' &&
    url.hostname.endsWith('.workers.dev');
}

export function validateWorkerTarget(value: unknown): asserts value is WorkerTarget {
  if (!isRecord(value) || typeof value.accountId !== 'string' || !hexId.test(value.accountId) ||
      value.workerName !== 'ajou-study-hub' || !isWorkerOrigin(value.productionUrl) ||
      !Array.isArray(value.previewUrls) || !value.previewUrls.every(isWorkerOrigin) ||
      new Set([value.productionUrl, ...value.previewUrls]).size !== value.previewUrls.length + 1)
    fail();
}

export function validatePublicSettings(value: unknown): asserts value is PublicDeploymentSettings {
  validateWorkerTarget(value);
  if (Object.keys(value).sort().join(',') !== 'accountId,previewUrls,productionUrl,workerId,workerName' ||
      !('workerId' in value) || typeof value.workerId !== 'string' || !hexId.test(value.workerId) ||
      value.productionUrl !== publicProductionUrl || value.previewUrls.length)
    fail();
}

/** GET-only API. Provider response bodies never become error messages. */
export function cloudflareReader(options: ReadOptions = {}) {
  const token = options.token ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!token) fail();
  const request = options.fetch ?? fetch;
  return async (path: string) => {
    const response = await request('https://api.cloudflare.com/client/v4' + path, {
      headers: { Authorization: 'Bearer ' + token },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return fail();
    const data: unknown = await response.json();
    if (!isRecord(data) || data.success !== true || !('result' in data) ||
        (Array.isArray(data.errors) && data.errors.length)) return fail();
    return data;
  };
}

export async function readWorkerTarget(target: TargetInput, options: ReadOptions = {}): Promise<WorkerInspection> {
  try {
    const expectedId = target.workerId;
    validateWorkerTarget(target);
    if ('workerId' in target) validatePublicSettings(target);
    const get = cloudflareReader(options);
    const base = '/accounts/' + target.accountId;
    const workers = await readCloudflareList(get, base + '/workers/workers');
    const matches = workers.filter(worker => worker.name === target.workerName);
    const id: unknown = matches[0]?.id;
    if (matches.length !== 1 || typeof id !== 'string' || !id || id === target.workerName ||
        (expectedId !== undefined && expectedId !== id)) return fail();
    const { result: worker } = await get(base + '/workers/workers/' + encodeURIComponent(id));
    if (!isRecord(worker) || worker.id !== id || worker.name !== target.workerName ||
        !isRecord(worker.references) || !Array.isArray(worker.references.domains) ||
        worker.references.domains.length) return fail();
    const { result: subdomain } = await get(base + '/workers/scripts/' + target.workerName + '/subdomain');
    const { result: accountSubdomain } = await get(base + '/workers/subdomain');
    if (!isRecord(subdomain) || subdomain.enabled !== true || subdomain.previews_enabled !== false ||
        target.previewUrls.length || !isRecord(accountSubdomain) ||
        typeof accountSubdomain.subdomain !== 'string') return fail();
    const host = `https://${target.workerName}.${accountSubdomain.subdomain}.workers.dev`;
    if (host !== target.productionUrl) return fail();

    const zones = await readCloudflareList(get, '/zones?account.id=' + target.accountId);
    const routes: RecordValue[] = [];
    for (const zone of zones) {
      if (typeof zone.id !== 'string' || !hexId.test(zone.id)) return fail();
      const rows = await readCloudflareList(get, '/zones/' + zone.id + '/workers/routes', 'single');
      if (rows.some(route => route.script === target.workerName ||
          (expectedId !== undefined && route.script !== null && typeof route.script !== 'string')))
        return fail();
      routes.push(...rows);
    }
    return { worker: { ...worker, id }, hosts: [host], exposure: { subdomain, accountSubdomain, routes } };
  } catch {
    throw Error('Cloudflare Worker target could not be verified');
  }
}

const hasOnly = (value: RecordValue, keys: string[]) =>
  Object.keys(value).every(key => keys.includes(key));

export async function readActiveVersion(target: TargetInput, options: ReadOptions = {}): Promise<string> {
  try {
    validateWorkerTarget(target);
    if ('workerId' in target) validatePublicSettings(target);
    const get = cloudflareReader(options);
    const envelope = await get(`/accounts/${target.accountId}/workers/scripts/${target.workerName}/deployments`);
    if (!hasOnly(envelope, ['success', 'errors', 'messages', 'result', 'result_info']) ||
        !Array.isArray(envelope.errors) || envelope.errors.length ||
        (envelope.messages !== undefined && !Array.isArray(envelope.messages))) return fail();
    const { result, result_info: info } = envelope;
    if (!isRecord(result) || !hasOnly(result, ['deployments']) || !Array.isArray(result.deployments) ||
        !result.deployments.length) return fail();
    const count = result.deployments.length;
    if (info !== undefined) {
      if (!isRecord(info) || !hasOnly(info, ['page', 'total_pages', 'count', 'total_count', 'per_page']))
        return fail();
      const { page, total_pages: pages, count: pageCount, total_count: total, per_page: perPage } = info;
      if ((page !== undefined && page !== 1) ||
          (pageCount !== undefined && pageCount !== count) ||
          (pages !== undefined && (!Number.isSafeInteger(pages) || Number(pages) < 1)) ||
          (total !== undefined && (!Number.isSafeInteger(total) || Number(total) < count)) ||
          (perPage !== undefined && (!Number.isSafeInteger(perPage) || Number(perPage) < count)) ||
          (pages === 1 && total !== undefined && total !== count) ||
          (Number(pages) > 1 && (total === count || (perPage !== undefined && perPage !== count))) ||
          (total !== undefined && perPage !== undefined &&
            (count !== Math.min(Number(total), Number(perPage)) ||
              (pages !== undefined && pages !== Math.ceil(Number(total) / Number(perPage))))))
        return fail();
    }

    // The first row on page one is the deployment serving traffic, even when the history continues.
    const current: unknown = result.deployments[0];
    if (!isRecord(current) || !hasOnly(current, ['id', 'strategy', 'versions', 'created_on', 'source', 'author_email', 'annotations']) ||
        typeof current.id !== 'string' || !workerVersionId.test(current.id) || current.strategy !== 'percentage' ||
        [current.created_on, current.source, current.author_email].some(v => v !== undefined && typeof v !== 'string') ||
        (current.annotations !== undefined && (!isRecord(current.annotations) ||
          !hasOnly(current.annotations, ['workers/message', 'workers/triggered_by']) ||
          Object.values(current.annotations).some(v => typeof v !== 'string'))) ||
        !Array.isArray(current.versions) || current.versions.length !== 1) return fail();
    const version: unknown = current.versions[0];
    if (!isRecord(version) || !hasOnly(version, ['version_id', 'percentage']) || version.percentage !== 100 ||
        typeof version.version_id !== 'string' || !workerVersionId.test(version.version_id)) return fail();
    return version.version_id;
  } catch {
    throw Error('Cloudflare active Worker version could not be verified');
  }
}
