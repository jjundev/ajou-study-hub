import {
  waitForSettledRequests,
  type RequestSettlement,
} from "./runtime-readiness.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";
import type { Catalog, DocumentInfo, Issue } from "../src/content/model.js";
import { validateReportPath, writeReport } from "./content/report.js";
export type RuntimeResult = {
  passed: boolean;
  documentsChecked: number;
  issues: Issue[];
  deploymentEligible: boolean;
};
export type Observation = {
  documentId: string;
  kind: string;
  target: string;
  reason: string;
  classification: "copy" | "original" | "external";
};
/** Only matching observed failures establish an original defect; inaccessible probes remain unproven. */
export function classifyAgainstOriginal(
  copied: Observation[],
  original: Observation[],
  unprovenPaths: string[] = [],
): void {
  for (const o of copied) {
    if (o.classification !== "copy") continue;
    const path = new URL(o.target).pathname;
    if (unprovenPaths.includes(decodeURIComponent(path))) continue;
    if (
      original.some(
        (b) =>
          b.documentId === o.documentId &&
          b.kind === o.kind &&
          b.reason === o.reason &&
          new URL(b.target).pathname === path,
      )
    )
      o.classification = "original";
  }
}
export type LoadEvidence = {
  documentId: string;
  responses: { url: string; status: number }[];
  title?: string;
  images?: number;
  pendingRequests?: string[];
};
export async function observePage(
  page: Page,
  url: string,
  doc: DocumentInfo,
  act?: (page: Page) => Promise<void>,
  evidence?: LoadEvidence,
): Promise<Observation[]> {
  const observations: Observation[] = [];
  const settlement: RequestSettlement = {
    pending: new Map(),
    lastActivity: Date.now(),
  };
  page.on("request", (r) => {
    settlement.pending.set(r, r.url());
    settlement.lastActivity = Date.now();
  });
  const terminal = (r: unknown) => {
    settlement.pending.delete(r);
    settlement.lastActivity = Date.now();
  };
  page.on("requestfinished", terminal);
  page.on("requestfailed", terminal);
  const origin = new URL(url).origin;
  const add = (kind: string, target: string, reason: string) => {
    if (
      !observations.some(
        (o) => o.kind === kind && o.target === target && o.reason === reason,
      )
    )
      observations.push({
        documentId: doc.id,
        kind,
        target,
        reason,
        classification:
          new URL(target, url).origin === origin ? "copy" : "external",
      });
  };
  const settle = async () => {
    try {
      await waitForSettledRequests(settlement);
    } catch (error) {
      for (const url of settlement.pending.values())
        add(
          "unsettled-request",
          url,
          "Request has no terminal event after 15000ms",
        );
      throw error;
    }
  };
  page.on("requestfailed", (r) =>
    add("requestfailed", r.url(), r.failure()?.errorText ?? "request failed"),
  );
  page.on("response", (r) => {
    evidence?.responses.push({ url: r.url(), status: r.status() });
    if (r.status() >= 400) add("http", r.url(), `HTTP ${r.status()}`);
  });
  page.on("pageerror", (e) => add("pageerror", url, e.message));
  try {
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await settle();
    if (act) await act(page);
    await page.evaluate(async () => {
      for (const img of document.images) {
        img.loading = "eager";
      }
      await Promise.all(
        [...document.images].map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((r) => {
                img.addEventListener("load", () => r(), { once: true });
                img.addEventListener("error", () => r(), { once: true });
                setTimeout(r, 3000);
              }),
        ),
      );
    });
    for (const broken of await page
      .locator("img")
      .evaluateAll((imgs) =>
        (imgs as HTMLImageElement[])
          .filter((i) => !i.complete || !i.naturalWidth)
          .map((i) => i.currentSrc || i.src),
      ))
      add("image", broken, "Image has no decoded pixels");
    await settle();
    if (evidence) {
      evidence.title = await page.title();
      evidence.images = await page.locator("img").count();
    }
  } catch (e) {
    add("navigation", url, (e as Error).message);
  }
  if (evidence) evidence.pendingRequests = [...settlement.pending.values()];
  return observations;
}
export async function verifyContent(options: {
  baseUrl: string;
  catalog: Catalog;
  reportDir: string;
}): Promise<RuntimeResult> {
  const reportPath = resolve(options.reportDir, "verification.json");
  await validateReportPath(reportPath);
  const browser = await chromium.launch();
  const observations: Observation[] = [];
  const documents: LoadEvidence[] = [];
  let documentsChecked = 0;
  try {
    for (const doc of options.catalog.documents) {
      const page = await browser.newPage();
      try {
        const evidence: LoadEvidence = { documentId: doc.id, responses: [] };
        documents.push(evidence);
        observations.push(
          ...(await observePage(
            page,
            new URL(doc.url, options.baseUrl).href,
            doc,
            undefined,
            evidence,
          )),
        );
        documentsChecked++;
      } finally {
        await page.close();
      }
      if (documentsChecked % 10 === 0)
        console.log(
          `Runtime ${documentsChecked}/${options.catalog.documents.length}`,
        );
    }
  } finally {
    await browser.close();
  }
  const issues = observations.map((o) => {
    const doc = options.catalog.documents.find((d) => d.id === o.documentId)!;
    return {
      code: `runtime-${o.classification}-${o.kind}`,
      courseId: doc.courseId,
      sourcePath: doc.sourcePath,
      target: o.target,
      reason: o.reason,
      severity: "error" as const,
    };
  });
  const result = {
    passed: issues.length === 0,
    documentsChecked,
    issues,
    deploymentEligible: false,
  };
  await writeReport(
    { ...result, createdAt: new Date().toISOString(), observations, documents },
    reportPath,
  );
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  void (async () => {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--sources")
      throw Error("Usage: verify:content -- --sources .local/sources.json");
    const { verifyActual } = await import("./verify-actual.js");
    const result = await verifyActual(args[1]!);
    if (!result.passed) process.exitCode = 1;
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
