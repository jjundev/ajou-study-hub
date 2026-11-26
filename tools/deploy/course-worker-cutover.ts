import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { courseIds, workerProfile } from '../../config/course-workers.js';
import { catalogSlice, isCatalog } from '../../src/content/catalog-validation.js';
import { writeReport, type BuildReport } from '../content/report.js';
import { representativePaths } from '../representative-materials.js';
import { anonymousProbe, verifyPublicDeployment } from './public-release.js';
import { probeCourseFiles, type CourseWorkerCheckpoint } from './course-worker-release.js';
import { readCourseWorkerTarget } from './course-worker-target.js';
import { assertHubProfile, profiledReleaseSettings, readPublicCatalog, releaseProfiledHubWorker } from './hub-worker-release.js';
import { assembleHubArtifact, deriveStaticWorkerBaseline, seedCourseWorker, type VerifiedPublicBaseline } from './static-worker-baseline.js';
import { readActiveDeployment, readWorkerTarget } from './worker-target.js';

let phase = 'configuration';

async function runCutover() {
  const profile = workerProfile(process.argv[2]);
  const current = workerProfile(process.env.STUDY_HUB_STATIC_WORKER_PROFILE || undefined);
  if (process.env.STUDY_HUB_AUTOMATIC_UPDATES !== 'disabled' ||
      !((profile === 'pilot' && current === 'legacy') || (profile === 'all' && current === 'pilot'))) {
    throw Error('Unexpected cutover transition');
  }
  const { settings, courseSettings, readOptions, token } = profiledReleaseSettings();
  if (settings.accountId !== courseSettings.accountId) throw Error('Cloudflare account mismatch');
  const project = await realpath(process.cwd());
  const previous = workerProfile(current);
  const origin = settings.productionUrl;
  const previousSeeds = JSON.parse(process.env.STUDY_HUB_COURSE_WORKER_BASELINES || '{}') as Record<string, CourseWorkerCheckpoint>;
  const existing = { ...courseSettings.workerIds };
  const checkpoints = { ...previousSeeds };
  phase = 'active-hub';
  await readWorkerTarget(settings, readOptions);
  await assertHubProfile(previous, origin);
  const active = await readActiveDeployment(settings, readOptions);
  phase = 'verified-baseline';
  const receipt = JSON.parse(await readFile('.local/cutover/receipt.json', 'utf8')) as VerifiedPublicBaseline;
  const manifest = JSON.parse(await readFile('../baseline/.reports/app-build.json', 'utf8')) as BuildReport;
  const bundleDir = await realpath('../baseline/dist');
  const liveCatalog = await readPublicCatalog(origin);
  const baselineCatalog: unknown = JSON.parse(await readFile(resolve(bundleDir, 'catalog.json'), 'utf8'));
  if (!isCatalog(baselineCatalog)) throw Error('Invalid baseline catalog');
  const probe = anonymousProbe(origin, {});
  const biologyPath = liveCatalog.documents.find(doc => doc.courseId === 'life-science' && doc.sourcePath === representativePaths[0][1])?.url;
  if (!biologyPath) throw Error('Life science representative unavailable');
  const biologyFingerprint = () => probe(biologyPath, async response => {
    if (!response.ok) throw Error('Life science representative unavailable');
    return createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
  });
  let liveBiologyHash: string | undefined;
  let liveBiologyVersion: string | undefined;
  if (profile === 'pilot') {
    if (active.versionId !== receipt.versionId) throw Error('Active legacy hub differs from verified baseline');
    await verifyPublicDeployment(origin, manifest);
  } else {
    const lifeScience = await readCourseWorkerTarget('life-science', courseSettings, readOptions);
    liveBiologyVersion = lifeScience.active.versionId;
    liveBiologyHash = await biologyFingerprint();
    for (const id of courseIds.filter(id => id !== 'life-science')) {
      if (!await probeCourseFiles(origin, id, baselineCatalog, manifest.outputs)) throw Error('Legacy course baseline changed during pilot');
    }
  }
  const generated = resolve(project, '.generated');
  await mkdir(generated, { recursive: true });
  if (await realpath(generated) !== generated) throw Error('Unsafe baseline staging directory');
  const stage = await mkdtemp(resolve(generated, 'cutover-'));
  try {
    const baseline = await deriveStaticWorkerBaseline({ bundleDir, manifest, receipt, profile, outputRoot: resolve(stage, 'baseline') });
    const migrate = profile === 'pilot' ? baseline.courses : baseline.courses.filter(artifact => artifact.courseId !== 'life-science');
    const previousAttempt = JSON.parse(process.env.COURSE_SEED_RETRY || '{}');
    const seeds: Record<string, CourseWorkerCheckpoint> = {};
    for (const artifact of migrate) {
      const id = artifact.courseId;
      phase = 'seed-' + id;
      const target = await seedCourseWorker({ project, accountId: settings.accountId, artifact, token, readOptions, previous: previousAttempt[id] });
      existing[id] = target.workerId;
      const catalogHash = artifact.manifest.outputs.find(file => file.path === 'catalog.json')!.sha256;
      seeds[id] = { courseId: id, workerId: target.workerId, sourceSha: artifact.sourceSha, bundleHash: artifact.manifest.bundleHash,
        catalogHash, versionId: target.active.versionId };
      await writeReport(seeds, resolve(project, '.reports/course-seed-receipts.json'));
      console.log('CI_CUTOVER_SEEDED ' + id + ' ' + target.active.versionId);
    }
    const verifyPublic = async () => {
      for (const artifact of migrate) {
        if (!await probeCourseFiles(origin, artifact.courseId, artifact.catalog, artifact.manifest.outputs)) {
          throw Error('Migrated course verification failed');
        }
        const target = await readCourseWorkerTarget(artifact.courseId, { accountId: settings.accountId, workerIds: existing }, readOptions);
        if (target.active.versionId !== seeds[artifact.courseId]?.versionId) throw Error('Migrated course version changed');
      }
      if (profile === 'all') {
        const after = await readCourseWorkerTarget('life-science', courseSettings, readOptions);
        const catalog = await readPublicCatalog(origin);
        if (after.active.versionId !== liveBiologyVersion || await biologyFingerprint() !== liveBiologyHash ||
            !isDeepStrictEqual(catalogSlice(catalog, 'life-science'), catalogSlice(liveCatalog, 'life-science'))) {
          throw Error('Life science changed during all-course cutover');
        }
      }
    };
    phase = 'publish-hub';
    const hubArtifact = profile === 'pilot' ? baseline.hub : await assembleHubArtifact(resolve(project, 'dist'),
      JSON.parse(await readFile('.reports/app-build.json', 'utf8')) as BuildReport, profile, resolve(stage, 'hub-ui'));
    const deployed = await releaseProfiledHubWorker({ project, profile, previousProfile: previous, artifact: hubArtifact, settings,
      courseSettings: { accountId: settings.accountId, workerIds: existing }, token, readOptions, expectedActive: active, verifyPublic });
    Object.assign(checkpoints, seeds);
    await writeReport({ profile, settings: { accountId: settings.accountId, workerIds: existing }, checkpoints, previous: active, active: deployed },
      resolve(project, '.reports/course-cutover.json'));
    console.log(JSON.stringify({ profile, previous: active, active: deployed, migrated: Object.keys(seeds) }));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

try {
  await runCutover();
} catch {
  console.error('CI_COURSE_CUTOVER_FAILED_OR_UNCONFIRMED ' + phase);
  process.exitCode = 1;
}
