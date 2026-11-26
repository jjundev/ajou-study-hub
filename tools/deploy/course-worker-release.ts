import { createHash } from 'node:crypto';
import { cp, readFile, realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { boundCourseIds, courseWorkers, isCourseId, workerProfile, type CourseId, type StaticWorkerProfile } from '../../config/course-workers.js';
import { catalogSlice, isCatalog } from '../../src/content/catalog-validation.js';
import { routingDescriptor, routingPath } from '../../src/worker/hub.js';
import { assertCourseWorkerProof, inspectCourseArtifact, type CourseWorkerProof, type CourseWorkerProofInput } from '../course-worker-proof.js';
import { readCourseArtifacts } from '../ci/verify-course-worker.js';
import { writeReport, type BuildReport } from '../content/report.js';
import { parseCourseWorkerSettings, readCourseWorkerTarget, type CourseWorkerSettings, type CourseWorkerTarget } from './course-worker-target.js';
import { workerVersionId, publicProductionUrl, readActiveDeployment, validatePublicSettings, type ActiveDeployment, type ReadOptions } from './worker-target.js';
import { anonymousProbe, encodedPath, PublicProbeError, verifyPublicFiles } from './public-release.js';
import { withProfiledWrangler, staticAssets, workerCompatibilityDate, uploadedVersion, waitForWorkerVersion } from './profiled-wrangler.js';
import type { Catalog } from '../../src/content/model.js';

type Fingerprint = Pick<CourseWorkerProof, 'bundleHash' | 'catalogHash' | 'sourceSha'>;
export type CourseWorkerCheckpoint = Fingerprint & { courseId: CourseId; workerId: string; versionId: string };
export type CourseWorkerReceipt = {
  status: 'verified' | 'unchanged' | 'rolled-back' | 'outcome-unknown';
  courseId: CourseId; previousVersionId: string; candidateVersionId?: string;
  active?: ActiveDeployment; checkpoint?: CourseWorkerCheckpoint;
};

type PublishOptions = {
  courseId: CourseId; proof: Fingerprint; checkpoint?: CourseWorkerCheckpoint;
  readTarget(): Promise<CourseWorkerTarget>; checkRouting(): Promise<void>;
  upload(target: CourseWorkerTarget): Promise<string>;
  promote(target: CourseWorkerTarget, version: string): Promise<void>;
  probe(): Promise<boolean>;
  probePrevious(checkpoint: CourseWorkerCheckpoint): Promise<boolean>;
  rollback(target: CourseWorkerTarget, version: string): Promise<void>;
};

export function createCourseWorkerConfig(id: CourseId, directory: string) {
  return { name: courseWorkers[id].name, main: './worker.mjs', compatibility_date: workerCompatibilityDate,
    workers_dev: false, preview_urls: false, assets: { ...staticAssets, directory } };
}

export async function assertProductionRouting(expected: StaticWorkerProfile, origin: string, request: typeof fetch = fetch): Promise<void> {
  try {
    await anonymousProbe(origin, { fetch: request })(routingPath, async response => {
      if (!response.ok || !isDeepStrictEqual(await response.json(), routingDescriptor(expected))) throw Error();
    });
  } catch {
    throw Error('Production routing does not match the selected profile');
  }
}

async function probePreviousCatalog(courseId: CourseId, checkpoint: CourseWorkerCheckpoint): Promise<boolean> {
  return anonymousProbe(publicProductionUrl, {})('/catalog.json', async response => {
    if (!response.ok) return false;
    const value: unknown = await response.json();
    if (!isCatalog(value)) return false;
    const digest = createHash('sha256').update(JSON.stringify(catalogSlice(value, courseId)) + '\n').digest('hex');
    return digest === checkpoint.catalogHash;
  });
}

export async function probeCourseFiles(origin: string, courseId: CourseId, catalog: Catalog, outputs: BuildReport['outputs'], request?: typeof fetch): Promise<boolean> {
  const probe = anonymousProbe(origin, { fetch: request });
  try {
    const matches = await probe('/catalog.json', async response => {
      if (!response.ok) {
        if (response.status < 500 && ![408, 429].includes(response.status)) return false;
        throw Error('Public catalog unavailable');
      }
      const value: unknown = await response.json().catch(() => undefined);
      return isCatalog(value) && isDeepStrictEqual(catalogSlice(value, courseId), catalogSlice(catalog, courseId));
    });
    if (!matches) return false;
    await verifyPublicFiles(probe, outputs.filter(row => row.path.startsWith('content/' + courseId + '/'))
      .map(row => ({ row, path: encodedPath(row.path) })));
    return true;
  } catch (error) {
    if (error instanceof PublicProbeError && error.definitive) return false;
    throw error;
  }
}

function knownCheckpoint(input: PublishOptions, target: CourseWorkerTarget): input is PublishOptions & { checkpoint: CourseWorkerCheckpoint } {
  const record = input.checkpoint;
  return !!record && record.courseId === target.courseId && record.workerId === target.workerId &&
    record.versionId === target.active.versionId && /^[a-f0-9]{64}$/.test(record.bundleHash) &&
    /^[a-f0-9]{64}$/.test(record.catalogHash) && /^[a-f0-9]{40}$/.test(record.sourceSha);
}

export async function publishCourseVersion(input: PublishOptions): Promise<CourseWorkerReceipt> {
  await input.checkRouting();
  const target = await input.readTarget();
  if (target.courseId !== input.courseId || target.workerName !== courseWorkers[input.courseId].name) throw Error('Wrong course publish target');
  const previousVersionId = target.active.versionId;
  const base = { courseId: input.courseId, previousVersionId };
  if (!knownCheckpoint(input, target) || !await input.probePrevious(input.checkpoint)) {
    throw Error('Active course version is missing a verified checkpoint');
  }
  if (input.checkpoint.bundleHash === input.proof.bundleHash &&
      input.checkpoint.catalogHash === input.proof.catalogHash && await input.probe()) {
    return { ...base, status: 'unchanged', active: target.active, checkpoint: { ...input.checkpoint, sourceSha: input.proof.sourceSha } };
  }
  let candidateVersionId: string | undefined;
  async function reread() {
    const current = await input.readTarget();
    if (current.workerId !== target.workerId || current.accountId !== target.accountId || current.workerName !== target.workerName) {
      throw Error('Course Worker target changed');
    }
    return current;
  }
  const unknown = (active?: ActiveDeployment): CourseWorkerReceipt => ({ ...base, status: 'outcome-unknown', candidateVersionId, active });
  try {
    const candidate = await input.upload(target);
    if (!workerVersionId.test(candidate) || candidate === previousVersionId) return unknown((await reread()).active);
    candidateVersionId = candidate;
  } catch {
    return unknown((await reread().catch(() => undefined))?.active);
  }
  await input.checkRouting();
  const before = await reread();
  if (!isDeepStrictEqual(before.active, target.active)) return unknown(before.active);
  try {
    await input.promote(target, candidateVersionId);
  } catch {
    // The provider may have accepted the promotion before the command failed.
  }
  const readActive = async () => (await reread()).active;
  const deployed = await waitForWorkerVersion(readActive, before.active, candidateVersionId).catch(() => undefined);
  if (deployed?.versionId !== candidateVersionId) return unknown(deployed);
  try {
    if (await input.probe()) {
      const verified = await reread();
      if (!isDeepStrictEqual(verified.active, deployed)) return unknown(verified.active);
      return { ...base, status: 'verified', candidateVersionId, active: verified.active,
        checkpoint: { courseId: input.courseId, workerId: target.workerId, versionId: candidateVersionId, ...input.proof } };
    }
  } catch {
    return unknown(deployed);
  }
  const current = await reread().catch(() => undefined);
  if (!current || !knownCheckpoint(input, target) || !isDeepStrictEqual(current.active, deployed)) return unknown(current?.active);
  try {
    await input.checkRouting();
    if (!isDeepStrictEqual((await reread()).active, deployed)) return unknown();
    await input.rollback(target, previousVersionId);
    const restored = await waitForWorkerVersion(readActive, deployed, previousVersionId);
    if (restored.versionId === previousVersionId && await input.probePrevious(input.checkpoint)) return { ...base, status: 'rolled-back', candidateVersionId, active: restored, checkpoint: input.checkpoint };
    return unknown(restored);
  } catch {
    return unknown((await reread().catch(() => undefined))?.active);
  }
}

export type CourseWorkerReleaseInput = CourseWorkerProofInput & {
  proof: CourseWorkerProof; settings: CourseWorkerSettings; profile: StaticWorkerProfile; checkpoint?: CourseWorkerCheckpoint;
  token?: string; readOptions?: ReadOptions;
};

export async function releaseCourseWorker(input: CourseWorkerReleaseInput): Promise<CourseWorkerReceipt> {
  const { courseId, profile, settings, project, outputDir, proof, manifest, checkpoint } = input;
  if (!boundCourseIds(profile).includes(courseId)) throw Error('Course is outside the deployed profile');
  await assertCourseWorkerProof(input);
  const { catalog } = await inspectCourseArtifact(outputDir, courseId, manifest);
  return withProfiledWrangler(project, settings.accountId, input.token, createCourseWorkerConfig(courseId, './assets'), 'course-assets',
    async (directory, run) => {
      const isolated = resolve(directory, 'assets');
      await cp(outputDir, isolated, { recursive: true, force: false, errorOnExist: true });
      return publishCourseVersion({
        courseId, proof: { sourceSha: proof.sourceSha, bundleHash: proof.bundleHash, catalogHash: proof.catalogHash }, checkpoint,
        readTarget: () => readCourseWorkerTarget(courseId, settings, input.readOptions),
        checkRouting: () => assertProductionRouting(profile, publicProductionUrl),
        async upload() {
          await assertCourseWorkerProof({ ...input, outputDir: isolated });
          return uploadedVersion(await run(['versions', 'upload', '--strict']));
        },
        async promote(_target, version) { await run(['versions', 'deploy', version + '@100%', '--yes']); },
        async probe() {
          for (const wait of [0, 1000, 3000, 6000]) {
            await delay(wait);
            if (await probeCourseFiles(publicProductionUrl, courseId, catalog, manifest.outputs)) return true;
          }
          return false;
        },
        probePrevious: checkpoint => probePreviousCatalog(courseId, checkpoint),
        async rollback(_target, version) { await run(['rollback', version, '--yes']); },
      });
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const id = process.argv[2] ?? '';
    if (!isCourseId(id) || process.argv.length !== 3 || process.env.STUDY_HUB_AUTOMATIC_UPDATES !== 'enabled') throw Error();
    const input = await readCourseArtifacts(await realpath(process.cwd()), id);
    const proof = JSON.parse(await readFile(input.proofPath, 'utf8')) as CourseWorkerProof;
    const settings = parseCourseWorkerSettings(JSON.parse(process.env.STUDY_HUB_COURSE_WORKER_SETTINGS ?? '{}'));
    const hub = JSON.parse(process.env.STUDY_HUB_PUBLIC_DEPLOYMENT_SETTINGS ?? '{}');
    validatePublicSettings(hub);
    if (hub.accountId !== settings.accountId || !process.env.CLOUDFLARE_READ_TOKEN ||
        input.snapshot.appSha !== process.env.GITHUB_SHA) throw Error();
    let checkpoints: CourseWorkerCheckpoint[] = [];
    try {
      const rows: unknown = JSON.parse(await readFile(resolve(input.project, '.local/course-checkpoints.json'), 'utf8'));
      if (!Array.isArray(rows)) throw Error();
      checkpoints = rows;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const profile = workerProfile(process.env.STUDY_HUB_STATIC_WORKER_PROFILE);
    const readOptions = { token: process.env.CLOUDFLARE_READ_TOKEN };
    const snapshotVersions = async () => {
      const hubVersion = await readActiveDeployment(hub, readOptions);
      const courses = await Promise.all(boundCourseIds(profile).map(async course => {
        const target = await readCourseWorkerTarget(course, settings, readOptions).catch(() => undefined);
        return [course, target?.active.versionId ?? null] as const;
      }));
      return { hub: hubVersion.versionId, courses: Object.fromEntries(courses) };
    };
    const before = await snapshotVersions().catch(() => undefined);
    const selected = await readCourseWorkerTarget(id, settings, readOptions);
    const checkpoint = checkpoints.find(row => row.courseId === id && row.workerId === selected.workerId && row.versionId === selected.active.versionId);
    const receipt = await releaseCourseWorker({ ...input, proof, settings, checkpoint,
      profile, token: process.env.CLOUDFLARE_API_TOKEN, readOptions });
    const after = await snapshotVersions().catch(() => undefined);
    await writeReport({ ...receipt, before, after }, resolve(input.reportDir, 'publish-receipt.json'), [input.outputDir], input.project);
    if (receipt.status !== 'verified' && receipt.status !== 'unchanged') throw Error();
    await writeReport(receipt.checkpoint, resolve(input.reportDir, 'checkpoint.json'), [input.outputDir], input.project);
    console.log(JSON.stringify({ status: receipt.status, courseId: id, active: receipt.active, before, after }));
  } catch {
    console.error('CI_COURSE_PUBLISH_FAILED_OR_UNCONFIRMED');
    process.exitCode = 1;
  }
}
