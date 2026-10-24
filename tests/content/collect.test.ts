import { symlink, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createSourceFixture } from "../fixtures/source.js";
import { inspectSources } from "../../tools/content/source.js";
import { buildCatalog } from "../../tools/content/catalog.js";
import { collectDependencies } from "../../tools/content/collect.js";
import { resolveReference } from "../../tools/content/paths.js";
import { extractReferences } from "../../tools/content/references.js";
describe("dependency closure", () => {
  it("encoded_paths_and_hidden_assets", async () => {
    const f = await createSourceFixture();
    try {
      f.config.allowedRoots.push("강의록");
      await f.write(
        "복습노트/1024/start.html",
        '<base href="../"><a href="한글 폴더/a%20b.html?mode=1#풀이">next</a><link href=".pack/x.css"><img srcset=".assets/x.png 1x, .assets/y.png 2x"><svg><use href=".assets/x.svg#x"/></svg><script src=".pack/x.js"></script><a href="/강의록/a.pdf">pdf</a>',
      );
      await f.write(
        "복습노트/한글 폴더/a b.html",
        '<a href="../1024/start.html">cycle</a>',
      );
      await f.write(
        "복습노트/.pack/x.css",
        '@import "y.css"; a {src:url(../.assets/font.woff2)}',
      );
      for (const p of [
        "복습노트/.pack/y.css",
        "복습노트/.pack/x.js",
        "복습노트/.assets/x.png",
        "복습노트/.assets/y.png",
        "복습노트/.assets/x.svg",
        "복습노트/.assets/font.woff2",
        "강의록/a.pdf",
      ])
        await f.write(p, "");
      await f.track();
      const s = await inspectSources([f.config], f.settings);
      const g = await collectDependencies(s, await buildCatalog(s), [f.config]);
      expect(g.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(g.files).toHaveLength(10);
      expect(g.linkedDocuments).toHaveLength(1);
      expect(g.linkedDocuments.every((d) => !d.listed)).toBe(true);
    } finally {
      await f.dispose();
    }
  });
  it("keeps query-only references on the current document without a base", async () => {
    const f = await createSourceFixture();
    try {
      const path = "복습노트/1024/a.html";
      await f.write(path, '<a href="?mode=1#풀이">same document</a>');
      await f.track();
      expect(
        await resolveReference(
          { courseId: f.config.id, from: path, ref: "?mode=1#풀이" },
          f.config,
          f.root,
        ),
      ).toEqual({ kind: "local", sourcePath: path, suffix: "?mode=1#풀이" });
      const snapshot = await inspectSources([f.config], f.settings);
      const graph = await collectDependencies(
        snapshot,
        await buildCatalog(snapshot),
        [f.config],
      );
      expect(graph.issues).toEqual([]);
      expect(graph.files.map((file) => file.sourcePath)).toEqual([path]);
      expect(graph.linkedDocuments).toEqual([]);
    } finally {
      await f.dispose();
    }
  });
  it("keeps data URL commas inside mixed srcset candidates", async () => {
    const f = await createSourceFixture();
    try {
      const html = '<img srcset="data:image/png;base64,AAAA 1x, x.png 2x">';
      expect(extractReferences(html, "html")).toEqual([
        "data:image/png;base64,AAAA",
        "x.png",
      ]);
      await f.write("복습노트/1024/a.html", html);
      await f.write("복습노트/1024/x.png", "local");
      await f.track();
      const snapshot = await inspectSources([f.config], f.settings);
      const graph = await collectDependencies(
        snapshot,
        await buildCatalog(snapshot),
        [f.config],
      );
      expect(graph.issues).toEqual([]);
      expect(graph.files.map((file) => file.sourcePath).sort()).toEqual([
        "복습노트/1024/a.html",
        "복습노트/1024/x.png",
      ]);
    } finally {
      await f.dispose();
    }
  });
  it("rejects_escape", async () => {
    const f = await createSourceFixture();
    try {
      await f.write("복습노트/a.html", "");
      for (const ref of [
        "../../../secret",
        "%2e%2e/%2e%2e/secret",
        "a\\b",
        "C:/secret",
        "//server/share",
        "%252e%252e/secret",
      ]) {
        const result = await resolveReference(
          { courseId: f.config.id, from: "복습노트/a.html", ref },
          f.config,
          f.root,
        );
        if (ref === "//server/share") expect(result.kind).toBe("external");
        else expect(result.kind).toBe("invalid");
      }
    } finally {
      await f.dispose();
    }
  });
  it("rejects untracked and forbidden references", async () => {
    const f = await createSourceFixture();
    try {
      await f.write(
        "복습노트/1024/a.html",
        '<img src="x.png"><a href="/private.txt">bad</a>',
      );
      await f.track();
      await f.write("복습노트/1024/x.png", "x");
      await f.write("private.txt", "secret");
      const s = await inspectSources([f.config], f.settings);
      const g = await collectDependencies(s, await buildCatalog(s), [f.config]);
      expect(g.issues.filter((i) => i.severity === "error")).toHaveLength(2);
    } finally {
      await f.dispose();
    }
  });
  it("includes dynamic extras only when selected explicitly", async () => {
    const f = await createSourceFixture();
    try {
      await f.write("복습노트/1024/a.html", "");
      await f.track();
      await f.write("복습노트/dynamic.json", "{}");
      f.config.extraFiles.push("복습노트/dynamic.json");
      let s = await inspectSources([f.config], f.settings);
      expect(
        (await collectDependencies(s, await buildCatalog(s), [f.config]))
          .issues,
      ).toHaveLength(1);
      f.settings.explicitUntracked[f.config.id] = ["복습노트/dynamic.json"];
      s = await inspectSources([f.config], f.settings);
      const graph = await collectDependencies(s, await buildCatalog(s), [
        f.config,
      ]);
      expect(graph.issues).toEqual([]);
      expect(graph.files).toHaveLength(2);
    } finally {
      await f.dispose();
    }
  });
  it("rejects aliases that normalize to the same path", async () => {
    const f = await createSourceFixture();
    try {
      await f.write("복습노트/1024/é.html", "one");
      await f.write("복습노트/1024/é.html", "two");
      await f.track();
      await expect(inspectSources([f.config], f.settings)).rejects.toThrow(
        "collision",
      );
    } finally {
      await f.dispose();
    }
  });
  it("rejects realpath escape through directory junction", async () => {
    const f = await createSourceFixture(),
      outside = await mkdtemp(join(tmpdir(), "outside-"));
    try {
      await writeFile(join(outside, "x.png"), "secret");
      await f.write("복습노트/1024/a.html", "");
      await symlink(
        outside,
        join(f.root, "복습노트/escape"),
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(
        (
          await resolveReference(
            {
              courseId: f.config.id,
              from: "복습노트/1024/a.html",
              ref: "../escape/x.png",
            },
            f.config,
            f.root,
          )
        ).kind,
      ).toBe("invalid");
    } finally {
      await f.dispose();
      await rm(outside, { recursive: true, force: true });
    }
  });
  it("parses HTML and CSS without executing javascript", () => {
    expect(
      extractReferences(
        '<script src="a.js"></script><style>a{background:url(b.png)}</style>',
        "html",
      ),
    ).toEqual(["a.js", "b.png"]);
    expect(
      extractReferences(
        '@import "a.css";x{src:url("font.woff")}',
        "css",
      ).sort(),
    ).toEqual(["a.css", "font.woff"]);
  });
});
