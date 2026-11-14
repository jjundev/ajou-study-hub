import { execFile } from 'node:child_process';
import { appendFile, lstat, mkdtemp, open, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { courses } from '../../config/courses.js';
import { isCourseHashes, type PublicInputFingerprint } from './public-input-fingerprint.js';
import { digest, isRecord } from '../deploy/access-policy.js';
import { courseOutputHashes, isCourseCoverage, isolatedRuntimeCourses, parseCourseRelease, selectCourseRelease,
  type CourseCoverage, type CourseRelease } from '../course-release.js';
import type { BuildReport } from '../content/report.js';
import type { Catalog } from '../../src/content/model.js';
import {
  readActiveDeployment, readWorkerTarget, validatePublicSettings, workerVersionId,
  type ActiveDeployment, type PublicDeploymentSettings,
} from '../deploy/worker-target.js';

export type PublicCheckpoint = {
  runId: string;
  attempt: number;
  appSha: string;
  inputHash: string;
  targetHash: string;
  deploymentId: string;
  versionId: string;
  bundleHash: string;
} & ({ schema: 1; courseHashes?: never; coverage?: never } |
  { schema: 2; courseHashes: PublicInputFingerprint['courseHashes']; coverage?: never } |
  { schema: 3; courseHashes: PublicInputFingerprint['courseHashes']; coverage: CourseCoverage });
type Lookup = {
  gh: (args: string[], cwd?: string) => Promise<string>;
  currentRunId: string;
  scratch: string;
};

const exec = promisify(execFile);
const repo = ['-R', 'jjundev/ajou-study-hub'];
const workflow = 'study-hub-update.yml';
const publishName = 'Publish the verified bundle to the public Worker';
const filename = 'public-checkpoint.json';
const limit = 4096;
const sha = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
const valid = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const runIdentifier = (value: unknown): value is string => valid(value, /^[1-9]\d*$/) && positive(Number(value));
const invalid = () => new Error('CI_PUBLIC_CHECKPOINT_UNAVAILABLE');

function checkedCheckpoint(value: unknown): PublicCheckpoint {
  if (!isRecord(value) || (value.schema !== 1 && value.schema !== 2 && value.schema !== 3) ||
      !runIdentifier(value.runId) || !positive(value.attempt) ||
      !valid(value.appSha, sha) || !valid(value.inputHash, sha256) ||
      !valid(value.targetHash, sha256) || !valid(value.bundleHash, sha256) ||
      !valid(value.deploymentId, workerVersionId) || !valid(value.versionId, workerVersionId)) throw invalid();
  const fields = ['appSha', 'attempt', 'bundleHash', 'deploymentId', 'inputHash', 'runId', 'schema', 'targetHash', 'versionId'];
  if (value.schema !== 1) {
    if (!isCourseHashes(value.courseHashes)) throw invalid();
    fields.push('courseHashes');
  }
  if (value.schema === 3) {
    if (!isCourseCoverage(value.coverage)) throw invalid();
    fields.push('coverage');
  }
  if (Object.keys(value).length !== fields.length || !fields.every(field => Object.hasOwn(value, field))) throw invalid();
  return value as PublicCheckpoint;
}

export function checkpointFromReceipt(input: {
  runId: string; attempt: number; appSha: string; inputHash: string;
  courseHashes?: PublicInputFingerprint['courseHashes'];
  coverage?: CourseCoverage;
  target: PublicDeploymentSettings; receipt: unknown;
}): PublicCheckpoint {
  const { runId, attempt, appSha, inputHash, courseHashes, coverage, target, receipt } = input;
  validatePublicSettings(target);
  if (!isRecord(receipt) || receipt.status !== 'published-public-verified' ||
      receipt.versionId !== receipt.currentVersionId ||
      receipt.url !== target.productionUrl || receipt.workerId !== target.workerId ||
      !positive(receipt.checked) || receipt.checked < 3 || receipt.checked > 20000) throw invalid();
  return checkedCheckpoint({
    ...(coverage ? { schema: 3, courseHashes, coverage } : courseHashes ? { schema: 2, courseHashes } : { schema: 1 }),
    runId, attempt, appSha, inputHash, targetHash: digest(target),
    deploymentId: receipt.deploymentId, versionId: receipt.versionId, bundleHash: receipt.bundleHash,
  });
}

export async function comparePublicInputs(input: {
  checkpoint: PublicCheckpoint | null; appSha: string; inputHash: string;
  courseHashes?: PublicInputFingerprint['courseHashes'];
  target: PublicDeploymentSettings; readActive: () => Promise<ActiveDeployment>;
}): Promise<{ match: boolean; changedCourses: string[] }> {
  const unavailable = { match: false, changedCourses: [] };
  try {
    const { appSha, inputHash, courseHashes, target, readActive } = input;
    validatePublicSettings(target);
    const checkpoint = checkedCheckpoint(input.checkpoint);
    if (checkpoint.appSha !== appSha || checkpoint.targetHash !== digest(target)) return unavailable;
    const match = checkpoint.inputHash === inputHash;
    const previousHashes = checkpoint.courseHashes;
    const changedCourses = previousHashes && isCourseHashes(courseHashes)
      ? courses.map(course => course.id).filter(id => previousHashes[id] !== courseHashes[id]) : [];
    if (match && changedCourses.length) return unavailable;
    if (!match && (!changedCourses.length || changedCourses.length === courses.length)) return unavailable;
    const active = await readActive();
    return active.deploymentId === checkpoint.deploymentId && active.versionId === checkpoint.versionId
      ? { match, changedCourses } : unavailable;
  } catch {
    return unavailable;
  }
}

export function courseReleaseFromCheckpoint(checkpoint: PublicCheckpoint, changedCourses: string[]): CourseRelease | undefined {
  const coverage = checkpoint.coverage;
  if (!coverage || courses.some(({ id }) => !changedCourses.includes(id) && !coverage.isolatedCourses.includes(id))) return;
  // Leave the workflow's one-hour timeout for build, verification and upload before expiry.
  if (Date.now() - Date.parse(coverage.fullVerifiedAt) > 23 * 60 * 60 * 1000) return;
  return parseCourseRelease(JSON.stringify({
    courses: changedCourses,
    baseline: { deploymentId: checkpoint.deploymentId, versionId: checkpoint.versionId },
    outputHashes: coverage.outputHashes,
    fullVerifiedAt: coverage.fullVerifiedAt,
  }));
}

async function readSmallFile(path: string, max = limit): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > max || await realpath(path) !== path) throw invalid();
  const file = await open(path, 'r');
  try {
    const data = Buffer.alloc(max + 1);
    let length = 0;
    while (length <= max) {
      const { bytesRead } = await file.read(data, length, data.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > max) throw invalid();
    return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, length));
  } finally {
    await file.close();
  }
}

