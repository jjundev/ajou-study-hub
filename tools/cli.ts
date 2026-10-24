import { readFile, readdir, realpath } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildContent } from "./content/build.js";
import { writeReport, validateReportPath, type BuildReport } from "./content/report.js";
import { checkBundle, bundleLimits } from "./content/preflight.js";
import type { SourceSettings } from "./content/source.js";
import { parseAppArguments, validateAppOutput } from './app-build-safety.js';
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!["content:build", "build", "dev"].includes(command ?? "")) throw new Error("Expected content:build, build, or dev");
  const { sources, explicitSources, viteArgs } = parseAppArguments(command!, args);
  const appRoot = fileURLToPath(new URL('../', import.meta.url));
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
  const result = await buildContent({
    settings,
    outputDir: resolve(".generated/content"),
    reportDir: resolve(".reports"),
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
    const report = JSON.parse(await readFile(result.reportPath, 'utf8')) as BuildReport;
    const outputs: BuildReport['outputs'] = [];
    const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
    async function visit(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isSymbolicLink()) throw Error('Symlink in final app output');
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile()) { const bytes = await readFile(path); outputs.push({ path: relative(outputDir, path).replaceAll('\\', '/'), size: bytes.length, sha256: hash(bytes) }); }
      }
    }
    await validateAppOutput(Object.values(settings.roots), resolve(sources));
    await visit(outputDir);
    outputs.sort((a,b) => a.path.localeCompare(b.path));
    const issues = checkBundle(outputs, bundleLimits);
    if (issues.length) throw Error('Final app bundle exceeds hosting limits');
    await writeReport({ ...report, createdAt: new Date().toISOString(), outputs, bundleHash: hash(outputs.map(f => `${f.path}\0${f.sha256}\n`).join('')) }, reportPath, exclusions);
    console.log(`Final app report: ${reportPath}`);
  }
}
main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
