import { expect, test } from "vitest";
import { readFile, unlink, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createSourceFixture } from "../fixtures/source.js";
import { buildContent } from "../../tools/content/build.js";
import { checkBundle } from "../../tools/content/preflight.js";
import { inspectSources, verifySnapshot } from "../../tools/content/source.js";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const limits = { maxFiles: 20000, maxFileBytes: 25 * 1024 * 1024 };
test("limits", () => {
  expect(
    checkBundle(
      Array.from({ length: 20000 }, (_, i) => ({ path: `${i}`, size: 1 })),
      limits,
    ),
  ).toEqual([]);
  expect(
    checkBundle(
      Array.from({ length: 20001 }, (_, i) => ({ path: `${i}`, size: 1 })),
      limits,
    ),
  ).not.toEqual([]);
  expect(
    checkBundle([{ path: "x.pdf", size: 25 * 1024 * 1024 + 1 }], limits),
  ).not.toEqual([]);
});
test("reproducible_output, immutable_sources, no_stale_files and explicit untracked", async () => {
  const f = await createSourceFixture();
  const outputDir = resolve(".generated/test-build-" + Date.now());
  try {
    const p = "복습노트/1024/a.html";
    await f.write(
      p,
      '<title>fixture</title><a href="/복습노트/1024/b.html">next</a>',
    );
    await f.write("복습노트/1024/b.html", "<title>b</title>");
    await f.track();
    await f.write("복습노트/1024/explicit.html", "explicit");
    await f.write("복습노트/1024/hidden.html", "hidden");
    f.settings.explicitUntracked[f.config.id] = ["복습노트/1024/explicit.html"];
    const before = hash(await readFile(resolve(f.root, p)));
    const options = {
      settings: f.settings,
      configs: [f.config],
      outputDir,
      reportDir: resolve(".reports/test-build"),
    };
    const first = await buildContent(options),
      second = await buildContent(options);
    expect(second.bundleHash).toBe(first.bundleHash);
    expect(second.catalog).toEqual(first.catalog);
    expect(hash(await readFile(resolve(f.root, p)))).toBe(before);
    expect(second.catalog.documents).toHaveLength(3);
    expect(
      await readFile(resolve(outputDir, "content", f.config.id, p), "utf8"),
    ).toContain("/content/logic-lab/");
    await f.write(p, "<title>fixture</title>");
    await unlink(resolve(f.root, "복습노트/1024/b.html"));
    await f.track();
    await buildContent(options);
    await expect(
      readFile(
        resolve(outputDir, "content", f.config.id, "복습노트/1024/b.html"),
      ),
    ).rejects.toThrow();
  } finally {
    await f.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});
test("refuses_mixed_snapshot and records original bytes/hash", async () => {
  const f = await createSourceFixture();
  try {
    const p = "복습노트/1024/a.html";
    await f.write(p, "before");
    await f.track();
    const s = await inspectSources([f.config], f.settings, {
      batchTracking: true,
    });
    const bytes = await s.readFile(f.config.id, p);
    expect(s.selectedFiles[0]?.bytes).toEqual(bytes);
    expect(s.selectedFiles[0]?.hash).toBe(hash(bytes));
    await f.write(p, "after");
    await expect(s.readFile(f.config.id, p)).rejects.toThrow("changed");
    await expect(verifySnapshot(s)).rejects.toThrow("changed");
  } finally {
    await f.dispose();
  }
});
test("refuses unexplained missing, sensitive and production-log links", async () => {
  for (const name of [
    "missing.png",
    ".env",
    ".git/config",
    "credentials.json",
    "제작로그.html",
  ]) {
    const f = await createSourceFixture();
    const outputDir = resolve(".generated/reject-" + Date.now());
    try {
      await f.write("복습노트/1024/a.html", `<a href="../${name}">bad</a>`);
      if (name !== "missing.png") await f.write("복습노트/" + name, "secret");
      await f.track();
      await expect(
        buildContent({
          settings: f.settings,
          configs: [f.config],
          outputDir,
          reportDir: resolve(".reports/test-build"),
        }),
      ).rejects.toThrow();
    } finally {
      await f.dispose();
      await rm(outputDir, { recursive: true, force: true });
    }
  }
}, 120000);
test("rejects the entire environment prefix in nested source references", async () => {
  const f = await createSourceFixture(), outputDir = resolve('.generated/reject-env-' + Date.now());
  try {
    await f.write('복습노트/1024/a.html', '<a href="../.envrc">shell</a><a href="../nested/.ENVproduction">production</a>');
    await f.write('복습노트/.envrc', 'secret');
    await f.write('복습노트/nested/.ENVproduction', 'secret');
    await f.track();
    await expect(buildContent({settings:f.settings,configs:[f.config],outputDir,reportDir:resolve('.reports/test-build-env')})).rejects.toThrow();
    const report = JSON.parse(await readFile(resolve('.reports/test-build-env/content-build.json'), 'utf8'));
    expect(report.issues.filter((i:{code:string})=>i.code==='forbidden-output')).toHaveLength(2);
  } finally { await f.dispose(); await rm(outputDir,{recursive:true,force:true}); }
});
test("rejects output paths outside project generated directory", async () => {
  await expect(
    buildContent({
      settings: { roots: {}, explicitUntracked: {} },
      outputDir: resolve("../escape"),
      reportDir: resolve(".reports"),
    }),
  ).rejects.toThrow("output");
});
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { vi } from "vitest";
import * as transformer from "../../tools/content/transform.js";
test("final live tracking validation rejects stale snapshot authorization", async () => {
  const f = await createSourceFixture();
  try {
    const p = "복습노트/1024/a.html";
    await f.write(p, "before");
    await f.track();
    const s = await inspectSources([f.config], f.settings, {
      batchTracking: true,
    });
    await s.readFile(f.config.id, p);
    execFileSync("git", ["rm", "--cached", "--", p], { cwd: f.root });
    await expect(verifySnapshot(s)).rejects.toThrow("no longer tracked");
  } finally {
    await f.dispose();
  }
});
test("mixed input aborts publication and preserves previous output", async () => {
  const f = await createSourceFixture(),
    outputDir = resolve(".generated/mixed-" + Date.now());
  try {
    const p = "복습노트/1024/a.html";
    await f.write(p, "before");
    await f.track();
    const options = {
      settings: f.settings,
      configs: [f.config],
      outputDir,
      reportDir: resolve(".reports/test-build"),
    };
    const first = await buildContent(options);
    const original = transformer.transformHtml;
    const spy = vi
      .spyOn(transformer, "transformHtml")
      .mockImplementation((...args) => {
        writeFileSync(resolve(f.root, p), "changed");
        return original(...args);
      });
    try {
      await expect(buildContent(options)).rejects.toThrow("changed");
    } finally {
      spy.mockRestore();
    }
    expect(
      JSON.parse(await readFile(resolve(outputDir, "catalog.json"), "utf8")),
    ).toEqual(first.catalog);
  } finally {
    await f.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});
test("rebases HTML base, CSS imports, inline CSS, root-relative URLs and srcset", async () => {
  const f = await createSourceFixture(),
    outputDir = resolve(".generated/rebase-" + Date.now());
  try {
    await f.write(
      "복습노트/1024/a.html",
      '<base href="/복습노트/"><link href="style.css"><img srcset="img.png 1x, other.png 2x"><style>body{background:url(/복습노트/img.png)}</style><b style="background:url(img.png)">x</b>',
    );
    await f.write(
      "복습노트/style.css",
      '@import "/복습노트/other.css";a{background:url(/복습노트/img.png)}',
    );
    for (const p of ["other.css", "img.png", "other.png"])
      await f.write("복습노트/" + p, "");
    await f.track();
    const result = await buildContent({
      settings: f.settings,
      configs: [f.config],
      outputDir,
      reportDir: resolve(".reports/test-build"),
    });
    expect(result.issues).toEqual([]);
    const html = await readFile(
      resolve(outputDir, "content/logic-lab/복습노트/1024/a.html"),
      "utf8",
    );
    expect(html).toContain(
      "/content/logic-lab/%EB%B3%B5%EC%8A%B5%EB%85%B8%ED%8A%B8/img.png",
    );
    const css = await readFile(
      resolve(outputDir, "content/logic-lab/복습노트/style.css"),
      "utf8",
    );
    expect(css).toContain("/content/logic-lab/");
  } finally {
    await f.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});
import { rebaseReferences } from "../../tools/content/rebase.js";
import { extractReferences } from "../../tools/content/references.js";
test("keeps data URL srcset intact while rebasing its local neighbor", () => {
  const text = rebaseReferences(
    '<img srcset="data:image/png;base64,AAAA 1x, /복습노트/x.png 2x">',
    "html",
    "logic-lab",
    "복습노트/1024/a.html",
  );
  expect(extractReferences(text, "html")).toEqual([
    "data:image/png;base64,AAAA",
    "/content/logic-lab/%EB%B3%B5%EC%8A%B5%EB%85%B8%ED%8A%B8/x.png",
  ]);
});
import { matchingException } from "../../tools/content/preflight.js";
test("exceptions require exact course, source, target and an explanation", () => {
  const issue = {
    courseId: "logic-lab",
    sourcePath: "복습노트/1024/a.html",
    target: "missing.png",
  };
  const exception = {
    ...issue,
    reason:
      "Original tracked HTML references a nonexistent image (confirmed in source).",
  };
  expect(matchingException(issue, [exception])).toBe(exception);
  for (const change of [
    { courseId: "other" },
    { sourcePath: "복습노트/*" },
    { target: "*.png" },
    { reason: "   " },
  ])
    expect(
      matchingException(issue, [{ ...exception, ...change }]),
    ).toBeUndefined();
});
test("normalizes rebased Unicode URLs to the physical NFC output path", () => {
  const html = rebaseReferences(
    '<img src="/복습노트/e\u0301.png">',
    "html",
    "logic-lab",
    "복습노트/1024/a.html",
  );
  expect(extractReferences(html, "html")).toEqual([
    "/content/logic-lab/%EB%B3%B5%EC%8A%B5%EB%85%B8%ED%8A%B8/%C3%A9.png",
  ]);
});
import { mkdir, symlink } from "node:fs/promises";
import { writeReport, type BuildReport } from "../../tools/content/report.js";
const emptyReport: BuildReport = {
  createdAt: "fixture",
  bundleHash: "",
  sources: [],
  inputs: [],
  outputs: [],
  issues: [],
};
test("rejects source repository report paths before success or failure writes", async () => {
  const f = await createSourceFixture(),
    outputDir = resolve(".generated/report-source-" + Date.now());
  try {
    await f.write("복습노트/1024/a.html", "before");
    await f.write("content-build.json", "original report sentinel");
    await f.track();
    await mkdir(outputDir, { recursive: true });
    await writeFileForTest(resolve(outputDir, "sentinel"), "unchanged");
    const options = {
      settings: f.settings,
      configs: [f.config],
      outputDir,
      reportDir: f.root,
    };
    await expect(buildContent(options)).rejects.toThrow(/report/i);
    expect(await readFile(resolve(f.root, "content-build.json"), "utf8")).toBe(
      "original report sentinel",
    );
    expect(await readFile(resolve(outputDir, "sentinel"), "utf8")).toBe(
      "unchanged",
    );
    await f.write("복습노트/1024/a.html", '<img src="missing.png">');
    await expect(buildContent(options)).rejects.toThrow(/report/i);
    expect(await readFile(resolve(f.root, "content-build.json"), "utf8")).toBe(
      "original report sentinel",
    );
  } finally {
    await f.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});
import { writeFile as writeFileForTest } from "node:fs/promises";
test("rejects symlink report directories into output before any publication", async () => {
  const f = await createSourceFixture(),
    outputDir = resolve(".generated/report-link-" + Date.now()),
    reportDir = resolve(".reports/report-link-" + Date.now());
  try {
    await f.write("복습노트/1024/a.html", "before");
    await f.track();
    await mkdir(outputDir, { recursive: true });
    await writeFileForTest(
      resolve(outputDir, "content-build.json"),
      "output sentinel",
    );
    await symlink(
      outputDir,
      reportDir,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      buildContent({
        settings: f.settings,
        configs: [f.config],
        outputDir,
        reportDir,
      }),
    ).rejects.toThrow(/report/i);
    expect(
      await readFile(resolve(outputDir, "content-build.json"), "utf8"),
    ).toBe("output sentinel");
    await expect(
      readFile(resolve(outputDir, "catalog.json")),
    ).rejects.toThrow();
    await expect(
      writeReport(emptyReport, resolve(reportDir, "content-build.json")),
    ).rejects.toThrow(/report/i);
    expect(
      await readFile(resolve(outputDir, "content-build.json"), "utf8"),
    ).toBe("output sentinel");
  } finally {
    await rm(reportDir, { force: true, recursive: true });
    await f.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});
test("rejects existing report file symlinks without changing original bytes", async () => {
  const f = await createSourceFixture(),
    reportDir = resolve(".reports/report-file-" + Date.now());
  try {
    await f.write("content-build.json", "source sentinel");
    await mkdir(reportDir, { recursive: true });
    const path = resolve(reportDir, "content-build.json");
    await symlink(resolve(f.root, "content-build.json"), path, "file");
    await expect(writeReport(emptyReport, path)).rejects.toThrow(/report/i);
    expect(await readFile(resolve(f.root, "content-build.json"), "utf8")).toBe(
      "source sentinel",
    );
  } finally {
    await rm(reportDir, { recursive: true, force: true });
    await f.dispose();
  }
});
test("multiple base elements retain the first href for collection and rebasing", async () => {
  const f = await createSourceFixture(),
    outputDir = resolve(".generated/first-base-" + Date.now());
  try {
    await f.write(
      "복습노트/1024/a.html",
      '<base href="/복습노트/first/"><base href="/복습노트/ignored/"><img src="x.png">',
    );
    await f.write("복습노트/first/x.png", "first");
    await f.track();
    const result = await buildContent({
      settings: f.settings,
      configs: [f.config],
      outputDir,
      reportDir: resolve(".reports/test-build"),
    });
    expect(result.issues).toEqual([]);
    const html = await readFile(
      resolve(outputDir, "content/logic-lab/복습노트/1024/a.html"),
      "utf8",
    );
    expect(extractReferences(html, "html")).toEqual([
      "/content/logic-lab/%EB%B3%B5%EC%8A%B5%EB%85%B8%ED%8A%B8/first/x.png",
    ]);
  } finally {
    await f.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});
import { symlinkSync } from "node:fs";
test("failure reporting revalidates a replaced report-file symlink and preserves output", async () => {
  const f = await createSourceFixture(),
    outputDir = resolve(".generated/report-failure-" + Date.now()),
    reportDir = resolve(".reports/report-failure-" + Date.now());
  try {
    await f.write("복습노트/1024/a.html", "fixture");
    await f.write("sentinel.json", "source sentinel");
    await f.track();
    await mkdir(reportDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFileForTest(resolve(outputDir, "sentinel"), "old output");
    const spy = vi
      .spyOn(transformer, "transformHtml")
      .mockImplementation(() => {
        symlinkSync(
          resolve(f.root, "sentinel.json"),
          resolve(reportDir, "content-build.json"),
          "file",
        );
        throw new Error("synthetic transform failure");
      });
    try {
      await expect(
        buildContent({
          settings: f.settings,
          configs: [f.config],
          outputDir,
          reportDir,
        }),
      ).rejects.toThrow(/report/i);
    } finally {
      spy.mockRestore();
    }
    expect(await readFile(resolve(f.root, "sentinel.json"), "utf8")).toBe(
      "source sentinel",
    );
    expect(await readFile(resolve(outputDir, "sentinel"), "utf8")).toBe(
      "old output",
    );
    await expect(
      readFile(resolve(outputDir, "catalog.json")),
    ).rejects.toThrow();
  } finally {
    await rm(reportDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await f.dispose();
  }
});