type CompletedRun = { id: string; attempt: number; appSha: string; conclusion: string; updatedAt: number };
function completedRuns(value: unknown, currentRunId: string): CompletedRun[] {
  if (!Array.isArray(value) || value.length > 20) throw invalid();
  const seen = new Set<number>();
  const runs: CompletedRun[] = [];
  for (const row of value) {
    if (!isRecord(row) || !positive(row.databaseId) || seen.has(row.databaseId) || row.headBranch !== 'main' ||
        typeof row.status !== 'string') throw invalid();
    seen.add(row.databaseId);
    const id = String(row.databaseId);
    if (id === currentRunId || row.status !== 'completed') continue;
    if (!positive(row.attempt) || !valid(row.headSha, sha) ||
        typeof row.conclusion !== 'string' || !row.conclusion || typeof row.updatedAt !== 'string') throw invalid();
    const updatedAt = Date.parse(row.updatedAt);
    if (!Number.isFinite(updatedAt)) throw invalid();
    runs.push({ id, attempt: row.attempt, appSha: row.headSha, conclusion: row.conclusion, updatedAt });
  }
  runs.sort((a, b) => b.updatedAt - a.updatedAt);
  return runs;
}

/** Treat only a confirmed skipped publication as safe to pass over. */
function publication(value: unknown): 'verified' | 'skipped' {
  if (!isRecord(value) || !Array.isArray(value.jobs) || value.jobs.length !== 1) throw invalid();
  const job: unknown = value.jobs[0];
  if (!isRecord(job) || job.name !== 'verify' || job.status !== 'completed' ||
      !Array.isArray(job.steps) || !job.steps.every(isRecord)) throw invalid();
  if (job.conclusion === 'skipped' && job.steps.length === 0) return 'skipped';
  const steps = job.steps.filter(step => step.name === publishName);
  if (steps.length !== 1 || steps[0]!.status !== 'completed') throw invalid();
  if (steps[0]!.conclusion === 'skipped') return 'skipped';
  const saved = job.steps.filter(step => step.name === 'Confirm the public deployment checkpoint was saved');
  if (steps[0]!.conclusion !== 'success' || job.conclusion !== 'success' ||
      saved.length !== 1 || saved[0]!.status !== 'completed' || saved[0]!.conclusion !== 'success') throw invalid();
  return 'verified';
}

