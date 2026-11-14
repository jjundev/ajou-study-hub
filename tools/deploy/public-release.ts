import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, unlink } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { bundleLimits } from '../content/preflight.js';
import { validateReportPath, writeReport, type BuildReport } from '../content/report.js';
import { verificationProject } from '../verification-project.js';
import { withSealedArtifact } from './release-artifact.js';
import { runWranglerUpload } from './wrangler-upload.js';
import { readActiveVersion, readWorkerTarget, validatePublicSettings, workerVersionId } from './worker-target.js';

type ProbeOptions = { fetch?: typeof fetch; timeoutMs?: number };
type Output = BuildReport['outputs'][number];
const controls = new Set(['_headers', '_redirects']);
const retryStatuses = new Set([408, 429, 502, 503, 504]);
const types: Record<string, RegExp> = {
  '.html': /^text\/html$/, '.htm': /^text\/html$/, '.json': /^application\/(?:json|[\w.+-]+\+json)$/,
  '.pdf': /^application\/pdf$/, '.css': /^text\/css$/, '.js': /^(?:text|application)\/(?:java|ecma)script$/,
  '.mjs': /^(?:text|application)\/(?:java|ecma)script$/, '.svg': /^image\/svg\+xml$/,
  '.png': /^image\/png$/, '.jpg': /^image\/jpeg$/, '.jpeg': /^image\/jpeg$/, '.gif': /^image\/gif$/,
  '.webp': /^image\/webp$/, '.avif': /^image\/avif$/, '.bmp': /^image\/bmp$/,
  '.ico': /^image\/(?:x-icon|vnd\.microsoft\.icon)$/,
  '.woff': /^(?:font\/woff|application\/(?:font-woff|x-font-woff))$/,
  '.woff2': /^(?:font\/woff2|application\/(?:font-woff2|x-font-woff2))$/,
  '.ttf': /^(?:font\/(?:ttf|sfnt)|application\/(?:x-font-ttf|font-sfnt))$/,
  '.otf': /^(?:font\/(?:otf|sfnt)|application\/(?:x-font-opentype|font-sfnt))$/,
  '.eot': /^application\/vnd\.ms-fontobject$/,
};

class PublicProbeError extends Error {
  constructor(message: string, readonly mayBePropagating: boolean) {
    super(message);
  }
}
function rejectProbe(path: string, reason: string, mayBePropagating = false): never {
  throw new PublicProbeError(`Public response for ${path}: ${reason}`, mayBePropagating);
}

function anonymousProbe(origin: string, options: ProbeOptions) {
  const base = URL.parse(origin);
  if (base?.origin !== origin || base.protocol !== 'https:') throw Error('Public verification requires an HTTPS origin');
  const timeout = options.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000)
    throw Error('Invalid public request timeout');
  const fetcher = options.fetch ?? fetch;

  return async <T>(path: string, inspect: (response: Response) => Promise<T> | T): Promise<T> => {
    const url = new URL(path, origin);
    if (url.origin !== origin) return rejectProbe(path, 'unexpected origin');
    for (let attempt = 0; ; attempt++) {
      const signal = AbortSignal.timeout(timeout);
      let response: Response | undefined;
      try {
        response = await fetcher(url.href, { credentials: 'omit', redirect: 'manual', cache: 'no-store', signal });
        if (attempt === 0 && retryStatuses.has(response.status)) {
          await response.body?.cancel().catch(() => {});
        } else {
          return await inspect(response);
        }
      } catch (error) {
        if (error instanceof PublicProbeError) throw error;
        if (attempt > 0 || (!(error instanceof TypeError) && !signal.aborted))
          return rejectProbe(path, 'request failed');
      } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }
      await delay(250);
    }
  };
}

type Probe = ReturnType<typeof anonymousProbe>;
function assertResponse(response: Response, path: string, expectedStatus: number, typePath = path): void {
  if (response.status !== expectedStatus) rejectProbe(path, `unexpected HTTP ${response.status}`, expectedStatus === 200 && response.status === 404);
  const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const expectedMime = types[posix.extname(typePath).toLowerCase()];
  if (expectedMime && !expectedMime.test(mime)) rejectProbe(path, 'unexpected media type');
}

