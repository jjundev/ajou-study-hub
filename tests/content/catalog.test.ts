import { expect, test } from "vitest";
import { createSourceFixture } from "../fixtures/source.js";
import { inspectSources } from "../../tools/content/source.js";
import { buildCatalog } from "../../tools/content/catalog.js";

test("lists_only_tracked_entry_html and classifies_types", async () => {
  const f = await createSourceFixture();
  try {
    for (const p of [
      "1001/정리노트.html",
      "실험02/실험02_기출문제.html",
      "칩 정리/unknown.html",
      "1001/.backup-old.html",
      "1001/제작.html",
    ])
      await f.write("복습노트/" + p, "<title>학습 &amp; 복습</title>");
    await f.track();
    await f.write("복습노트/1001/untracked.html", "<title>숨김</title>");
    const c = await buildCatalog(await inspectSources([f.config], f.settings));
    expect(c.documents.filter((d) => d.listed)).toHaveLength(3);
    expect(
      c.documents.find((d) => d.sourcePath.includes("기출문제"))?.type,
    ).toBe("review");
    expect(
      c.documents.find((d) => d.sourcePath.includes("unknown"))?.type,
    ).toBe("other");
    expect(c.groups.find((g) => g.kind === "experiment")?.date).toBeNull();
    expect(c.documents[0]?.title).toBe("학습 & 복습");
  } finally {
    await f.dispose();
  }
});
test("stable_ids and updates_catalog", async () => {
  const f = await createSourceFixture();
  try {
    await f.write("복습노트/1001/정리노트.html", "<title>원래 제목</title>");
    await f.track();
    const read = async () =>
      buildCatalog(await inspectSources([f.config], f.settings));
    const original = (await read()).documents[0]!;
    await f.write(original.sourcePath, "<title>새 제목</title>");
    expect((await read()).documents[0]?.id).toBe(original.id);
    await f.write("복습노트/1002/복습문제.html", "<html>제목 없음</html>");
    await f.track();
    expect((await read()).documents).toHaveLength(2);
    const { unlink } = await import("node:fs/promises");
    await unlink(f.root + "/" + original.sourcePath);
    await f.track();
    const c = await read();
    expect(c.documents).toHaveLength(1);
    expect(c.documents[0]?.title).toBe("복습문제");
  } finally {
    await f.dispose();
  }
});
test("sorts dates newest first, experiments numerically, supplements last and rejects invalid dates", async () => {
  const f = await createSourceFixture();
  try {
    for (const g of ["0901", "1001", "실험06", "실험01", "칩 정리", "0230"])
      await f.write(`복습노트/${g}/정리노트.html`, "");
    await f.track();
    const c = await buildCatalog(await inspectSources([f.config], f.settings));
    expect(c.groups.map((g) => g.title)).toEqual([
      "1001",
      "0901",
      "실험01",
      "실험06",
      "칩 정리",
    ]);
  } finally {
    await f.dispose();
  }
});
test("readFile enforces allowed tracked paths and records selected bytes", async () => {
  const f = await createSourceFixture();
  try {
    await f.write("복습노트/1001/정리노트.html", "hello");
    await f.write("secret.html", "secret");
    await f.track();
    const s = await inspectSources([f.config], f.settings);
    await expect(s.readFile(f.config.id, "../secret.html")).rejects.toThrow();
    await expect(s.readFile(f.config.id, "secret.html")).rejects.toThrow();
    await expect(
      s.readFile(f.config.id, "복습노트/1001/new.html"),
    ).rejects.toThrow();
    expect(
      new TextDecoder().decode(
        await s.readFile(f.config.id, "복습노트/1001/정리노트.html"),
      ),
    ).toBe("hello");
  } finally {
    await f.dispose();
  }
});
test("explicit untracked inclusion and tracking recheck prevent stale permissions", async () => {
  const f = await createSourceFixture();
  try {
    const p = "복습노트/1001/정리노트.html";
    await f.write(p, "explicit");
    f.settings.explicitUntracked[f.config.id] = [p];
    const explicit = await inspectSources([f.config], f.settings);
    expect((await buildCatalog(explicit)).documents).toHaveLength(1);
    expect(explicit.selectedFiles[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
    await f.track();
    f.settings.explicitUntracked = {};
    const tracked = await inspectSources([f.config], f.settings);
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["rm", "--cached", "--", p], { cwd: f.root });
    await expect(tracked.readFile(f.config.id, p)).rejects.toThrow();
  } finally {
    await f.dispose();
  }
});

// A wrong per-course rule order or missing filename spelling changes visible material types.
test("classifies all supported filename forms with ordered course rules", async () => {
  const f = await createSourceFixture();
  try {
    const cases = [
      ["정리노트_추가.html", "note"],
      ["복습문제_추가.html", "review"],
      ["문제풀이.html", "review"],
      ["문제설명_추가.html", "explanation"],
      ["실험02_문제설명.html", "explanation"],
      ["실험02_기출풀이.html", "explanation"],
      ["인터렉티브_퀴즈.html", "interactive"],
      ["인터랙티브_퀴즈.html", "interactive"],
    ];
    for (const [filename] of cases)
      await f.write(`복습노트/1001/${filename}`, "");
    await f.track();
    const catalog = await buildCatalog(
      await inspectSources([f.config], f.settings),
    );
    for (const [filename, type] of cases)
      expect(
        catalog.documents.find((d) => d.sourcePath.endsWith("/" + filename))
          ?.type,
      ).toBe(type);
  } finally {
    await f.dispose();
  }
});