export async function readPreviousCheckpoint(deps: Lookup): Promise<PublicCheckpoint | null> {
  const { gh, currentRunId, scratch } = deps;
  try {
    if (!runIdentifier(currentRunId)) throw invalid();
    const runs = completedRuns(JSON.parse(await gh([
      'run', 'list', ...repo, '--workflow', workflow, '--branch', 'main', '--limit', '20',
      '--json', 'databaseId,attempt,headSha,headBranch,status,conclusion,updatedAt',
    ])), currentRunId);
    for (const [index, run] of runs.entries()) {
      if (run.updatedAt === runs[index + 1]?.updatedAt) throw invalid();
      const status = publication(JSON.parse(await gh(['run', 'view', run.id, ...repo,
        '--attempt', String(run.attempt), '--json', 'jobs'])));
      if (status === 'skipped') {
        // A rerun may have published in an earlier attempt even when this attempt skipped.
        if (run.attempt !== 1) throw invalid();
        continue;
      }
      if (run.conclusion !== 'success') throw invalid();
      const parent = await realpath(scratch);
      const directory = await mkdtemp(resolve(parent, 'study-hub-public-checkpoint-'));
      try {
        await gh(['run', 'download', run.id, ...repo, '-n', 'public-checkpoint-' + run.attempt, '-D', directory], directory);
        const entries = await readdir(directory);
        if (entries.length !== 1 || entries[0] !== filename) throw invalid();
        const checkpoint = checkedCheckpoint(JSON.parse(await readSmallFile(resolve(directory, filename))));
        if (checkpoint.runId !== run.id || checkpoint.attempt !== run.attempt || checkpoint.appSha !== run.appSha)
          throw invalid();
        return checkpoint;
      } finally {
        if (dirname(directory) !== parent || await realpath(directory) !== directory) throw invalid();
        await rm(directory, { recursive: true, force: true });
      }
    }
  } catch {
    return null;
  }
  return null;
}

function settings(): PublicDeploymentSettings {
  const text = process.env.STUDY_HUB_PUBLIC_DEPLOYMENT_SETTINGS;
  if (!text || Buffer.byteLength(text) > limit) throw invalid();
  const target: unknown = JSON.parse(text);
  validatePublicSettings(target);
  return target;
}

async function inputFingerprint(scratch: string): Promise<PublicInputFingerprint> {
  const value: unknown = JSON.parse(await readSmallFile(resolve(scratch, 'study-hub-public-input.json')));
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'courseHashes,inputHash' ||
      !valid(value.inputHash, sha256) || !isCourseHashes(value.courseHashes)) throw invalid();
  return { inputHash: value.inputHash, courseHashes: value.courseHashes };
}

