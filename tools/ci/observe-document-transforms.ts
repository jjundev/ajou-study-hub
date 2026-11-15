import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, statfs, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { finishAppBuild } from '../app-build.js';
import { buildContent } from '../content/build.js';
import type { BuildReport } from '../content/report.js';
import { isRecord } from '../deploy/access-policy.js';
import { validatePublicSettings } from '../deploy/worker-target.js';
import { assertCurrentBundle } from '../runtime-server.js';
import { readSourceSettings } from '../source-binding.js';
import {
  createPublicTransformRestore, parseTransformIndex, summarizeTransformObservation,
  transformIndexFilename, transformIndexLimit,
} from './document-transform-reuse.js';

const exec = promisify(execFile);
const repo = 'jjundev/ajou-study-hub';
const project = fileURLToPath(new URL('../../', import.meta.url));
const unavailable = () => Error('CI_DOCUMENT_TRANSFORM_OBSERVATION_UNAVAILABLE');
const isRunNumber = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value);
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function baselineReference() {
  const text = process.env.DOCUMENT_TRANSFORM_BASELINE;
  if (!text || text.length > 512) throw unavailable();
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || Object.keys(value).length !== 5 || !isRunNumber(value.runId) ||
      value.runId === process.env.GITHUB_RUN_ID || typeof value.attempt !== 'number' || !isRunNumber(String(value.attempt)) ||
      typeof value.appSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.appSha) || value.appSha !== process.env.GITHUB_SHA ||
      !isDigest(value.bundleHash) || !isDigest(value.transformIndexHash)) throw unavailable();
  return { runId: value.runId, attempt: value.attempt, appSha: value.appSha,
    bundleHash: value.bundleHash, transformIndexHash: value.transformIndexHash };
}

async function tempRoot(): Promise<string> {
  if (!process.env.RUNNER_TEMP) throw unavailable();
  return realpath(resolve(process.env.RUNNER_TEMP));
}

async function readMetadata(path: string, limit: number): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > limit || await realpath(path) !== path) throw unavailable();
  const data = await readFile(path);
  if (data.byteLength !== stat.size) throw unavailable();
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}

function authenticatedIndex(text: string, reference: ReturnType<typeof baselineReference>) {
  if (createHash('sha256').update(text).digest('hex') !== reference.transformIndexHash) throw unavailable();
  return parseTransformIndex(text, reference.appSha, reference.bundleHash);
}

async function cleanScratch(path: string, parent: string) {
  if (dirname(path) !== parent || await realpath(path) !== path || !(await lstat(path)).isDirectory()) throw unavailable();
  await rm(path, { recursive: true, force: true });
}

async function prepare() {
  const { GH_TOKEN, GITHUB_OUTPUT, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT } = process.env;
  if (!GH_TOKEN || !GITHUB_OUTPUT || !isRunNumber(GITHUB_RUN_ID) || GITHUB_RUN_ATTEMPT !== '1') throw unavailable();
  const reference = baselineReference();
  const root = await tempRoot();
  const started = performance.now();
  const scratch = await mkdtemp(resolve(root, 'study-hub-transform-download-'));
  const gh = async (args: string[], timeout: number) => (await exec('gh', [...args, '-R', repo], {
    cwd: scratch, timeout, maxBuffer: 96 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1' },
  })).stdout;
  try {
    await gh(['run', 'download', reference.runId, '-n', 'document-transform-index-' + reference.attempt, '-D', scratch], 20000);
    const files = await readdir(scratch);
    if (files.length !== 1 || files[0] !== transformIndexFilename) throw unavailable();
    const text = await readMetadata(resolve(scratch, transformIndexFilename), transformIndexLimit);
    authenticatedIndex(text, reference);
    await writeFile(resolve(root, 'study-hub-previous-' + transformIndexFilename), text, { flag: 'wx', mode: 0o600 });
    const indexFetchMs = Math.round(performance.now() - started);
    const outputs = [`index_fetch_ms=${indexFetchMs}`];
    try {
      const run = JSON.parse(await gh(['run', 'view', GITHUB_RUN_ID, '--attempt', '1', '--json', 'createdAt,jobs'], 8000));
      const dispatchAt = Date.parse(run.createdAt);
      const jobStartedAt = Date.parse(run.jobs.find((job: { name?: string }) => job.name === 'verify')?.startedAt);
      if (Number.isSafeInteger(dispatchAt) && dispatchAt > 0) outputs.push(`dispatch_at=${dispatchAt}`);
      if (Number.isSafeInteger(jobStartedAt) && jobStartedAt >= dispatchAt) outputs.push(`job_started_at=${jobStartedAt}`);
    } catch {
      // The paired build comparison also works without GitHub's queue timestamps.
    }
    await appendFile(GITHUB_OUTPUT, outputs.join('\n') + '\n');
  } finally {
    await cleanScratch(scratch, root);
  }
}

