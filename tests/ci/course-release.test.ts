import { expect, test } from 'vitest';
import { courses } from '../../config/courses.js';
import {
  courseOutputHashes, isolatedRuntimeCourses, parseCourseRelease, selectCourseRelease,
} from '../../tools/course-release.js';

const all = courses.map(course => course.id);
const outputs = all.map((id, index) => ({
  path: `content/${id}/index.html`, sha256: String(index).repeat(64), size: index + 1,
}));
const plan = {
  courses: ['circuits-2'], fullVerifiedAt: new Date().toISOString(),
  baseline: { deploymentId: '11111111-1111-1111-1111-111111111111', versionId: '22222222-2222-2222-2222-222222222222' },
  outputHashes: courseOutputHashes(outputs),
};

test('uses a scoped release only when every omitted course still has identical generated files', () => {
  expect(parseCourseRelease(JSON.stringify(plan))).toEqual(plan);
  expect(selectCourseRelease(plan, outputs)).toEqual(plan);
  expect(selectCourseRelease(plan, [...outputs].reverse())).toEqual(plan);
  expect(selectCourseRelease(plan, outputs.filter(row => !row.path.includes('/circuits-2/')))).toEqual(plan);
  expect(selectCourseRelease(plan, outputs.slice(1))).toBeUndefined();
  expect(selectCourseRelease(plan, [...outputs, { ...outputs[0]!, path: 'content/logic-lab/new.js' }])).toBeUndefined();
  expect(selectCourseRelease(plan, [{ ...outputs[0]!, size: 100 }, ...outputs.slice(1)])).toBeUndefined();
});

test.each([
  { courses: [] }, { courses: all }, { courses: ['circuits-2', 'circuits-2'] }, { courses: ['unknown'] },
  { courses: ['ml-basics', 'circuits-2'] }, { baseline: null }, { outputHashes: {} },
  { fullVerifiedAt: '2020-01-01T00:00:00.000Z' },
])('falls back when the release plan is unavailable or invalid %#', change => {
  expect(parseCourseRelease(JSON.stringify({ ...plan, ...change }))).toBeUndefined();
});

test('requires own-course browser traffic for a course to be inherited', () => {
  const base = 'http://127.0.0.1:1234';
  const docs = [
    { id: 'own', courseId: 'logic-lab', url: '/content/logic-lab/index.html' },
    { id: 'cross', courseId: 'circuits-2', url: '/content/circuits-2/index.html' },
    { id: 'common', courseId: 'ml-basics', url: '/content/ml-basics/index.html' },
    { id: 'public', courseId: 'data-structures', url: '/content/data-structures/index.html' },
    { id: 'missing', courseId: 'life-science', url: '/content/life-science/index.html' },
  ];
  const report = docs.slice(0, -1).map((doc, index) => ({
    documentId: doc.id, pendingRequests: [], responses: [base + doc.url, [
      'https://cdn.example.net/lib.js', 'http://localhost:1234/content/logic-lab/file.js', base + '/catalog.json',
      'http://ajou-study-hub.johnshin617.workers.dev/content/data-structures/index.html',
    ][index]!].map(url => ({ url, status: 200 })),
  }));
  expect(isolatedRuntimeCourses(docs, report)).toEqual(['logic-lab']);
});