async function streamBody(response: Response, path: string, limit: number, consume: (chunk: Uint8Array) => void) {
  const reader = response.body?.getReader();
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) rejectProbe(path, 'body exceeds expected size', true);
        consume(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return size;
}

async function checkRoot(origin: string, probe: Probe) {
  await probe('/', response => {
    const location = response.headers.get('location');
    if (response.status !== 302 || !location || URL.parse(location, origin)?.href !== origin + '/index.html')
      rejectProbe('/', 'expected a redirect to the production index');
  });
}

function encodedPath(path: string) {
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f]/.test(part)))
    throw Error('Invalid public manifest path');
  return '/' + parts.map(encodeURIComponent).join('/');
}

export async function verifyPublicDeployment(
  productionUrl: string, manifest: BuildReport, options: ProbeOptions = {},
): Promise<{ checked: number }> {
  const probe = anonymousProbe(productionUrl, options);
  const outputs = manifest.outputs.filter(row => !controls.has(row.path));
  const paths = new Set(outputs.map(row => row.path));
  for (const required of ['index.html', 'catalog.json', '404.html'])
    if (!paths.has(required)) throw Error('Public manifest missing ' + required);
  if (paths.size !== outputs.length) throw Error('Duplicate public manifest path');
  const missing = '/.well-known/study-hub-missing-' + randomUUID();
  const checks = outputs.map(row => {
    if (!Number.isSafeInteger(row.size) || row.size < 0 || row.size > bundleLimits.maxFileBytes ||
        !/^[a-f0-9]{64}$/.test(row.sha256)) throw Error('Invalid public manifest digest');
    return { row, path: row.path === '404.html' ? missing : encodedPath(row.path) };
  });
  await checkRoot(productionUrl, probe);
  const check = async (row: Output, path: string) => {
    await probe(path, async response => {
      assertResponse(response, path, row.path === '404.html' ? 404 : 200, row.path);
      const hash = createHash('sha256');
      const size = await streamBody(response, path, row.size, bytes => hash.update(bytes));
      if (size !== row.size || hash.digest('hex') !== row.sha256) rejectProbe(path, 'body does not match the sealed bundle', true);
    });
  };

  let next = 0;
  let failed = false;
  const verify = async () => {
    try {
      while (!failed && next < checks.length) {
        const { row, path } = checks[next++]!;
        await check(row, path);
      }
    } catch (error) {
      failed = true;
      throw error;
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(8, checks.length) }, verify));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  return { checked: checks.length };
}

