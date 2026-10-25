import { readFile } from "node:fs/promises";
import {
  runtimeIssue,
  type RuntimeException,
} from "../../tools/runtime-exceptions.js";
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import {
  verifyContent,
  observePage,
  classifyAgainstOriginal,
} from "../../tools/verify-content.js";
import type { Catalog } from "../../src/content/model.js";
test("reports every document and catches image CSS dynamic fetch and runtime failures", async () => {
  const server = createServer((req, res) => {
    const routes: Record<string, string> = {
      "/a.html":
        '<img src="missing.png"><link rel="stylesheet" href="/style.css"><script>fetch("dynamic.json");throw Error("injected runtime")</script>',
      "/b.html": "<h1>healthy</h1>",
      "/style.css": "body{background:url(nested.png)}",
    };
    const body = routes[req.url!];
    res.writeHead(body ? 200 : 404, {
      "content-type": req.url === "/style.css" ? "text/css" : "text/html",
    });
    res.end(body ?? "missing");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const address = server.address() as { port: number };
    const catalog: Catalog = {
      version: 1,
      courses: [],
      groups: [],
      documents: ["a", "b"].map((id) => ({
        id,
        courseId: "fixture",
        groupId: null,
        title: id,
        type: "note",
        listed: id === "a",
        sourcePath: id + ".html",
        url: "/" + id + ".html",
      })),
    };
    const result = await verifyContent({
      baseUrl: `http://127.0.0.1:${address.port}`,
      catalog,
      reportDir: ".reports/synthetic-runtime/" + test.info().project.name,
    });
    expect(result.passed).toBe(false);
    expect(result.documentsChecked).toBe(2);
    for (const target of ["missing.png", "nested.png", "dynamic.json"])
      expect(result.issues.some((i) => i.target.endsWith(target))).toBe(true);
    expect(
      result.issues.some((i) => i.reason.includes("injected runtime")),
    ).toBe(true);
    expect(result.deploymentEligible).toBe(false);
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});

test("distinguishes original defects, omitted copy resources and external failures", async ({
  browser,
}) => {
  const make = (original: boolean) =>
    createServer((req, res) => {
      if (req.url === "/a.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end('<img src="dynamic.png"><img src="broken.png">');
      } else if (original && req.url === "/dynamic.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=",
            "base64",
          ),
        );
      } else {
        res.writeHead(404);
        res.end("missing");
      }
    });
  const copy = make(false),
    original = make(true);
  await Promise.all([
    new Promise<void>((r) => copy.listen(0, "127.0.0.1", r)),
    new Promise<void>((r) => original.listen(0, "127.0.0.1", r)),
  ]);
  const doc = {
    id: "a",
    courseId: "fixture",
    groupId: null,
    title: "a",
    type: "note" as const,
    sourcePath: "a.html",
    url: "/a.html",
    listed: true,
  };
  const a = await browser.newPage(),
    b = await browser.newPage();
  try {
    const copied = await observePage(
      a,
      "http://127.0.0.1:" +
        (copy.address() as { port: number }).port +
        "/a.html",
      doc,
    );
    const baseline = await observePage(
      b,
      "http://127.0.0.1:" +
        (original.address() as { port: number }).port +
        "/a.html",
      doc,
    );
    copied.push({
      documentId: "a",
      kind: "http",
      target: "https://cdn.invalid/lib.js",
      reason: "HTTP 503",
      classification: "external",
    });
    classifyAgainstOriginal(copied, baseline);
    expect(
      copied
        .filter((o) => o.target.endsWith("dynamic.png"))
        .every((o) => o.classification === "copy"),
    ).toBe(true);
    expect(
      copied
        .filter((o) => o.target.endsWith("broken.png"))
        .every((o) => o.classification === "original"),
    ).toBe(true);
    expect(copied.at(-1)?.classification).toBe("external");
  } finally {
    await a.close();
    await b.close();
    await Promise.all([
      new Promise<void>((r) => copy.close(() => r())),
      new Promise<void>((r) => original.close(() => r())),
    ]);
  }
});

test("a dynamically requested response without a terminal event fails readiness", async ({
  page,
}) => {
  test.setTimeout(45000);
  const exceptions = JSON.parse(
    await readFile("config/content-exceptions.json", "utf8"),
  ) as RuntimeException[];
  const known = exceptions.find((e) => e.runtime)!;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route(known.target, async (route) => {
    await gate;
    await route.abort();
  });
  const server = createServer((req, res) => {
    if (req.url === "/forever.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.flushHeaders();
      res.write('{"pending":');
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        '<h1>Ready</h1><script>fetch("/forever.json");fetch(' +
          JSON.stringify(known.target) +
          ")</script>",
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const doc = {
      id: "hanging",
      courseId: known.courseId,
      groupId: null,
      title: "hanging",
      type: "note" as const,
      sourcePath: known.sourcePath,
      url: "/hanging.html",
      listed: true,
    };
    const observations = await observePage(
      page,
      "http://127.0.0.1:" +
        (server.address() as { port: number }).port +
        "/hanging.html",
      doc,
    );
    expect(
      observations.some(
        (o) =>
          o.kind === "unsettled-request" && o.target.endsWith("/forever.json"),
      ),
    ).toBe(true);
    const fontHanging = observations.find(
      (o) => o.kind === "unsettled-request" && o.target === known.target,
    );
    expect(fontHanging).toBeDefined();
    expect(runtimeIssue(fontHanging!, doc, exceptions).severity).toBe("error");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
