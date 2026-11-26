import { courseWorkers, isCourseId, type CourseId } from '../../config/course-workers.js';
import { readCloudflareList } from './cloudflare-list.js';
import { cloudflareReader, readScriptDeployment, type ActiveDeployment, type ReadOptions } from './worker-target.js';

const hexId = /^[a-f0-9]{32}$/;
export type CourseWorkerSettings = { accountId: string; workerIds: Partial<Record<CourseId, string>> };
export type CourseWorkerTarget = { accountId: string; courseId: CourseId; workerName: string; workerId: string; active: ActiveDeployment };

export function parseCourseWorkerSettings(value: unknown): CourseWorkerSettings {
  const settings = value as CourseWorkerSettings;
  if (!settings || typeof settings !== 'object' || Object.keys(settings).sort().join(',') !== 'accountId,workerIds' ||
      typeof settings.accountId !== 'string' || !hexId.test(settings.accountId) ||
      !settings.workerIds || typeof settings.workerIds !== 'object' || Array.isArray(settings.workerIds) ||
      !Object.entries(settings.workerIds).every(([id, worker]) => isCourseId(id) && typeof worker === 'string' && hexId.test(worker)) ||
      new Set(Object.values(settings.workerIds)).size !== Object.keys(settings.workerIds).length) {
    throw Error('Invalid course Worker settings');
  }
  return settings;
}

export async function findCourseWorkerId(accountId: string, courseId: CourseId, options?: ReadOptions): Promise<string | undefined> {
  if (!hexId.test(accountId) || !isCourseId(courseId)) throw Error('Invalid course Worker identity');
  const get = cloudflareReader(options);
  const rows = await readCloudflareList(get, '/accounts/' + accountId + '/workers/workers');
  const matches = rows.filter(row => row.name === courseWorkers[courseId].name);
  if (!matches.length) return undefined;
  const id = matches[0]?.id;
  if (matches.length !== 1 || typeof id !== 'string' || !hexId.test(id)) throw Error('Ambiguous course Worker identity');
  return id;
}

export async function readCourseWorkerTarget(courseId: CourseId, settings: CourseWorkerSettings, options?: ReadOptions): Promise<CourseWorkerTarget> {
  const { accountId, workerIds } = parseCourseWorkerSettings(settings);
  const workerId = workerIds[courseId];
  if (!workerId || await findCourseWorkerId(accountId, courseId, options) !== workerId) throw Error('Course Worker identity mismatch');
  const workerName = courseWorkers[courseId].name;
  const get = cloudflareReader(options);
  const base = '/accounts/' + accountId;
  const { result: worker } = await get(base + '/workers/workers/' + workerId);
  const { result: exposure } = await get(base + '/workers/scripts/' + workerName + '/subdomain');
  if (!worker || typeof worker !== 'object' || !('id' in worker) || worker.id !== workerId ||
      !('name' in worker) || worker.name !== workerName ||
      !('references' in worker) || !worker.references || typeof worker.references !== 'object' ||
      !('domains' in worker.references) || !Array.isArray(worker.references.domains) || worker.references.domains.length ||
      !exposure || typeof exposure !== 'object' || !('enabled' in exposure) || exposure.enabled !== false ||
      !('previews_enabled' in exposure) || exposure.previews_enabled !== false) throw Error('Course Worker exposure could not be verified');
  const zones = await readCloudflareList(get, '/zones?account.id=' + accountId);
  for (const zone of zones) {
    if (typeof zone.id !== 'string' || !hexId.test(zone.id)) throw Error('Invalid Cloudflare zone');
    const routes = await readCloudflareList(get, '/zones/' + zone.id + '/workers/routes', 'single');
    if (routes.some(route => route.script === workerName || (route.script !== null && typeof route.script !== 'string'))) {
      throw Error('Course Worker has a public route');
    }
  }
  return { accountId, courseId, workerId, workerName, active: await readScriptDeployment(accountId, workerName, options) };
}
