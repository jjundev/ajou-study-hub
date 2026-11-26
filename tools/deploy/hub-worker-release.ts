import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { boundCourseIds, courseIds, courseWorkers, workerProfile, type StaticWorkerProfile } from '../../config/course-workers.js';
import { catalogSlice, isCatalog } from '../../src/content/catalog-validation.js';
import type { Catalog } from '../../src/content/model.js';
import { routingPath } from '../../src/worker/hub.js';
import { assertCurrentSources } from '../source-binding.js';
import { writeReport, type BuildReport } from '../content/report.js';
import { assertReleaseProof } from './release-proof.js';
import { anonymousProbe, checkRoot, encodedPath, verifyPublicFiles } from './public-release.js';
import { publicProductionUrl, readActiveDeployment, readWorkerTarget, validatePublicSettings,
  type ActiveDeployment, type PublicDeploymentSettings, type ReadOptions } from './worker-target.js';
import { readCourseWorkerTarget, parseCourseWorkerSettings, type CourseWorkerSettings } from './course-worker-target.js';
import { assertProductionRouting, probeCourseFiles } from './course-worker-release.js';
import { assembleHubArtifact, assertStaticInventory, type StaticArtifact } from './static-worker-baseline.js';
import { withProfiledWrangler, staticAssets, workerCompatibilityDate, uploadedVersion } from './profiled-wrangler.js';

export function createHubWorkerConfig(profile: StaticWorkerProfile, directory: string) {
  const ids = boundCourseIds(profile);
  return {
    name: 'ajou-study-hub', main: './worker.mjs', compatibility_date: workerCompatibilityDate, workers_dev: true, preview_urls: false,
    vars: { STUDY_HUB_PROFILE: profile },
    assets: { ...staticAssets, directory, run_worker_first: ['/catalog.json', routingPath, ...ids.map(id => '/content/' + id + '/*')] },
    services: ids.map(id => ({ binding: courseWorkers[id].binding, service: courseWorkers[id].name })),
  };
}

export async function readPublicCatalog(origin = publicProductionUrl): Promise<Catalog> {
  return anonymousProbe(origin, {})('/catalog.json', async response => {
    if (!response.ok) throw Error('Unable to read public catalog');
    const value: unknown = await response.json();
    if (!isCatalog(value) || value.courses.length !== courseIds.length || courseIds.some(id => !value.courses.some(course => course.id === id))) {
      throw Error('Public catalog is missing a configured course');
    }
    return value;
  });
}

export async function assertHubProfile(profile: StaticWorkerProfile, origin: string) {
  if (profile !== 'legacy') return assertProductionRouting(profile, origin);
  await anonymousProbe(origin, {})(routingPath, response => {
    if (response.status !== 404) throw Error('Legacy hub routing could not be verified');
  });
}

export type HubWorkerReleaseInput = {
  project: string; profile: Exclude<StaticWorkerProfile, 'legacy'>; previousProfile: StaticWorkerProfile;
  settings: PublicDeploymentSettings; courseSettings: CourseWorkerSettings;
  artifact: StaticArtifact; expectedActive: ActiveDeployment; token?: string; readOptions: ReadOptions;
  verifyPublic?: () => Promise<void>;
};

