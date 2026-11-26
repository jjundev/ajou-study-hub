import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { build } from 'vite';
import { fileURLToPath } from "node:url";
import { buildContent } from "./content/build.js";
import { writeReport, validateReportPath, type BuildReport } from "./content/report.js";
import type { SourceSettings } from "./content/source.js";
import { parseAppArguments, validateAppOutput } from './app-build-safety.js';
import { finishAppBuild } from './app-build.js';
import { encodeTransformIndex, transformIndexFilename } from './ci/document-transform-reuse.js';
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'deploy:private') {
    if (args.length) throw Error('Private release accepts no overrides');
    const { runPrivateRelease } = await import('./deploy/release.js');
    await runPrivateRelease();
    return;
  }
  if (!["content:build", "build", "dev"].includes(command ?? "")) throw new Error("Expected content:build, build, or dev");
  const appRoot = fileURLToPath(new URL('../', import.meta.url));
  if (command === 'build' && args.length === 1 && args[0] === '--ui-only') {
    if (await realpath(process.cwd()) !== await realpath(appRoot)) throw Error('App commands must run in the owned project directory');
    const output = await validateAppOutput([]);
    const report = resolve('.reports/app-build.json');
    await validateReportPath(report, [output]);
    await build({ root: appRoot, configFile: false, publicDir: false, build: { outDir: output, emptyOutDir: true } });
    await writeFile(resolve(output, 'catalog.json'), JSON.stringify({ version: 1, courses: [], groups: [], documents: [] }) + '\n');
    const manifest = await finishAppBuild(output, { createdAt: '', bundleHash: '', sources: [], inputs: [], outputs: [], issues: [] });
    await writeReport(manifest, report, [output]);
    return;
  }
  const { sources, explicitSources, viteArgs } = parseAppArguments(command!, args);
  if (command !== 'content:build') {
    await validateAppOutput([], resolve(sources));
    if (await realpath(process.cwd()) !== await realpath(appRoot)) throw Error('App commands must run in the owned project directory');
  }
  // Real originals are opt-in; no default command reads .local/sources.json.
  if (!explicitSources) await import("./create-fixture.js");
  const settings = JSON.parse(
    await readFile(resolve(sources), "utf8"),
  ) as SourceSettings;
  if (
    !settings ||
    typeof settings.roots !== "object" ||
    !settings.explicitUntracked ||
    typeof settings.explicitUntracked !== "object"
  )
    throw new Error("Invalid source settings");
  const outputDir = command === 'content:build' ? resolve('dist') : await validateAppOutput(Object.values(settings.roots), resolve(sources));
  const reportPath = resolve('.reports/app-build.json');
  const exclusions = [outputDir, ...Object.values(settings.roots)];
  if (command === 'build') await validateReportPath(reportPath, exclusions);
  const appSha = process.env.GITHUB_SHA;
  const recordTransforms = command === 'build' && process.env.GITHUB_ACTIONS === 'true' &&
    process.env.RECORD_DOCUMENT_TRANSFORMS === 'true' && /^[a-f0-9]{40}$/.test(appSha ?? '') && appSha;
  const result = await buildContent({
    settings,
    outputDir: resolve(".generated/content"),
    reportDir: resolve(".reports"),
    ...(recordTransforms ? { documentTransforms: { appSha: recordTransforms } } : {}),
  });
  console.log(
    JSON.stringify(
      {
        courses: result.catalog.courses.length,
        groups: result.catalog.groups.length,
        listed: result.catalog.documents.filter((d) => d.listed).length,
        documents: result.catalog.documents.length,
        bundleHash: result.bundleHash,
        reportPath: result.reportPath,
        issues: result.issues.length,
      },
      null,
      2,
    ),
  );
  if (command === "content:build") return;
  await validateAppOutput(Object.values(settings.roots), resolve(sources));
  const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, [vite, ...(command === 'build' ? ['build'] : []), '--config', resolve(appRoot, 'vite.config.ts'), ...viteArgs], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(Error(`Vite exited with ${code}`)));
  });
  if (command === 'build') {
    await validateAppOutput(Object.values(settings.roots), resolve(sources));
    const report = JSON.parse(await readFile(result.reportPath, 'utf8')) as BuildReport;
    const final = await finishAppBuild(outputDir, report);
    await writeReport(final, reportPath, exclusions);
    if (recordTransforms && result.documentTransforms?.length) {
      try {
        const finalOutputs = new Map(final.outputs.map(file => [file.path, file]));
        if (report.outputs.some(file => {
          const output = finalOutputs.get(file.path);
          return output?.sha256 !== file.sha256 || output.size !== file.size;
        })) throw Error('Document transform bytes differ from app output');
        const text = encodeTransformIndex(recordTransforms, result.documentTransforms, final.bundleHash);
        await writeReport(JSON.parse(text), resolve('.reports', transformIndexFilename), exclusions);
      } catch {
        console.warn('CI_DOCUMENT_TRANSFORM_INDEX_UNAVAILABLE');
      }
    }
    console.log(`Final app report: ${reportPath}`);
  }
}
main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
