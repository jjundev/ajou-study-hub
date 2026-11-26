import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { boundCourseIds, isCourseId, workerProfile } from '../../config/course-workers.js';
import { courseConfiguration } from './course-source.js';
import { sparsePatterns } from './sparse-source.js';

try {
  const id = process.env.COURSE_ID ?? '';
  const out = process.env.GITHUB_OUTPUT;
  if (!out || !isCourseId(id) || !boundCourseIds(workerProfile(process.env.STUDY_HUB_STATIC_WORKER_PROFILE)).includes(id)) throw Error();
  const course = courseConfiguration(id);
  if (process.argv[2] === 'selection') {
    const patterns = sparsePatterns(course);
    const marker = 'STUDY_HUB_COURSE_SPARSE_END';
    if (patterns.includes(marker)) throw Error();
    await appendFile(out, 'repository=' + course.repo + '\nrepository_name=' + course.repo.split('/')[1] +
      '\nsparse<<' + marker + '\n' + patterns.join('\n') + '\n' + marker + '\n');
  } else if (process.argv[2] === 'revision') {
    const [revision, extra] = JSON.parse(await readFile('.local/revisions.json', 'utf8'));
    if (extra || revision.courseId !== id || revision.repository !== course.repo || !/^[a-f0-9]{40}$/.test(revision.sha)) throw Error();
    revision.root = '../sources/' + id;
    await writeFile('.local/revisions.json', JSON.stringify([revision]));
    await appendFile(out, 'sha=' + revision.sha + '\n');
  } else {
    throw Error();
  }
} catch {
  console.error('CI_COURSE_SELECTION_REJECTED');
  process.exitCode = 1;
}
