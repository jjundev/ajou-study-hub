import { courses } from '../config/courses.js';
import type { DocumentInfo } from '../src/content/model.js';
import type { BuildReport } from './content/report.js';
import { digest, isRecord } from './deploy/access-policy.js';
import { publicProductionUrl, workerVersionId, type ActiveDeployment } from './deploy/worker-target.js';
import type { LoadEvidence, Observation } from './verify-content.js';

const courseIds = courses.map(course => course.id);
const hashPattern = /^[a-f0-9]{64}$/;
const productionHost = new URL(publicProductionUrl).hostname;
const loopbackHost = /^(?:127\.|0\.0\.0\.0$|\[::1\]$|localhost\.?$)/i;

export type CourseCoverage = {
  outputHashes: Record<string, string>;
  isolatedCourses: string[];
  fullVerifiedAt: string;
};

export type CourseRelease = Pick<CourseCoverage, 'outputHashes' | 'fullVerifiedAt'> & {
  courses: string[];
  baseline: ActiveDeployment;
};

function orderedCourses(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(id => typeof id === 'string' && courseIds.includes(id)) &&
    value.join(',') === courseIds.filter(id => value.includes(id)).join(',');
}

function validCoverage(value: Record<string, unknown>) {
  const hashes = value.outputHashes;
  return typeof value.fullVerifiedAt === 'string' && Number.isFinite(Date.parse(value.fullVerifiedAt)) &&
    isRecord(hashes) && Object.keys(hashes).length === courseIds.length &&
    courseIds.every(id => typeof hashes[id] === 'string' && hashPattern.test(hashes[id]));
}

export function isCourseCoverage(value: unknown): value is CourseCoverage {
  return isRecord(value) && Object.keys(value).length === 3 && validCoverage(value) && orderedCourses(value.isolatedCourses);
}

export function parseCourseRelease(text: string | undefined): CourseRelease | undefined {
  if (!text || text.length > 4096) return;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || Object.keys(value).length !== 4 || !validCoverage(value) ||
        !orderedCourses(value.courses) || !value.courses.length || value.courses.length >= courseIds.length ||
        !isRecord(value.baseline) || Object.keys(value.baseline).length !== 2 ||
        ![value.baseline.deploymentId, value.baseline.versionId].every(id => typeof id === 'string' && workerVersionId.test(id))) return;
    const age = Date.now() - Date.parse(value.fullVerifiedAt as string);
    if (age < 0 || age > 86400000) return;
    return value as CourseRelease;
  } catch { return; }
}

export function courseOutputHashes(outputs: BuildReport['outputs']): Record<string, string> {
  return Object.fromEntries(courseIds.map(id => {
    const rows = outputs.filter(row => row.path.startsWith(`content/${id}/`))
      .sort((left, right) => left.path < right.path ? -1 : Number(left.path > right.path));
    return [id, digest(rows.map(({ path, sha256, size }) => [path, sha256, size]))];
  }));
}

export function selectCourseRelease(plan: CourseRelease | undefined, outputs: BuildReport['outputs']) {
  if (!plan) return;
  const hashes = courseOutputHashes(outputs);
  return courseIds.every(id => plan.courses.includes(id) || plan.outputHashes[id] === hashes[id]) ? plan : undefined;
}

// A previous startup probe may only be inherited when all its local traffic stayed in this course.
export function isolatedRuntimeCourses(
  documents: Pick<DocumentInfo, 'id' | 'courseId' | 'url'>[], rows: LoadEvidence[], observations: Observation[] = [],
) {
  const evidence = new Map(rows.map(row => [row.documentId, row]));
  return courseIds.filter(id => {
    const owned = documents.filter(doc => doc.courseId === id);
    return owned.length > 0 && owned.every(doc => {
      const row = evidence.get(doc.id);
      if (!row || row.pendingRequests?.length !== 0) return false;
      const urls = row.responses.map(({ url }) => URL.parse(url));
      const observed = observations.filter(item => item.documentId === doc.id).map(({ target }) => URL.parse(target));
      const loaded = row.responses.some(({ status }, index) =>
        status === 200 && urls[index]?.hostname === '127.0.0.1' && urls[index]?.pathname === doc.url);
      return loaded &&
        [...urls, ...observed].every(url => url && url.hostname.replace(/\.$/, '') !== productionHost &&
          (!loopbackHost.test(url.hostname) ||
            (url.hostname === '127.0.0.1' && url.pathname.startsWith(`/content/${id}/`))));
    });
  });
}
