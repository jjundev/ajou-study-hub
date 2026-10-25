import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  realpath,
  lstat,
} from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname, sep } from "node:path";
import { build } from "esbuild";
import { courses, type CourseConfig } from "../../config/courses.js";
import type { Catalog, Issue } from "../../src/content/model.js";
import {
  inspectSources,
  verifySnapshot,
  type SourceSettings,
} from "./source.js";
import { buildCatalog } from "./catalog.js";
import { collectDependencies } from "./collect.js";
import { transformHtml } from "./transform.js";
import { rebaseReferences } from "./rebase.js";
import { extractReferences, extractBase } from "./references.js";
import {
  checkBundle,
  bundleLimits,
  matchingException,
  type ContentException,
} from "./preflight.js";
import { writeReport, validateReportPath, type BuildReport } from "./report.js";
export type BuildResult = {
  catalog: Catalog;
  outputDir: string;
  bundleHash: string;
  reportPath: string;
  issues: Issue[];
};
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const inside = (root: string, path: string) => {
  const r = relative(root, path);
  return !!r && !isAbsolute(r) && r !== ".." && !r.startsWith(".." + sep);
};
/** All destructive operations are limited to a real project-owned .generated child. */
async function assertOutput(path: string): Promise<void> {
  const project = await realpath(process.cwd()),
    generated = resolve(project, ".generated");
  if (!inside(generated, path))
    throw new Error(`Unsafe output directory: ${path}`);
  let cursor = path;
  while (cursor !== project) {
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink())
        throw new Error(`Symlink output ancestor: ${cursor}`);
      const actual = await realpath(cursor);
      if (actual !== project && !inside(project, actual))
        throw new Error("Unsafe output realpath");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    cursor = dirname(cursor);
  }
}
export async function buildContent(options: {
  settings: SourceSettings;
  outputDir: string;
  reportDir: string;
  configs?: CourseConfig[];
}): Promise<BuildResult> {
  const outputDir = resolve(options.outputDir);
  await assertOutput(outputDir);
  const reportPath = resolve(options.reportDir, "content-build.json");
  if (reportPath === outputDir || inside(outputDir, reportPath))
    throw new Error("Report must be outside deployment output");
  const reportExclusions = [
    outputDir,
    ...(await Promise.all(
      Object.values(options.settings.roots).map((root) =>
        realpath(resolve(root)),
      ),
    )),
  ];
  await validateReportPath(reportPath, reportExclusions);
  const configs = options.configs ?? courses;
  const report: BuildReport = {
    createdAt: new Date().toISOString(),
    bundleHash: "",
    sources: [],
    inputs: [],
    outputs: [],
    issues: [],
  };
  const stage = outputDir + ".stage-" + randomUUID(),
    backup = outputDir + ".previous-" + randomUUID();
  await assertOutput(stage);
  await assertOutput(backup);
  try {
    const snapshot = await inspectSources(configs, options.settings, {
      batchTracking: true,
    });
    report.sources = snapshot.provenance;
    for (const root of Object.values(snapshot.repoRoots))
      if (
        root === outputDir ||
        inside(outputDir, root) ||
        inside(root, outputDir)
      )
        throw new Error("Output overlaps a source repository");
    const catalog = await buildCatalog(snapshot),
      graph = await collectDependencies(snapshot, catalog, configs);
    catalog.documents.push(...graph.linkedDocuments);
    catalog.documents.sort(
      (a, b) =>
        a.courseId.localeCompare(b.courseId) ||
        a.sourcePath.localeCompare(b.sourcePath),
    );
    report.issues.push(...graph.issues);
    const exceptions = JSON.parse(
      await readFile(resolve("config/content-exceptions.json"), "utf8"),
    ) as ContentException[];
    for (const i of report.issues) {
      const exception = matchingException(i, exceptions);
      if (exception) {
        i.severity = "warning";
        i.reason += `; Original defect: ${exception.reason}`;
      }
    }
    report.inputs = snapshot.selectedFiles
      .map((f) => ({
        courseId: f.courseId,
        path: f.sourcePath,
        sha256: f.hash,
      }))
      .sort((a, b) =>
        (a.courseId + "/" + a.path).localeCompare(b.courseId + "/" + b.path),
      );
    if (report.issues.some((i) => i.severity === "error"))
      throw new Error("Content collection errors");
    const bootstrap = (
      await build({
        stdin: {
          contents:
            "import {installStorage} from './src/compat/storage.ts';import {storageRules} from './config/storage-rules.ts';installStorage(window.__STUDY_HUB__.namespace,storageRules);import {installReaderBridge} from './src/compat/reader-bridge.ts';installReaderBridge(window.__STUDY_HUB__.document.id);",
          resolveDir: process.cwd(),
          loader: "ts",
        },
        bundle: true,
        format: "iife",
        platform: "browser",
        write: false,
        minify: true,
      })
    ).outputFiles[0]!.text;
    const outputs = new Map<string, Uint8Array>();
    for (const file of graph.files) {
      const forbidden = file.sourcePath
        .split("/")
        .some((p) =>
          /^\.git$|^\.env(?:\.|$)|credentials|secrets?\.(?:json|pem)|제작|^backup[-_]/i.test(
            p,
          ),
        );
      if (forbidden) {
        report.issues.push({
          code: "forbidden-output",
          courseId: file.courseId,
          sourcePath: file.sourcePath,
          target: file.sourcePath,
          reason: "Sensitive or production-only file",
          severity: "error",
        });
        continue;
      }
      let bytes = file.bytes;
      if (file.kind !== "asset") {
        let text = rebaseReferences(
          new TextDecoder().decode(bytes),
          file.kind,
          file.courseId,
          file.sourcePath,
        );
        if (file.kind === "html")
          text = transformHtml(
            text,
            catalog.documents.find(
              (d) =>
                d.courseId === file.courseId &&
                d.sourcePath === file.sourcePath,
            )!,
            bootstrap,
          );
        bytes = new TextEncoder().encode(text);
      }
      const path = `content/${file.courseId}/${file.sourcePath.normalize("NFC")}`;
      if (outputs.has(path)) throw new Error(`Output collision: ${path}`);
      outputs.set(path, bytes);
    }
    outputs.set(
      "catalog.json",
      new TextEncoder().encode(JSON.stringify(catalog) + "\n"),
    );
    // Reparse transformed static references against the exact deployment file set.
    for (const f of graph.files.filter((f) => f.kind !== "asset")) {
      const path = `content/${f.courseId}/${f.sourcePath.normalize("NFC")}`,
        bytes = outputs.get(path);
      if (!bytes) continue;
      const text = new TextDecoder().decode(bytes),
        url = new URL(
          "/" + path.split("/").map(encodeURIComponent).join("/"),
          "https://bundle.invalid",
        );
      const base = f.kind === "html" ? extractBase(text) : undefined;
      const originalRefs = extractReferences(
        new TextDecoder().decode(f.bytes),
        f.kind as "html" | "css",
      );
      const transformedRefs = extractReferences(text, f.kind as "html" | "css");
      for (const [index, ref] of transformedRefs.entries()) {
        if (
          !ref ||
          ref.startsWith("#") ||
          /^(data|javascript|mailto|tel|blob):/i.test(ref)
        )
          continue;
        const target = new URL(ref, base ? new URL(base, url) : url);
        if (target.origin !== url.origin) continue;
        const key = decodeURIComponent(target.pathname.slice(1));
        if (!outputs.has(key)) {
          const originalTarget = originalRefs[index] ?? ref;
          const exception = matchingException(
            {
              courseId: f.courseId,
              sourcePath: f.sourcePath,
              target: originalTarget,
            },
            exceptions,
          );
          report.issues.push({
            code: "missing-output",
            courseId: f.courseId,
            sourcePath: f.sourcePath,
            target: originalTarget,
            reason: exception
              ? `Original defect: ${exception.reason}`
              : "Transformed reference has no output",
            severity: exception ? "warning" : "error",
          });
        }
      }
    }
    report.outputs = [...outputs]
      .map(([path, bytes]) => ({
        path,
        sha256: sha(bytes),
        size: bytes.length,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    report.issues.push(...checkBundle(report.outputs, bundleLimits));
    if (report.issues.some((i) => i.severity === "error"))
      throw new Error("Content preflight errors");
    report.bundleHash = sha(
      report.outputs.map((f) => `${f.path}\0${f.sha256}\n`).join(""),
    );
    await mkdir(stage, { recursive: true });
    for (const [path, bytes] of outputs) {
      const target = resolve(stage, path);
      if (!inside(stage, target)) throw new Error("Unsafe output file");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    await verifySnapshot(snapshot);
    await validateReportPath(reportPath, reportExclusions);
    await assertOutput(outputDir);
    await assertOutput(stage);
    await assertOutput(backup);
    let previous = false;
    try {
      await rename(outputDir, backup);
      previous = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    try {
      await rename(stage, outputDir);
    } catch (e) {
      if (previous) {
        await assertOutput(backup);
        await assertOutput(outputDir);
        await rename(backup, outputDir);
      }
      throw e;
    }
    if (previous) {
      await assertOutput(backup);
      await rm(backup, { recursive: true, force: true });
    }
    await writeReport(report, reportPath, reportExclusions);
    return {
      catalog,
      outputDir,
      bundleHash: report.bundleHash,
      reportPath,
      issues: report.issues,
    };
  } catch (error) {
    report.issues.push({
      code: "build-failed",
      courseId: "",
      sourcePath: "",
      target: "",
      reason: (error as Error).message,
      severity: "error",
    });
    await writeReport(report, reportPath, reportExclusions);
    throw new Error(`${(error as Error).message}; report: ${reportPath}`);
  } finally {
    await assertOutput(stage);
    await rm(stage, { recursive: true, force: true });
  }
}