export async function releaseProfiledHubWorker(input: HubWorkerReleaseInput): Promise<ActiveDeployment> {
  const { project, profile, previousProfile, settings, courseSettings, artifact, expectedActive, readOptions } = input;
  validatePublicSettings(settings);
  if (settings.accountId !== courseSettings.accountId) throw Error('Hub and courses use different accounts');
  await readWorkerTarget(settings, readOptions);
  await assertHubProfile(previousProfile, settings.productionUrl);
  const bound = boundCourseIds(profile);
  for (const id of bound) await readCourseWorkerTarget(id, courseSettings, readOptions);
  const unbound = courseIds.filter(id => !bound.includes(id));
  const assertHubScope = async (directory: string) => {
    await assertStaticInventory(directory, artifact.manifest);
    if (!artifact.manifest.outputs.some(file => file.path === 'index.html') ||
        artifact.manifest.outputs.some(file => file.path.startsWith('content/') && !unbound.some(id => file.path.startsWith('content/' + id + '/')))) {
      throw Error('Profiled hub manifest contains unexpected content');
    }
  };
  await assertHubScope(artifact.directory);
  const readActive = () => readActiveDeployment(settings, readOptions);
  const sameDeployment = async (expected: ActiveDeployment) => isDeepStrictEqual(await readActive(), expected);
  if (!await sameDeployment(expectedActive)) throw Error('Hub changed before publication');
  return withProfiledWrangler(project, settings.accountId, input.token, createHubWorkerConfig(profile, './assets'), 'hub',
    async (directory, run) => {
      const isolated = resolve(directory, 'assets');
      await cp(artifact.directory, isolated, { recursive: true, force: false, errorOnExist: true });
      await assertHubScope(isolated);
      const version = uploadedVersion(await run(['versions', 'upload', '--strict']));
      if (version === expectedActive.versionId) throw Error('No distinct hub candidate version');
      await assertHubProfile(previousProfile, settings.productionUrl);
      if (!await sameDeployment(expectedActive)) throw Error('Hub changed before promotion');
      try { await run(['versions', 'deploy', version + '@100%', '--yes']); } catch { /* Reconcile against active state. */ }
      const deployed = await readActive();
      if (deployed.versionId !== version) throw Error('Hub promotion outcome unconfirmed');
      try {
        const probe = anonymousProbe(settings.productionUrl, {});
        let passed = false;
        for (const wait of [0, 1000, 3000, 6000]) {
          await delay(wait);
          try {
            await assertProductionRouting(profile, settings.productionUrl);
            await checkRoot(settings.productionUrl, probe);
            const catalog = await readPublicCatalog(settings.productionUrl);
            await verifyPublicFiles(probe, artifact.manifest.outputs.filter(file => file.path === 'index.html' || file.path.startsWith('assets/'))
              .map(row => ({ row, path: encodedPath(row.path) })));
            for (const id of unbound) {
              if (!isDeepStrictEqual(catalogSlice(catalog, id), catalogSlice(artifact.catalog, id)) ||
                  !await probeCourseFiles(settings.productionUrl, id, artifact.catalog, artifact.manifest.outputs)) {
                throw Error('A legacy course changed during hub verification');
              }
            }
            await input.verifyPublic?.();
            passed = true;
            break;
          } catch {
            // Retry bounded propagation before restoration.
          }
        }
        if (!passed || !await sameDeployment(deployed)) throw Error('Public hub verification failed');
        return deployed;
      } catch {
        if (await sameDeployment(deployed)) {
          await run(['rollback', expectedActive.versionId, '--yes']);
          if ((await readActive()).versionId !== expectedActive.versionId) throw Error('Hub rollback outcome unconfirmed');
          throw Error('Hub public verification failed and previous version was restored');
        }
        throw Error('Hub active version changed during verification');
      }
    });
}

export function profiledReleaseSettings() {
  const settings: unknown = JSON.parse(process.env.STUDY_HUB_PUBLIC_DEPLOYMENT_SETTINGS ?? '{}');
  validatePublicSettings(settings);
  if (!process.env.CLOUDFLARE_READ_TOKEN || !process.env.CLOUDFLARE_API_TOKEN) throw Error('Cloudflare read and deploy credentials required');
  const courseSettings = parseCourseWorkerSettings(JSON.parse(process.env.STUDY_HUB_COURSE_WORKER_SETTINGS || JSON.stringify({ accountId: settings.accountId, workerIds: {} })));
  return { settings, courseSettings, token: process.env.CLOUDFLARE_API_TOKEN, readOptions: { token: process.env.CLOUDFLARE_READ_TOKEN } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let phase = 'settings';
  try {
    const profile = workerProfile(process.env.STUDY_HUB_STATIC_WORKER_PROFILE);
    if (profile === 'legacy' || process.env.STUDY_HUB_AUTOMATIC_UPDATES !== 'enabled') throw Error();
    const credentials = profiledReleaseSettings();
    const active = await readActiveDeployment(credentials.settings, credentials.readOptions);
    const project = await realpath(process.cwd());
    const manifest = JSON.parse(await readFile('.reports/app-build.json', 'utf8')) as BuildReport;
    const dist = resolve(project, 'dist');
    phase = 'proof';
    if (profile === 'pilot') {
      const proof = JSON.parse(await readFile('.reports/verification.json', 'utf8'));
      await assertReleaseProof(project, dist, manifest, proof);
      await assertCurrentSources(project, proof.sourceBinding, manifest);
    } else if (manifest.sources.length || manifest.inputs.length || manifest.outputs.some(file => file.path.startsWith('content/'))) {
      throw Error('Expected UI-only hub artifact');
    }
    const generated = resolve(project, '.generated');
    await mkdir(generated, { recursive: true });
    if (await realpath(generated) !== generated) throw Error();
    const stage = await mkdtemp(resolve(generated, 'hub-release-'));
    try {
      phase = 'publish';
      const artifact = await assembleHubArtifact(dist, manifest, profile, resolve(stage, 'assets'));
      const deployed = await releaseProfiledHubWorker({ ...credentials, project, profile, previousProfile: profile, artifact, expectedActive: active });
      await writeReport({ status: 'verified', profile, active: deployed }, resolve(project, '.reports/hub-receipt.json'));
      console.log(JSON.stringify({ profile, active: deployed }));
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  } catch {
    console.error('CI_PROFILED_HUB_RELEASE_FAILED ' + phase);
    process.exitCode = 1;
  }
}