export async function buildTransformCandidate(
  options: Parameters<typeof buildContent>[0],
  outputDir: string,
): Promise<BuildReport> {
  const root = await realpath(project);
  const generated = resolve(root, '.generated');
  const stage = dirname(outputDir);
  if (outputDir !== resolve(stage, 'dist') || options.outputDir !== resolve(stage, 'content') ||
      dirname(stage) !== generated || !stage.startsWith(resolve(generated, 'document-transform-observe-')) ||
      await realpath(stage) !== stage || !(await lstat(stage)).isDirectory()) throw unavailable();
  // Vite may empty its output. Reserve a fresh directory within the checked scratch tree.
  await mkdir(outputDir);
  const content = await buildContent(options);
  if (await realpath(outputDir) !== outputDir || !(await lstat(outputDir)).isDirectory()) throw unavailable();
  const { build } = await import('vite');
  await build({
    configFile: resolve(project, 'vite.config.ts'),
    publicDir: content.outputDir,
    logLevel: 'error',
    build: { outDir: outputDir, emptyOutDir: true },
  });
  if (await realpath(outputDir) !== outputDir || !(await lstat(outputDir)).isDirectory()) throw unavailable();
  const manifest = JSON.parse(await readFile(content.reportPath, 'utf8')) as BuildReport;
  return finishAppBuild(outputDir, manifest);
}

function elapsedInput(key: string): number | null {
  const value = process.env[key];
  if (!value || !/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}

async function observe() {
  const reference = baselineReference();
  const root = await tempRoot();
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const buildStartedAt = elapsedInput('BASELINE_BUILD_STARTED_AT');
  const buildFinishedAt = elapsedInput('BASELINE_BUILD_FINISHED_AT');
  const publishedAt = elapsedInput('PUBLISHED_AT');
  const indexFetchMs = elapsedInput('INDEX_FETCH_MS');
  if (!summary || !buildStartedAt || !buildFinishedAt || !publishedAt || indexFetchMs === null ||
      buildStartedAt > buildFinishedAt || buildFinishedAt > publishedAt) throw unavailable();
  const dispatchInput = elapsedInput('DISPATCH_AT');
  const dispatchAt = dispatchInput && dispatchInput <= buildStartedAt ? dispatchInput : null;
  const jobInput = elapsedInput('JOB_STARTED_AT');
  const jobStartedAt = dispatchAt && jobInput && jobInput >= dispatchAt && jobInput <= buildStartedAt ? jobInput : null;
  const target: unknown = JSON.parse(process.env.STUDY_HUB_PUBLIC_DEPLOYMENT_SETTINGS ?? 'null');
  validatePublicSettings(target);
  const receipt: unknown = JSON.parse(await readMetadata(resolve(project, '.reports/public-release.json'), 4096));
  const baseline = JSON.parse(await readFile(resolve(project, '.reports/app-build.json'), 'utf8')) as BuildReport;
  if (!isRecord(receipt) || receipt.status !== 'published-public-verified' || receipt.url !== target.productionUrl ||
      receipt.workerId !== target.workerId || receipt.bundleHash !== baseline.bundleHash ||
      receipt.catalogHash !== baseline.outputs.find(row => row.path === 'catalog.json')?.sha256) throw unavailable();
  await assertCurrentBundle(resolve(project, 'dist'), baseline, project);
  const index = authenticatedIndex(await readMetadata(resolve(root, 'study-hub-previous-' + transformIndexFilename), transformIndexLimit), reference);
  const reuse = createPublicTransformRestore(target.productionUrl, index);
  const disk = await statfs(project);
  const bundleBytes = baseline.outputs.reduce((total, file) => total + file.size, 0);
  if (disk.bavail * disk.bsize < bundleBytes * 2 + 128 * 1024 ** 2) throw unavailable();
  const { settings } = await readSourceSettings(project, '.local/ci-sources.json');
  const generated = resolve(project, '.generated');
  const reports = resolve(project, '.reports');
  if (await realpath(generated) !== generated || await realpath(reports) !== reports) throw unavailable();
  const work = await mkdtemp(resolve(generated, 'document-transform-observe-'));
  try {
    const reportDir = await mkdtemp(resolve(reports, 'document-transform-observe-'));
    try {
      const candidateStarted = performance.now();
      const candidate = await buildTransformCandidate({
        settings,
        outputDir: resolve(work, 'content'),
        reportDir,
        documentTransforms: { appSha: reference.appSha, restore: reuse.restore },
      }, resolve(work, 'dist'));
      const candidateBuildMs = Math.round(performance.now() - candidateStarted);
      const result = summarizeTransformObservation(baseline, candidate, {
        buildStartedAt, buildFinishedAt, publishedAt, dispatchAt, jobStartedAt,
        candidateBuildMs, indexFetchMs,
      }, reuse.metrics);
      await appendFile(summary, 'Document HTML/CSS reuse (observe)\n\n```json\n' + JSON.stringify(result, null, 2) + '\n```\n');
      console.log(JSON.stringify(result));
      if (result.status === 'mismatch') console.warn('CI_DOCUMENT_TRANSFORM_BUNDLE_MISMATCH');
    } finally {
      await cleanScratch(reportDir, reports);
    }
  } finally {
    await cleanScratch(work, generated);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void (async () => {
    if (process.argv.length !== 3 || await realpath(process.cwd()) !== await realpath(project)) throw unavailable();
    if (process.argv[2] === 'prepare') await prepare();
    else if (process.argv[2] === 'observe') await observe();
    else throw unavailable();
  })().catch(() => {
    console.error('CI_DOCUMENT_TRANSFORM_OBSERVATION_UNAVAILABLE');
    process.exitCode = 1;
  });
}
