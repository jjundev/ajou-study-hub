import { boundCourseIds, courseIds, courseWorkers, isCourseId, type CourseId, type StaticWorkerProfile } from '../../config/course-workers.js';
import { catalogSlice, isCatalog, mergeCatalogs } from '../content/catalog-validation.js';
import type { Catalog } from '../content/model.js';

export type AssetBinding = { fetch(request: Request): Promise<Response> };
export type HubWorkerEnv = {
  ASSETS: AssetBinding;
  STUDY_HUB_PROFILE: StaticWorkerProfile;
} & Partial<Record<(typeof courseWorkers)[CourseId]['binding'], AssetBinding>>;

export const routingPath = '/_study-hub/routing.json';
export const routingDescriptor = (profile: StaticWorkerProfile) => ({ schema: 1, profile, courseIds: boundCourseIds(profile) });
const noStore = { 'cache-control': 'private, no-store' };
const unavailable = () => new Response('Course unavailable', { status: 503, headers: noStore });

async function readCatalog(binding: AssetBinding | undefined, url: URL): Promise<Catalog> {
  if (!binding) throw Error('Missing course binding');
  const signal = AbortSignal.timeout(3_000);
  const expired = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  return Promise.race([expired, (async () => {
    const response = await binding.fetch(new Request(new URL('/catalog.json', url), { signal }));
    if (!response.ok) throw Error('Catalog unavailable');
    const catalog: unknown = await response.json();
    if (!isCatalog(catalog)) throw Error('Invalid catalog');
    return catalog;
  })()]);
}

export async function serveHubRequest(request: Request, env: HubWorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const profile = env.STUDY_HUB_PROFILE;
  const bound = boundCourseIds(profile);
  const course = /^\/content\/([^/]+)(?:\/|$)/.exec(url.pathname)?.[1];
  if (course && !isCourseId(course)) return new Response(null, { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const head = request.method === 'HEAD';
  if (url.pathname === routingPath) {
    return new Response(head ? null : JSON.stringify(routingDescriptor(profile)), { headers: { ...noStore, 'content-type': 'application/json' } });
  }
  if (url.pathname === '/catalog.json' && profile !== 'legacy') {
    const staticCatalog = profile === 'pilot' ? readCatalog(env.ASSETS, url) : undefined;
    const slices = await Promise.allSettled(courseIds.map(async id => {
      if (!bound.includes(id)) return catalogSlice(await staticCatalog!, id);
      const catalog = await readCatalog(env[courseWorkers[id].binding], url);
      if (catalog.courses.length !== 1 || catalog.courses[0]?.id !== id) throw Error('Wrong catalog owner');
      return catalogSlice(catalog, id);
    }));
    const catalog = mergeCatalogs(slices.flatMap(slice => slice.status === 'fulfilled' ? [slice.value] : []));
    if (!catalog.courses.length) return unavailable();
    return new Response(head ? null : JSON.stringify(catalog), { headers: { ...noStore, 'content-type': 'application/json' } });
  }
  if (course && isCourseId(course) && bound.includes(course)) {
    try {
      const binding = env[courseWorkers[course].binding];
      return binding ? await binding.fetch(request) : unavailable();
    } catch {
      return unavailable();
    }
  }
  return env.ASSETS.fetch(request);
}

export default { fetch: serveHubRequest };
