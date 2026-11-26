import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isCourseId, type CourseId } from '../../config/course-workers.js';
import { courseWorkerPaths } from './course-build.js';
import type { CourseWorkerCheckpoint } from '../deploy/course-worker-release.js';
import { publicProductionUrl, workerVersionId } from '../deploy/worker-target.js';

const repository = 'jjundev/ajou-study-hub';
const origin = 'https://api.github.com/repos/' + repository;
const task = 'study-hub-verified-course';
const writer = 'github-actions[bot]';

function isCheckpoint(value: unknown, id: CourseId): value is CourseWorkerCheckpoint {
  const row = value as CourseWorkerCheckpoint;
  return !!row && row.courseId === id && /^[a-f0-9]{32}$/.test(row.workerId) &&
    workerVersionId.test(row.versionId) && /^[a-f0-9]{40}$/.test(row.sourceSha) &&
    /^[a-f0-9]{64}$/.test(row.bundleHash) && /^[a-f0-9]{64}$/.test(row.catalogHash);
}

async function api(path: string, data?: object) {
  const response = await fetch(origin + path, {
    method: data ? 'POST' : 'GET', body: data ? JSON.stringify(data) : undefined, redirect: 'error',
    headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Error();
  return response.json();
}

try {
  const id = process.env.COURSE_ID ?? '';
  if (!isCourseId(id) || !process.env.GH_TOKEN || process.env.GITHUB_REPOSITORY !== repository ||
      process.env.GITHUB_REF !== 'refs/heads/main') throw Error();
  const environment = 'study-hub-' + id;
  if (process.argv[2] === 'load') {
    const entries = await api('/deployments?per_page=100&environment=' + environment + '&task=' + task);
    if (!Array.isArray(entries)) throw Error();
    const checkpoints: CourseWorkerCheckpoint[] = [];
    const candidates = entries.filter(row => row && row.creator?.login === writer && row.task === task &&
      row.environment === environment && Number.isSafeInteger(row.id) && row.id > 0 && isCheckpoint(row.payload, id));
    for (const entry of candidates) {
      const statuses = await api('/deployments/' + entry.id + '/statuses?per_page=1');
      if (statuses[0]?.state === 'success' && statuses[0]?.creator?.login === writer) checkpoints.push(entry.payload);
      if (checkpoints.length >= 5) break;
    }
    const seed = JSON.parse(process.env.COURSE_BASELINES || '{}')[id];
    if (isCheckpoint(seed, id)) checkpoints.push(seed);
    await writeFile('.local/course-checkpoints.json', JSON.stringify(checkpoints), { flag: 'wx', mode: 0o600 });
  } else if (process.argv[2] === 'save') {
    const sha = process.env.GITHUB_SHA ?? '';
    const run = process.env.GITHUB_RUN_ID ?? '';
    const attempt = process.env.GITHUB_RUN_ATTEMPT ?? '';
    if (!/^[a-f0-9]{40}$/.test(sha) || !/^\d+$/.test(run) || !/^\d+$/.test(attempt)) throw Error();
    const reportDir = courseWorkerPaths(process.cwd(), id).reportDir;
    const checkpoint: unknown = JSON.parse(await readFile(resolve(reportDir, 'checkpoint.json'), 'utf8'));
    const receipt = JSON.parse(await readFile(resolve(reportDir, 'publish-receipt.json'), 'utf8'));
    if (!isCheckpoint(checkpoint, id) || !['verified', 'unchanged'].includes(receipt.status) ||
        receipt.active?.versionId !== checkpoint.versionId) throw Error();
    const deployment = await api('/deployments', { ref: sha, task, auto_merge: false, required_contexts: [],
      environment, description: 'Public study course verified', production_environment: true, payload: checkpoint });
    if (!Number.isSafeInteger(deployment.id) || deployment.id < 1 || deployment.sha !== sha ||
        deployment.creator?.login !== writer || deployment.environment !== environment) throw Error();
    await api('/deployments/' + deployment.id + '/statuses', { state: 'success', auto_inactive: false,
      environment, environment_url: publicProductionUrl, log_url: 'https://github.com/' + repository + '/actions/runs/' + run + '/attempts/' + attempt });
  } else {
    throw Error();
  }
} catch {
  console.error('CI_COURSE_CHECKPOINT_UNAVAILABLE');
  process.exitCode = 1;
}
