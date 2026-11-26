import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundCourseIds, isCourseId, workerProfile, type CourseId, type StaticWorkerProfile } from '../../config/course-workers.js';
import { courses } from '../../config/courses.js';

type UpdateInput = { event: 'push' | 'workflow_dispatch'; mode: 'default' | 'verify'; sourceRepository?: string; profile: StaticWorkerProfile };
export type UpdateLane = { verifyOnly: boolean } & (
  { kind: 'legacy' } | { kind: 'hub'; sourceMode: 'legacy-bundle' | 'ui-only' } | { kind: 'course'; courseId: CourseId }
);

export function selectUpdateLane({ event, mode, sourceRepository, profile }: UpdateInput): UpdateLane {
  workerProfile(profile);
  if ((event !== 'push' && event !== 'workflow_dispatch') || (mode !== 'default' && mode !== 'verify') ||
      (event === 'push' && sourceRepository)) throw Error('Invalid update request');
  const courseId = sourceRepository ? courses.find(course => course.repo === sourceRepository)?.id : undefined;
  if (sourceRepository && (!courseId || !isCourseId(courseId))) throw Error('Unsupported source repository');
  const verifyOnly = mode === 'verify';
  if (profile === 'legacy') return { kind: 'legacy', verifyOnly };
  if (courseId && isCourseId(courseId) && boundCourseIds(profile).includes(courseId)) return { kind: 'course', courseId, verifyOnly };
  return { kind: 'hub', verifyOnly, sourceMode: profile === 'pilot' ? 'legacy-bundle' : 'ui-only' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw Error();
    const event = process.env.GITHUB_EVENT_NAME;
    const mode = process.env.MODE || 'default';
    if ((event !== 'push' && event !== 'workflow_dispatch') || (mode !== 'default' && mode !== 'verify')) throw Error();
    const profile = workerProfile(process.env.STUDY_HUB_STATIC_WORKER_PROFILE || undefined);
    const selected = selectUpdateLane({ event, mode, profile, sourceRepository: process.env.SOURCE_REPOSITORY });
    const values = { ...selected, courseId: 'courseId' in selected ? selected.courseId : '', sourceMode: 'sourceMode' in selected ? selected.sourceMode : '' };
    await appendFile(output, 'profile=' + profile + '\n' + Object.entries(values).map(([key, value]) => key + '=' + value + '\n').join(''));
  } catch {
    console.error('CI_UPDATE_SELECTION_REJECTED');
    process.exitCode = 1;
  }
}
