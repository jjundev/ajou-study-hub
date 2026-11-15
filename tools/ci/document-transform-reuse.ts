import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { courses } from '../../config/courses.js';
import type { TransformEntry, TransformRequest } from '../content/document-transform-key.js';
import { bundleLimits } from '../content/preflight.js';
import type { BuildReport } from '../content/report.js';
import { isRecord } from '../deploy/access-policy.js';

export const transformIndexFilename = 'document-transform-index.json';
export const transformIndexLimit = 512 * 1024;
const byteBudget = 64 * 1024 ** 2;
const sha256 = /^[a-f0-9]{64}$/;
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const unavailable = () => Error('CI_DOCUMENT_TRANSFORM_INDEX_UNAVAILABLE');
const courseIds = new Set(courses.map(({ id }) => id));
type TransformIndex = { schema: 1; appSha: string; bundleHash: string; entries: TransformEntry[] };
type Metrics = { hits: number; misses: number; rejected: number; restoredBytes: number; restoreMs: number };

export function parseTransformIndex(text: string, appSha: string, bundleHash: string): TransformIndex {
  if (Buffer.byteLength(text) > transformIndexLimit || !/^[a-f0-9]{40}$/.test(appSha) || !sha256.test(bundleHash))
    throw unavailable();
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || Object.keys(value).length !== 4 || value.schema !== 1 ||
      value.appSha !== appSha || value.bundleHash !== bundleHash || !Array.isArray(value.entries) ||
      !value.entries.length || value.entries.length > bundleLimits.maxFiles) throw unavailable();
  const keys = new Set<string>();
  for (const row of value.entries) {
    if (!isRecord(row) || Object.keys(row).length !== 3 ||
        typeof row.key !== 'string' || !sha256.test(row.key) || keys.has(row.key) ||
        typeof row.sha256 !== 'string' || !sha256.test(row.sha256) ||
        typeof row.size !== 'number' || !Number.isSafeInteger(row.size) ||
        row.size < 0 || row.size > bundleLimits.maxFileBytes) throw unavailable();
    keys.add(row.key);
  }
  return value as TransformIndex;
}

export function encodeTransformIndex(appSha: string, entries: readonly TransformEntry[], bundleHash: string): string {
  const text = JSON.stringify({ schema: 1, appSha, bundleHash, entries }) + '\n';
  parseTransformIndex(text, appSha, bundleHash);
  return text;
}

function urlForTransform(origin: string, path: string): string {
  const parts = path.split('/');
  if (parts.length < 3 || parts[0] !== 'content' || !courseIds.has(parts[1]!) ||
      !/\.(html?|css)$/i.test(path) ||
      parts.some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f\x7f]/.test(part))) throw unavailable();
  return origin + '/' + parts.map(encodeURIComponent).join('/');
}

async function fetchTransform(origin: string, path: string, row: TransformEntry, fetcher: typeof fetch, signal: AbortSignal) {
  const response = await fetcher(urlForTransform(origin, path), {
    credentials: 'omit', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
  });
  const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const expectedMime = /\.css$/i.test(path) ? 'text/css' : 'text/html';
  const reader = response.body?.getReader();
  try {
    if (!reader || response.status !== 200 || response.redirected || mime !== expectedMime) throw unavailable();
    const output = Buffer.alloc(row.size);
    let offset = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > row.size) throw unavailable();
      output.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== row.size || hash(output) !== row.sha256) throw unavailable();
    return output;
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}

export function createPublicTransformRestore(origin: string, index: TransformIndex, options: { fetch?: typeof fetch } = {}) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) throw unavailable();
  const entries = new Map(index.entries.map(row => [row.key, row]));
  const metrics: Metrics = { hits: 0, misses: 0, rejected: 0, restoredBytes: 0, restoreMs: 0 };
  return {
    metrics,
    async restore(requests: readonly TransformRequest[]): Promise<ReadonlyMap<string, Uint8Array>> {
      const started = performance.now();
      const signal = AbortSignal.timeout(25000);
      const restored = new Map<string, Uint8Array>();
      let next = 0;
      let reserved = 0;
      const worker = async () => {
        for (;;) {
          const request = requests[next++];
          if (!request) return;
          const entry = entries.get(request.key);
          if (!entry) {
            metrics.misses++;
            continue;
          }
          if (signal.aborted || reserved + entry.size > byteBudget) {
            metrics.rejected++;
            continue;
          }
          reserved += entry.size;
          try {
            const bytes = await fetchTransform(origin, request.path, entry, options.fetch ?? fetch, signal);
            restored.set(request.path, bytes);
            metrics.hits++;
            metrics.restoredBytes += bytes.byteLength;
          } catch {
            metrics.rejected++;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, requests.length) }, worker));
      metrics.restoreMs = Math.round(performance.now() - started);
      return restored;
    },
  };
}

type Timing = {
  dispatchAt: number | null;
  jobStartedAt: number | null;
  buildStartedAt: number;
  buildFinishedAt: number;
  publishedAt: number;
  candidateBuildMs: number;
  indexFetchMs: number;
};

export function summarizeTransformObservation(baseline: BuildReport, candidate: BuildReport, timing: Timing, metrics: Metrics) {
  const { dispatchAt, jobStartedAt, buildStartedAt, buildFinishedAt, publishedAt } = timing;
  const equal = baseline.bundleHash === candidate.bundleHash &&
    JSON.stringify(baseline.outputs) === JSON.stringify(candidate.outputs) &&
    JSON.stringify(baseline.inputs) === JSON.stringify(candidate.inputs) &&
    JSON.stringify(baseline.sources) === JSON.stringify(candidate.sources) &&
    JSON.stringify(baseline.issues) === JSON.stringify(candidate.issues);
  const fullBuildMs = buildFinishedAt - buildStartedAt;
  const candidateTotalMs = timing.indexFetchMs + timing.candidateBuildMs;
  const actualDeploymentMs = dispatchAt === null ? null : publishedAt - dispatchAt;
  const buildToPublishMs = publishedAt - buildStartedAt;
  const status = equal ? metrics.hits ? 'match' : 'no-reuse' : 'mismatch';
  const savingsMs = status === 'match' ? fullBuildMs - candidateTotalMs : null;
  return {
    status, baselineBundleHash: baseline.bundleHash, candidateBundleHash: candidate.bundleHash,
    files: baseline.outputs.length, ...metrics, fullBuildMs, candidateTotalMs,
    indexFetchMs: timing.indexFetchMs, candidateBuildMs: timing.candidateBuildMs,
    actualDeploymentMs, buildToPublishMs,
    queueMs: dispatchAt === null || jobStartedAt === null ? null : jobStartedAt - dispatchAt,
    projectedDeploymentMs: actualDeploymentMs === null || savingsMs === null ? null : actualDeploymentMs - savingsMs,
    projectedBuildToPublishMs: savingsMs === null ? null : buildToPublishMs - savingsMs,
    savingsMs,
  };
}
