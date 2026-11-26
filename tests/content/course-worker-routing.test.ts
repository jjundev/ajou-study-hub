import { expect, test } from 'vitest';
import { boundCourseIds } from '../../config/course-workers.js';
import { serveHubRequest, type HubWorkerEnv } from '../../src/worker/hub.js';
import { courses } from '../../config/courses.js';

const origin = 'https://study.example';
const binding = (fetch: (request: Request) => Response | Promise<Response>) => ({ fetch: async (request: Request) => fetch(request) });
const catalog = (ids: string[]) => Response.json({
  version: 1, courses: courses.filter(c => ids.includes(c.id)).map(({ id, name, repo, semester }) => ({ id, name, repo, semester })),
  groups: [], documents: [],
});

test('forwards encoded paths, conditional headers and the child response', async () => {
  const path = '/content/life-science/%EB%85%B8%ED%8A%B8%201.pdf?download=1';
  const request = new Request(origin + path, { method: 'HEAD', headers: { range: 'bytes=0-127' } });
  const response = await serveHubRequest(request, {
    STUDY_HUB_PROFILE: 'pilot', ASSETS: binding(() => new Response(null, { status: 404 })),
    COURSE_LIFE_SCIENCE: binding(forwarded => {
      expect(forwarded.url).toBe(origin + path);
      expect(forwarded.method).toBe('HEAD');
      expect(forwarded.headers.get('range')).toBe('bytes=0-127');
      return new Response(null, { status: 206, headers: { 'content-type': 'application/pdf' } });
    }),
  });
  expect(response.status).toBe(206);
  expect(response.headers.get('content-type')).toBe('application/pdf');
});

test('isolates invalid and unavailable course catalogs', async () => {
  const env: HubWorkerEnv = {
    STUDY_HUB_PROFILE: 'all', ASSETS: binding(() => { throw Error('unused'); }),
    COURSE_LOGIC_LAB: binding(() => catalog(['logic-lab'])),
    COURSE_LIFE_SCIENCE: binding(() => catalog(['life-science'])),
    COURSE_CIRCUITS_2: binding(() => catalog(['circuits-2'])),
    COURSE_DATA_STRUCTURES: binding(() => catalog(['data-structures'])),
    COURSE_ML_BASICS: binding(() => catalog(['life-science'])),
  };
  const response = await serveHubRequest(new Request(origin + '/catalog.json'), env);
  expect((await response.json()).courses.map((course: { id: string }) => course.id))
    .toEqual(['logic-lab', 'life-science', 'circuits-2', 'data-structures']);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect((await serveHubRequest(new Request(origin + '/catalog.json'), { ASSETS: env.ASSETS, STUDY_HUB_PROFILE: 'all' })).status).toBe(503);
});

test('pilot serves only life science through bindings', async () => {
  expect(boundCourseIds('pilot')).toEqual(['life-science']);
  expect(boundCourseIds('all')).toHaveLength(5);
  const env: HubWorkerEnv = {
    STUDY_HUB_PROFILE: 'pilot',
    ASSETS: binding(() => new Response('legacy')),
    COURSE_LIFE_SCIENCE: binding(() => new Response(null, { status: 404 })),
  };
  expect(await (await serveHubRequest(new Request(origin + '/content/ml-basics/note.html'), env)).text()).toBe('legacy');
  expect((await serveHubRequest(new Request(origin + '/content/life-science/missing.html'), env)).status).toBe(404);
  expect((await serveHubRequest(new Request(origin + '/content/unknown/note.html'), env)).status).toBe(404);
});
