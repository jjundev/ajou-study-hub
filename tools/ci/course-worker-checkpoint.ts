import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { isCourseId } from '../../config/course-workers.js';
import type { CourseWorkerCheckpoint } from '../deploy/course-worker-release.js';

const exec = promisify(execFile);
const repository = 'jjundev/ajou-study-hub';

try {
  const id = process.env.COURSE_ID ?? '';
  if (!isCourseId(id) || !process.env.GH_TOKEN) throw Error();
  const { stdout } = await exec('gh', ['run', 'list', '--repo', repository, '--workflow', 'study-hub-update.yml',
    '--branch', 'main', '--status', 'success', '--limit', '60', '--json', 'databaseId,attempt'], { timeout: 30_000, maxBuffer: 64_000 });
  const runs = JSON.parse(stdout) as { databaseId: number; attempt: number }[];
  let checkpoint: CourseWorkerCheckpoint | undefined;
  for (const run of runs) {
    if (!Number.isSafeInteger(run.databaseId) || !Number.isSafeInteger(run.attempt) || run.attempt < 1) throw Error();
    const artifact = 'course-checkpoint-' + id + '-' + run.attempt;
    const { stdout: names } = await exec('gh', ['api', 'repos/' + repository + '/actions/runs/' + run.databaseId + '/artifacts?name=' + artifact,
      '--jq', '.artifacts[] | select(.expired == false) | .name'], { timeout: 15_000, maxBuffer: 8_000 });
    if (names.trim() !== artifact) continue;
    const temp = await mkdtemp(resolve('.local/course-checkpoint-'));
    try {
      await exec('gh', ['run', 'download', String(run.databaseId), '--repo', repository, '--name', artifact, '--dir', temp],
        { timeout: 30_000, maxBuffer: 64_000 });
      const data = await readFile(resolve(temp, 'checkpoint.json'), 'utf8');
      if (Buffer.byteLength(data) > 4096) throw Error();
      checkpoint = JSON.parse(data);
      if (checkpoint?.courseId !== id) throw Error();
      break;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  checkpoint ??= (JSON.parse(process.env.COURSE_BASELINES || '{}') as Record<string, CourseWorkerCheckpoint>)[id];
  if (checkpoint) await writeFile('.local/course-checkpoint.json', JSON.stringify(checkpoint), { flag: 'wx', mode: 0o600 });
} catch {
  console.error('CI_COURSE_CHECKPOINT_UNAVAILABLE');
  process.exitCode = 1;
}
