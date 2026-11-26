import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { courses } from '../../config/courses.js';
import type { CourseId } from '../../config/course-workers.js';
import { bindSources, resolveRevisions, SourceBindError, type Revision, type SourceSnapshot } from './sources.js';

export function courseConfiguration(id: string) {
  const config = courses.find(course => course.id === id);
  if (!config) throw new SourceBindError('CI_BIND_REVISIONS_INVALID', 'Unknown course');
  return config;
}

export async function resolveCourseRevision(courseId: CourseId, request: typeof fetch, token: string): Promise<Omit<Revision, 'root'>> {
  return (await resolveRevisions(request, token, [courseConfiguration(courseId)]))[0]!;
}

export async function bindCourseSource(project: string, appSha: string, revision: Revision): Promise<SourceSnapshot> {
  const config = courseConfiguration(revision.courseId);
  const projectRoot = await realpath(project);
  if (resolve(projectRoot, revision.root) !== resolve(projectRoot, '../sources', config.id)) {
    throw new SourceBindError('CI_BIND_ROOT_FAILED', 'Unexpected course checkout path', config.id);
  }
  return bindSources(projectRoot, appSha, [revision], [config]);
}

export async function readCourseSnapshot(project: string, courseId: CourseId, snapshot: SourceSnapshot) {
  const config = courseConfiguration(courseId);
  const revision = snapshot.revisions[0];
  if (snapshot.version !== 1 || !/^[a-f0-9]{40}$/.test(snapshot.appSha) || snapshot.revisions.length !== 1 ||
      !revision || revision.courseId !== courseId || revision.repository !== config.repo || !/^[a-f0-9]{40}$/.test(revision.sha) ||
      revision.root !== resolve(await realpath(project), '../sources', courseId) ||
      snapshot.settingsPath !== resolve(await realpath(project), '.local/ci-sources.json')) {
    throw Error('Invalid pinned course snapshot');
  }
  return { config, revision };
}