async function compare(): Promise<void> {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw invalid();
  let match: PublicCheckpoint | null = null;
  let changedCourses: string[] = [];
  let release: ReturnType<typeof parseCourseRelease>;
  try {
    const { GITHUB_RUN_ID: currentRunId, GITHUB_SHA: appSha, RUNNER_TEMP: scratch,
      CLOUDFLARE_READ_TOKEN: token, GH_TOKEN, ...cliEnv } = process.env;
    if (!runIdentifier(currentRunId) || !valid(appSha, sha) || !scratch || !token || !GH_TOKEN ||
        process.env.GITHUB_RUN_ATTEMPT !== '1') throw invalid();
    const target = settings();
    const { inputHash, courseHashes } = await inputFingerprint(scratch);
    const budget = AbortSignal.timeout(30000);
    const checkpoint = await readPreviousCheckpoint({
      currentRunId, scratch,
      gh: async (args, cwd) => (await exec('gh', args, {
        cwd, signal: budget, maxBuffer: 1024 ** 2,
        env: { ...cliEnv, GH_TOKEN, GH_PROMPT_DISABLED: '1' },
      })).stdout,
    });
    const policy = process.env.COURSE_VERIFICATION;
    const decision = await comparePublicInputs({
      checkpoint, appSha, inputHash, target,
      courseHashes: policy === 'observe' || policy === 'apply' ? courseHashes : undefined,
      readActive: async () => {
        const timeout = AbortSignal.timeout(30000);
        const api = { token, fetch: ((url, options) => fetch(url, {
          ...options, signal: options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
        })) satisfies typeof fetch };
        await readWorkerTarget(target, api);
        return readActiveDeployment(target, api);
      },
    });
    if (decision.match) match = checkpoint;
    changedCourses = decision.changedCourses;
    if (policy === 'apply' && checkpoint && changedCourses.length)
      release = courseReleaseFromCheckpoint(checkpoint, changedCourses);
  } catch {
    // Comparison is optional. Provider output and local paths stay out of logs.
  }
  if (!match) console.log('CI_PUBLIC_CHECKPOINT_NO_MATCH');
  await appendFile(output, match ? 'bundle_hash=' + match.bundleHash + '\nmatch=true\n' : 'match=false\n');
  if (changedCourses.length) await appendFile(output, 'changed_courses=' + changedCourses.join(',') + '\n');
  if (release) await appendFile(output, 'course_release=' + JSON.stringify(release) + '\n');
}

async function readCoverage(receipt: unknown): Promise<CourseCoverage | undefined> {
  if (!isRecord(receipt)) throw invalid();
  const proof = JSON.parse(await readFile('.reports/verification.json', 'utf8'));
  const manifest = JSON.parse(await readFile('.reports/app-build.json', 'utf8')) as BuildReport;
  const catalog = JSON.parse(await readFile('dist/catalog.json', 'utf8')) as Catalog;
  if (proof.passed !== true || proof.deploymentEligible !== true ||
      proof.bundleHash !== receipt.bundleHash || manifest.bundleHash !== receipt.bundleHash ||
      proof.catalogHash !== receipt.catalogHash) throw invalid();
  const observed = isolatedRuntimeCourses(catalog.documents, proof.documents, proof.observations);
  const outputHashes = courseOutputHashes(manifest.outputs);
  if (proof.scope === 'actual-app-runtime') {
    return { outputHashes, isolatedCourses: observed, fullVerifiedAt: proof.createdAt };
  }
  const release = selectCourseRelease(parseCourseRelease(process.env.COURSE_RELEASE), manifest.outputs);
  if (proof.scope !== 'changed-course-runtime' || !release ||
      JSON.stringify(proof.courseRelease) !== JSON.stringify(release)) return;
  const isolatedCourses = courses.map(({ id }) => id)
    .filter(id => !release.courses.includes(id) || observed.includes(id));
  return { outputHashes, isolatedCourses, fullVerifiedAt: release.fullVerifiedAt };
}

async function record(): Promise<void> {
  const { RUNNER_TEMP: scratch, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: attempt,
    GITHUB_SHA: appSha, EXPECTED_PUBLIC_INPUT_HASH: expected } = process.env;
  if (!scratch || !runIdentifier(runId) || !runIdentifier(attempt) || !valid(appSha, sha)) throw invalid();
  const { inputHash, courseHashes } = await inputFingerprint(scratch);
  if (inputHash !== expected) throw invalid();
  const reports = resolve('.reports');
  const receipt = JSON.parse(await readSmallFile(resolve(reports, 'public-release.json')));
  const coverage = await readCoverage(receipt).catch(() => undefined);
  const checkpoint = checkpointFromReceipt({ runId, attempt: Number(attempt), appSha, inputHash, courseHashes, coverage, target: settings(), receipt });
  await writeFile(resolve(reports, filename), JSON.stringify(checkpoint) + '\n', { flag: 'wx', mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void (async () => {
    if (process.argv.length !== 3) throw invalid();
    if (process.argv[2] === 'record') await record();
    else if (process.argv[2] === 'compare') await compare();
    else throw invalid();
  })().catch(() => {
    console.error('CI_PUBLIC_CHECKPOINT_UNAVAILABLE');
    process.exitCode = 1;
  });
}
