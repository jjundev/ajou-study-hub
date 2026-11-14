import {
  chromium,
  firefox,
  webkit,
  expect,
  type Page,
} from "@playwright/test";
import { formatRoute } from "../src/app/router.js";
import type { Catalog } from "../src/content/model.js";
import { storageNamespace } from "./content/transform.js";
import type { Observation } from "./verify-content.js";
import { waitForSettledRequests, type RequestSettlement } from "./runtime-readiness.js";
export function trackRepresentativeRequests(page: Page) {
  const state: RequestSettlement = { pending: new Map(), lastActivity: Date.now() };
  page.on("request", request => {
    state.pending.set(request, request.url());
    state.lastActivity = Date.now();
  });
  const finish = (request: unknown) => {
    state.pending.delete(request);
    state.lastActivity = Date.now();
  };
  page.on("requestfinished", finish);
  page.on("requestfailed", finish);
  return () => waitForSettledRequests(state);
}
export async function confirmCancelledCdnRequest(
  url: string, resourceType: string, request: typeof fetch = fetch,
): Promise<boolean> {
  const target = URL.parse(url);
  if (target?.origin !== "https://cdn.jsdelivr.net" || target.username || target.password ||
      !/^\/npm\/(?:pretendard@1\.3\.9|katex@0\.16\.11)\/dist\//.test(target.pathname))
    return false;
  try {
    const response = await request(target.href, {
      credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10000),
    });
    try {
      if (response.status !== 200) return false;
      const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      const path = target.pathname.toLowerCase();
      if (resourceType === "stylesheet") return path.endsWith(".css") && mime === "text/css";
      if (resourceType === "script")
        return path.endsWith(".js") && /^(?:text|application)\/(?:java|ecma)script$/.test(mime ?? "");
      if (resourceType !== "font" || !path.endsWith(".woff2") ||
          !/^(?:font\/woff2|application\/(?:font-woff2|octet-stream))$/.test(mime ?? ""))
        return false;
      const reader = response.body?.getReader();
      if (!reader) return false;
      try {
        const prefix: number[] = [];
        while (prefix.length < 4) {
          const { done, value } = await reader.read();
          if (done) break;
          prefix.push(...value.slice(0, 4 - prefix.length));
        }
        return String.fromCharCode(...prefix) === "wOF2";
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  } catch {
    return false;
  }
}


export const representativePaths = [
  ["life-science", "복습노트/0901/복습문제_0901_Biomolecules_and_Cells.html"],
  ["data-structures", "복습노트/1012/정리노트_1012_Queue.html"],
  ["ml-basics", "복습노트/1012/정리노트_1012_Several_Mathematical_Proofs.html"],
  ["ml-basics", "복습노트/1014/인터렉티브_01_사전분포와_사후분포.html"],
  ["logic-lab", "복습노트/실험01/실험01_문제설명.html"],
  ["logic-lab", "복습노트/실험01/실험01_기출문제.html"],
  ["circuits-2", "복습노트/0909/문제설명_0909_Cascode_Stage.html"],
] as const;
export async function pagerHistory(page: Page, settle = trackRepresentativeRequests(page)) {
  const current = () => page.locator(".screen.is-current").getAttribute("id");
  const routeAnchor = () => page.evaluate(() => decodeURIComponent(location.hash.slice(1)));
  const initial = await current();
  await page.locator("#pager-next").click();
  await expect.poll(current).not.toBe(initial);
  const first = await current();
  await expect.poll(routeAnchor).toBe(first);
  await page.locator("#pager-next").click();
  await expect.poll(current).not.toBe(first);
  const second = await current();
  await expect.poll(routeAnchor).toBe(second);
  await settle();
  await page.goBack();
  await expect.poll(current).toBe(first);
  await expect.poll(routeAnchor).toBe(first);
  await settle();
  await page.goForward();
  await expect.poll(current).toBe(second);
  await expect.poll(routeAnchor).toBe(second);
  await settle();
  await page.reload();
  await expect.poll(current).toBe(second);
  await expect.poll(routeAnchor).toBe(second);
  return { initial, first, second };
}
async function showPanel(page: Page, id: string) {
  const toggle = page.locator('#toggle-' + id);
  if (await toggle.getAttribute('aria-expanded') === 'true') {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#panel-' + id)).toBeVisible();
}

export type Scenario = {
  browser: string;
  width: number;
  documentId: string;
  checks: string[];
  passed: boolean;
  error?: string;
};
export async function verifyRepresentatives(baseUrl: string, catalog: Catalog) {
  const scenarios: Scenario[] = [];
  const observations: Observation[] = [];
  for (const [browserName, engine] of Object.entries({
    chromium,
    firefox,
    webkit,
  })) {
    const browser = await engine.launch();
    try {
      for (const width of [390, 1440]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
        });
        try {
          for (const [courseId, sourcePath] of representativePaths) {
            const doc = catalog.documents.find(
              (d) => d.courseId === courseId && d.sourcePath === sourcePath,
            );
            if (!doc)
              throw Error(
                "Representative missing: " + courseId + "/" + sourcePath,
              );
            const scenario: Scenario = {
              browser: browserName,
              width,
              documentId: doc.id,
              checks: [],
              passed: false,
            };
            scenarios.push(scenario);
            const page = await context.newPage();
            const settle = trackRepresentativeRequests(page);
            page.on("pageerror", (e) =>
              observations.push({
                documentId: doc.id,
                kind: "representative-pageerror",
                target: doc.url,
                reason: e.message,
                classification: "copy",
              }),
            );
            const cancelled = new Map<Observation, string>();
            const completed = new Set<string>();
            page.on("requestfinished", async request => {
              const response = await request.response();
              if (response?.status() === 200) completed.add(request.url());
            });
            page.on("requestfailed", request => {
              const observation: Observation = {
                documentId: doc.id,
                kind: "representative-requestfailed",
                target: request.url(),
                reason: request.failure()?.errorText ?? "failed",
                classification: new URL(request.url()).origin === new URL(baseUrl).origin
                  ? "copy"
                  : "external",
              };
              observations.push(observation);
              if (observation.classification === "external" &&
                  /^(?:net::ERR_ABORTED|NS_BINDING_ABORTED|Cancelled|cancelled)$/.test(observation.reason))
                cancelled.set(observation, request.resourceType());
            });
            page.on("response", (r) => {
              if (r.status() >= 400)
                observations.push({
                  documentId: doc.id,
                  kind: "representative-http",
                  target: r.url(),
                  reason: "HTTP " + r.status(),
                  classification:
                    new URL(r.url()).origin === new URL(baseUrl).origin
                      ? "copy"
                      : "external",
                });
            });
            try {
              const namespace = storageNamespace(doc),
                range = /\/(\d{4})\//.exec(doc.sourcePath)?.[1];
              await page.addInitScript(
                ({ namespace, range, filename, documentPath }) => {
                  if (
                    location.pathname !== documentPath ||
                    sessionStorage.getItem("verification-seeded:" + namespace)
                  )
                    return;
                  sessionStorage.setItem(
                    "verification-seeded:" + namespace,
                    "yes",
                  );
                  if (range) {
                    localStorage.setItem(
                      namespace + "od-note-read:" + range,
                      "{}",
                    );
                    localStorage.setItem(
                      namespace + "od-review-solved:" + range,
                      "null",
                    );
                    localStorage.setItem(
                      namespace + "od-panels:" + range,
                      "null",
                    );
                    sessionStorage.setItem(
                      namespace +
                        "od-review-attempt:v1:" +
                        encodeURIComponent(filename) +
                        ":p1",
                      '{"version":1,"selected":[]}',
                    );
                  }
                },
                {
                  namespace,
                  range,
                  filename: doc.sourcePath.split("/").at(-1)!,
                  documentPath: doc.url,
                },
              );
              const documentURL = baseUrl + doc.url;
              await page.goto(baseUrl + '/' + formatRoute({
                kind: 'catalog', courseId: doc.courseId, groupId: doc.groupId ?? undefined,
              }));
              await page.locator(`#material-list a[data-document="${doc.id}"]`).click();
              await expect(page).toHaveURL(documentURL);
              await expect(page.locator("body")).toBeVisible();
              scenario.checks.push("catalog link opens the source body in the current tab");
              if (range)
                scenario.checks.push(
                  "malformed native object/array/null values do not prevent source UI",
                );
              if (sourcePath.includes("기출문제")) {
                await expect(page.locator("html")).toHaveAttribute(
                  "data-ready",
                  "true",
                  { timeout: 30000 },
                );
                await expect(page.locator("#book .page")).toHaveCount(12);
                const imgs = page.locator("img");
                expect(await imgs.count()).toBeGreaterThan(0);
                for (let i = 0; i < (await imgs.count()); i++) {
                  await imgs.nth(i).scrollIntoViewIfNeeded();
                  await expect
                    .poll(() =>
                      imgs
                        .nth(i)
                        .evaluate(
                          (el) => (el as HTMLImageElement).naturalWidth,
                        ),
                    )
                    .toBeGreaterThan(0);
                }
                scenario.checks.push(
                  "12 generated workbook pages and every generated image",
                );
              } else if (sourcePath.includes("인터렉티브")) {
                await expect(page.locator("canvas")).toBeVisible();
                const control = page.locator("#number-n");
                if (!(await control.isVisible()))
                  await page
                    .getByRole("button", { name: "조작 패널", exact: true })
                    .click();
                await expect(control).toBeVisible();
                const before = await control.inputValue();
                const canvasPixels = () =>
                  page
                    .locator("canvas")
                    .evaluate((el) => (el as HTMLCanvasElement).toDataURL());
                const beforePixels = await canvasPixels();
                await control.fill(before === "3" ? "1" : "3");
                await control.press("Tab");
                await expect(control).not.toHaveValue(before);
                await expect.poll(canvasPixels).not.toBe(beforePixels);
                await page
                  .getByRole("button", { name: "설정 처음으로", exact: true })
                  .click();
                await expect(control).toHaveValue(before);
                scenario.checks.push(
                  "simulation input and reset, canvas rendered",
                );
              } else {
                await expect(page.locator("#pager-next")).toBeVisible();
                await pagerHistory(page, settle);
                scenario.checks.push(
                  "source Next twice, browser back/forward, refresh preserves screen",
                );
                if (courseId === "life-science") {
                  for (
                    let i = 0;
                    i < 12 &&
                    !(await page.locator(".review-choice:visible").count());
                    i++
                  )
                    await page.locator("#pager-next").click();
                  const choice = page
                    .locator(".review-choice:visible")
                    .first();
                  await choice.click();
                  await expect(choice).toHaveAttribute("aria-expanded", "true");
                  const attempts = () =>
                    page.locator("body").evaluate(() =>
                      Object.keys(sessionStorage)
                        .filter(
                          (k) =>
                            k.startsWith("od-review-attempt:v1:") &&
                            sessionStorage.getItem(k) !== null,
                        )
                        .map((k) => ({
                          key: k,
                          value: JSON.parse(sessionStorage.getItem(k)!),
                        })),
                    );
                  expect((await attempts()).length).toBeGreaterThan(0);
                  const saved = await attempts();
                  await settle();
                  await page.reload();
                  expect(await attempts()).toEqual(saved);
                  scenario.checks.push(
                    "question selection, feedback and session attempt survive refresh",
                  );
                  const fresh = await context.newPage();
                  try {
                    await fresh.goto(documentURL, {
                      waitUntil: "networkidle",
                    });
                    expect(
                      await fresh
                        .locator("body")
                        .evaluate(
                          () =>
                            Object.keys(sessionStorage).filter(
                              (k) =>
                                k.startsWith("od-review-attempt:v1:") &&
                                sessionStorage.getItem(k) !== null,
                            ).length,
                        ),
                    ).toBe(0);
                  } finally {
                    await fresh.close();
                  }
                  scenario.checks.push("new tab session has no copied attempt");
                  await showPanel(page, "right");
                  scenario.checks.push("solution panel user toggle");
                } else {
                  if (courseId === "ml-basics" || courseId === "circuits-2") {
                    expect(
                      await page.locator(".katex").count(),
                    ).toBeGreaterThan(0);
                    await expect(page.locator(".katex-error")).toHaveCount(0);
                    scenario.checks.push(
                      "KaTeX rendered without parse error spans",
                    );
                  }
                  if (courseId === "ml-basics") {
                    for (
                      let i = 0;
                      i < 25 &&
                      !(await page.locator("#lmap-a:visible").count());
                      i++
                    )
                      await page.locator("#pager-next").click();
                    const value = page.locator("#lmap-area");
                    const old = await value.textContent();
                    await page.locator("#lmap-a").focus();
                    await page.locator("#lmap-a").press("ArrowRight");
                    await expect(value).not.toHaveText(old!);
                    scenario.checks.push(
                      "linear-map slider updates determinant readout",
                    );
                    await settle();
                    await page.goto(baseUrl + "/");
                    const sameDate = await page.evaluate(() =>
                      Object.keys(localStorage)
                        .filter((k) => k.endsWith("od-note-read:1012"))
                        .map((k) => ({
                          key: k,
                          value: localStorage.getItem(k),
                        })),
                    );
                    expect(sameDate.length).toBe(2);
                    expect(
                      sameDate.some((v) => v.key.includes(":data-structures:")),
                    ).toBe(true);
                    expect(
                      sameDate.some((v) => v.key.includes(":ml-basics:")),
                    ).toBe(true);
                    scenario.checks.push(
                      "1012 notes from two courses retain distinct native storage keys",
                    );
                  }
                  if (courseId === "circuits-2") {
                    const dockedProblem = page.locator("#toggle-prob");
                    if (await dockedProblem.isVisible()) {
                      await showPanel(page, "prob");
                      await expect(page.locator("#panel-prob .problem-pane:visible")).toHaveCount(1);
                    } else {
                      const problemToggle = page.locator(".screen.is-current .problem-toggle");
                      await problemToggle.click();
                      await expect(problemToggle).toHaveAttribute("aria-expanded", "true");
                      await expect(page.locator(".screen.is-current .problem-pane")).toBeVisible();
                    }
                    await showPanel(page, "right");
                    scenario.checks.push("problem reveal and summary panel user toggle");
                  }
                }
              }
              await settle();
              scenario.passed = true;
            } catch (e) {
              scenario.error = (e as Error).message;
            } finally {
              await page.close();
              if (scenario.passed) {
                for (const [observation, resourceType] of cancelled) {
                  const available = completed.has(observation.target) ||
                    await confirmCancelledCdnRequest(observation.target, resourceType);
                  if (available) observations.splice(observations.indexOf(observation), 1);
                }
              }
              console.log(
                `Representative ${browserName} ${width} ${courseId}: ${scenario.passed ? "PASS" : "FAIL " + scenario.error}`,
              );
            }
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  return {
    complete: scenarios.length === 42 && scenarios.every((s) => s.passed),
    scenarios,
    observations,
  };
}