async function verifyExistingPublicSite(origin: string) {
  const probe = anonymousProbe(origin, {});
  await checkRoot(origin, probe);
  const text = (path: string) => probe(path, async response => {
    assertResponse(response, path, 200);
    const chunks: Uint8Array[] = [];
    await streamBody(response, path, bundleLimits.maxFileBytes, chunk => chunks.push(chunk));
    return Buffer.concat(chunks).toString('utf8');
  });
  const html = await text('/index.html');
  if (!/<title>아주 학습 자료실<\/title>/.test(html) || !/<div\s+id=["']app["']/.test(html))
    rejectProbe('/index.html', 'existing study hub is unavailable');
  let catalog: unknown;
  try { catalog = JSON.parse(await text('/catalog.json')); }
  catch { return rejectProbe('/catalog.json', 'existing study hub catalog is unavailable'); }
  if (!catalog || typeof catalog !== 'object' || !('version' in catalog) || catalog.version !== 1 ||
      !('courses' in catalog) || !Array.isArray(catalog.courses) ||
      !('groups' in catalog) || !Array.isArray(catalog.groups) ||
      !('documents' in catalog) || !Array.isArray(catalog.documents))
    rejectProbe('/catalog.json', 'unexpected catalog schema');
}

type ReleaseOptions = {
  testProjectRoot?: string;
  activationDelays?: number[];
  propagationDelays?: number[];
};

/** Publish exactly once. Only active-version and anonymous HTTP reads can retry. */
export async function releasePublic(options: ReleaseOptions = {}) {
  const root = await verificationProject(options.testProjectRoot);
  const settingsPath = resolve(root, '.local/public-deployment.json');
  const receiptPath = resolve(root, '.reports/public-release.json');
  const lockPath = resolve(root, '.reports/public-release.lock');
  const dist = resolve(root, 'dist');
  if ((await lstat(resolve(root, '.local'))).isSymbolicLink() || !(await lstat(settingsPath)).isFile())
    throw Error('Unsafe public settings path');
  const target: unknown = JSON.parse(await readFile(settingsPath, 'utf8'));
  validatePublicSettings(target);
  const readToken = process.env.CLOUDFLARE_READ_TOKEN, writeToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!readToken || !writeToken) throw Error('Public release requires Cloudflare read and write tokens');
  const api = { token: readToken };
  const activationDelays = options.activationDelays ?? [1000, 2000, 4000, 8000];
  const propagationDelays = options.propagationDelays ?? [5000, 15000, 30000];

  await validateReportPath(lockPath, [dist], root);
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    let previousVersionId: string | undefined;
    const authorize = async () => {
      await readWorkerTarget(target, api);
      const current = await readActiveVersion(target, api);
      if (previousVersionId !== undefined && previousVersionId !== current)
        throw Error('Active Worker version changed during public release preparation');
      previousVersionId = current;
      await verifyExistingPublicSite(target.productionUrl);
    };
    return await withSealedArtifact(root, authorize, async (directory, configPath, manifest) => {
      const base = {
        url: target.productionUrl, workerId: target.workerId,
        previousVersionId, bundleHash: manifest.bundleHash,
      };
      const record = (details: object) =>
        writeReport({ ...base, ...details, checkedAt: new Date().toISOString() }, receiptPath, [dist, directory], root);
      await record({ status: 'upload-started-outcome-unknown' });
      let receipt: Awaited<ReturnType<typeof runWranglerUpload>>;
      try { receipt = await runWranglerUpload(root, directory, configPath, target, writeToken); }
      catch { throw Error('Public upload outcome unknown; inspect the active Worker before retrying'); }
      if (receipt.url !== target.productionUrl || !workerVersionId.test(receipt.versionId))
        throw Error('Invalid public upload receipt; inspect the active Worker before retrying');
      const pending = { status: 'uploaded-postcheck-pending', versionId: receipt.versionId };
      await record(pending);
      await readWorkerTarget(target, api);

      let currentVersionId = await readActiveVersion(target, api);
      for (const wait of activationDelays) {
        if (currentVersionId === receipt.versionId || currentVersionId !== previousVersionId) break;
        await delay(wait);
        currentVersionId = await readActiveVersion(target, api);
      }
      await record({ ...pending, currentVersionId });
      if (currentVersionId !== receipt.versionId) throw Error('Public upload active version mismatch');
      let checked: number;
      for (let attempt = 0; ; attempt++) {
        try {
          ({ checked } = await verifyPublicDeployment(target.productionUrl, manifest));
          break;
        } catch (error) {
          const wait = propagationDelays[attempt];
          if (!(error instanceof PublicProbeError) || !error.mayBePropagating || wait === undefined) throw error;
          await delay(wait);
          currentVersionId = await readActiveVersion(target, api);
          if (currentVersionId !== receipt.versionId) {
            await record({ ...pending, currentVersionId });
            throw Error('Active version changed before public response verification could retry');
          }
        }
      }
      currentVersionId = await readActiveVersion(target, api);
      if (currentVersionId !== receipt.versionId) {
        await record({ ...pending, currentVersionId });
        throw Error('Active version changed during public response verification');
      }
      const catalogHash = manifest.outputs.find(row => row.path === 'catalog.json')!.sha256;
      const result = { ...base, versionId: receipt.versionId, currentVersionId, checked, catalogHash };
      await record({ ...result, status: 'published-public-verified' });
      return result;
    }, { publicTarget: target });
  } finally {
    await lock.close();
    await validateReportPath(lockPath, [dist], root);
    await unlink(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void (async () => {
    if (process.argv.length !== 2) throw Error('Public release accepts no overrides');
    const result = await releasePublic();
    console.log(`Public release verified at ${result.url} (${result.versionId}, ${result.checked} responses)`);
  })().catch(() => {
    console.error('Public release failed; inspect .reports/public-release.json and the active Worker before retrying');
    process.exitCode = 1;
  });
}
