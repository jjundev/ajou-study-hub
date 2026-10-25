import { verificationProject } from "./verification-project.js";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { runtimeIssue, type RuntimeException } from "./runtime-exceptions.js";
import { buildCatalog } from "./content/catalog.js";
import { courses } from "../config/courses.js";
import {
  inspectSources,
  verifySnapshot,
  type SourceSettings,
} from "./content/source.js";
import type { BuildReport } from "./content/report.js";
import { validateReportPath, writeReport } from "./content/report.js";
import { assertCurrentBundle, serveManifest } from "./runtime-server.js";
import {
  observePage,
  classifyAgainstOriginal,
  type Observation,
  type LoadEvidence,
} from "./verify-content.js";
import { auditWorkbookFigures } from "./runtime-workbooks.js";
import { verifyRepresentatives } from "./representatives.js";
import type { Catalog } from "../src/content/model.js";
export async function verifyActual(
  sourcesPath: string,
  options: { reportPath?: string; testProjectRoot?: string } = {},
) {
  const startedAt = Date.now();
  const projectRoot = await verificationProject(options.testProjectRoot);
  const canonicalProof = resolve(projectRoot, ".reports/verification.json");
  const running = {
    createdAt: new Date().toISOString(),
    passed: false,
    deploymentEligible: false,
    status: "running",
  };
  await writeReport(
    running,
    canonicalProof,
    [resolve(projectRoot, "dist")],
    projectRoot,
  );
  const parsed: unknown = JSON.parse(
    await readFile(resolve(projectRoot, sourcesPath), "utf8"),
  );
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  if (
    !record(parsed) ||
    !record(parsed.roots) ||
    !record(parsed.explicitUntracked) ||
    !courses.every(
      (c) =>
        typeof (parsed.roots as Record<string, unknown>)[c.id] === "string" &&
        String((parsed.roots as Record<string, unknown>)[c.id]).trim(),
    ) ||
    !Object.values(parsed.roots).every(
      (v) => typeof v === "string" && v.trim(),
    ) ||
    !Object.values(parsed.explicitUntracked).every(
      (v) => Array.isArray(v) && v.every((p) => typeof p === "string"),
    )
  )
    throw Error("Invalid source settings");
  const settings: SourceSettings = {
    roots: Object.fromEntries(
      Object.entries(parsed.roots).map(([k, v]) => [
        k,
        resolve(projectRoot, v as string),
      ]),
    ),
    explicitUntracked: parsed.explicitUntracked as Record<string, string[]>,
  };
  const reportPath = resolve(
    projectRoot,
    options.reportPath ?? ".reports/verification.json",
  );
  const exclusions = [
    resolve(projectRoot, "dist"),
    ...Object.values(settings.roots),
  ];
  await validateReportPath(reportPath, exclusions, projectRoot);
  if (reportPath !== canonicalProof)
    await writeReport(running, reportPath, exclusions, projectRoot);
  // Fail closed even when the source checkout cannot be inspected.
  const snapshot = await inspectSources(courses, settings, {
    batchTracking: true,
  });
  const manifest = JSON.parse(
    await readFile(resolve(projectRoot, ".reports/app-build.json"), "utf8"),
  ) as BuildReport;
  console.log(`Checking ${manifest.outputs.length} app bundle outputs`);
  await assertCurrentBundle(
    resolve(projectRoot, "dist"),
    manifest,
    projectRoot,
  );
  if (JSON.stringify(manifest.sources) !== JSON.stringify(snapshot.provenance))
    throw Error(
      "Current source tracking/provenance differs from app manifest; rebuild required",
    );
  // Verify manifest inputs against current tracked/allowed bytes, including intentionally dirty files.
  let inputCount = 0;
  console.log(`Checking ${manifest.inputs.length} current source inputs`);
  for (const input of manifest.inputs) {
    const bytes = await snapshot.readFile(input.courseId, input.path);
    if (++inputCount % 1000 === 0)
      console.log(`Source hashes ${inputCount}/${manifest.inputs.length}`);
    if (createHash("sha256").update(bytes).digest("hex") !== input.sha256)
      throw Error("Changed source input: " + input.courseId + "/" + input.path);
  }
  const catalog = JSON.parse(
    await readFile(resolve(projectRoot, "dist/catalog.json"), "utf8"),
  ) as Catalog;
  const currentCatalog = await buildCatalog(snapshot);
  if (
    JSON.stringify(
      currentCatalog.documents
        .filter((d) => d.listed)
        .sort((a, b) => a.id.localeCompare(b.id)),
    ) !==
    JSON.stringify(
      catalog.documents
        .filter((d) => d.listed)
        .sort((a, b) => a.id.localeCompare(b.id)),
    )
  )
    throw Error("Catalog differs from current source HTML selection");
  const dynamicAssets = await auditWorkbookFigures(
    catalog.documents,
    snapshot.readFile,
    manifest.outputs.map((f) => f.path),
  );
  const server = await serveManifest(resolve(projectRoot, "dist"), manifest);
  const observations: Observation[] = [];
  const documents: LoadEvidence[] = [];
  let checked = 0;
  try {
    const browser = await chromium.launch();
    let next = 0;
    try {
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (next < catalog.documents.length) {
            const doc = catalog.documents[next++]!;
            const page = await browser.newPage();
            try {
              const evidence: LoadEvidence = {
                documentId: doc.id,
                responses: [],
              };
              documents.push(evidence);
              observations.push(
                ...(await observePage(
                  page,
                  new URL(doc.url, server.baseUrl).href,
                  doc,
                  undefined,
                  evidence,
                )),
              );
            } finally {
              await page.close();
              checked++;
              if (checked % 10 === 0)
                console.log(
                  `Actual Chromium ${checked}/${catalog.documents.length}`,
                );
            }
          }
        }),
      );
    } finally {
      await browser.close();
    }
    // Only failures trigger a bounded original comparison. The original server probes content targets;
    // original bytes must pass the same tracked-file + allowed-root + realpath snapshot reader.
    const exceptions = JSON.parse(
      await readFile(
        resolve(projectRoot, "config/content-exceptions.json"),
        "utf8",
      ),
    ) as RuntimeException[];
    const fontFallbackChecks: {
      documentId: string;
      source: unknown;
      copy: unknown;
      readable: boolean;
    }[] = [];
    const failures = new Set(
      observations
        .filter((o) => o.classification === "copy")
        .map((o) => o.documentId),
    );
    const fallbackDocuments = catalog.documents.filter((doc) =>
      exceptions.some(
        (e) =>
          e.runtime &&
          e.courseId === doc.courseId &&
          e.sourcePath === doc.sourcePath,
      ),
    );
    if (failures.size || fallbackDocuments.length) {
      const baseline = await serveManifest(
        resolve(projectRoot, "dist"),
        manifest,
        async (p) => {
          const match = /^content\/([^/]+)\/(.+)$/.exec(p);
          return match
            ? snapshot.readFile(match[1]!, match[2]!)
            : readFile(resolve(projectRoot, "dist", p));
        },
      );
      const browser = await chromium.launch();
      try {
        for (const doc of fallbackDocuments) {
          const evidence = [];
          for (const scope of ["source", "copy"] as const) {
            const page = await browser.newPage();
            try {
              const seen = await observePage(
                page,
                new URL(
                  doc.url,
                  scope === "source" ? baseline.baseUrl : server.baseUrl,
                ).href,
                doc,
              );
              observations.push(
                ...seen.map((o) => ({ ...o, probe: "font-" + scope })),
              );
              const state = await page.locator("body").evaluate((el) => ({
                text: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
                fontStack: getComputedStyle(el).fontFamily,
                width: el.getBoundingClientRect().width,
                height: el.getBoundingClientRect().height,
              }));
              evidence.push(state);
            } finally {
              await page.close();
            }
          }
          const [source, copy] = evidence;
          const readable =
            !!source &&
            !!copy &&
            source.text.length > 100 &&
            source.text === copy.text &&
            source.width > 0 &&
            copy.width > 0 &&
            source.height > 0 &&
            copy.height > 0 &&
            source.fontStack.includes("sans-serif") &&
            copy.fontStack.includes("sans-serif");
          fontFallbackChecks.push({
            documentId: doc.id,
            source,
            copy,
            readable,
          });
          if (!readable)
            observations.push({
              documentId: doc.id,
              kind: "font-fallback-content",
              target: doc.url,
              reason: "Original/copy fallback text differs or is not readable",
              classification: "copy",
            });
        }
        for (const id of failures) {
          const doc = catalog.documents.find((d) => d.id === id)!;
          const page = await browser.newPage();
          try {
            const original = await observePage(
              page,
              new URL(doc.url, baseline.baseUrl).href,
              doc,
            );
            classifyAgainstOriginal(
              observations.filter((o) => o.documentId === id),
              original,
              baseline.unprovenPaths,
            );
          } finally {
            await page.close();
          }
        }
      } finally {
        await browser.close();
        await baseline.close();
      }
    }
    const representatives = await verifyRepresentatives(
      server.baseUrl,
      catalog,
    );
    observations.push(...representatives.observations);
    await assertCurrentBundle(
      resolve(projectRoot, "dist"),
      manifest,
      projectRoot,
    );
    await verifySnapshot(snapshot);
    const after = await inspectSources(courses, settings, {
      batchTracking: true,
    });
    if (
      JSON.stringify(after.provenance) !== JSON.stringify(snapshot.provenance)
    )
      throw Error("Source tracking/provenance changed during verification");
    const issues = observations.map((o) => {
      const issue = runtimeIssue(
        o,
        catalog.documents.find((d) => d.id === o.documentId)!,
        exceptions,
      );
      return {
        ...issue,
        target: issue.target.replace(server.baseUrl, "{bundle}"),
      };
    });
    const uniqueIssues = issues.filter(
      (issue, index) =>
        issues.findIndex(
          (other) => JSON.stringify(other) === JSON.stringify(issue),
        ) === index,
    );
    const passed =
      uniqueIssues.every((i) => i.severity !== "error") &&
      representatives.complete;
    const result = {
      version: 1,
      scope: "actual-app-runtime",
      catalogHash: manifest.outputs.find((f) => f.path === "catalog.json")!
        .sha256,
      status: "complete",
      createdAt: new Date().toISOString(),
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      passed,
      documentsChecked: checked,
      issues: uniqueIssues,
      observations,
      documents,
      bundleHash: manifest.bundleHash,
      inputs: manifest.inputs,
      sources: snapshot.provenance,
      integrityChecks: {
        sourceHashesUnchanged: true,
        bundleBytesUnchanged: true,
        sourceTrackingUnchanged: true,
        inputCount: manifest.inputs.length,
        outputCount: manifest.outputs.length,
      },
      deploymentEligible: passed && !options.testProjectRoot,
      representatives,
      dynamicAssets,
      exceptions,
      fontFallbackChecks,
    };
    await writeReport(result, reportPath, exclusions, projectRoot);
    console.log(
      JSON.stringify({
        checked,
        issues: uniqueIssues.length,
        errors: uniqueIssues.filter((i) => i.severity === "error").length,
        representatives: representatives.scenarios.length,
        passed,
        reportPath,
      }),
    );
    return result;
  } finally {
    await server.close();
  }
}
