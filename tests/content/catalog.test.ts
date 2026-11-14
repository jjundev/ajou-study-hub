import { expect, test } from "vitest";
import { createSourceFixture } from "../fixtures/source.js";
import { inspectSources } from "../../tools/content/source.js";
import { buildCatalog } from "../../tools/content/catalog.js";
import { courses } from "../../config/courses.js";

test("lists numbered logic lab experiments and excludes draft folders", async () => {
  const f = await createSourceFixture();
  try {
    const paths = ["실험07/실험07_문제설명.html", "실험10/실험10_문제설명.html"];
    for (const path of [...paths, "실험10-초안/초안.html", "1109/정리노트.html"])
      await f.write("복습노트/" + path, "");
    await f.track();
    const catalog = await buildCatalog(await inspectSources([f.config], f.settings));
    expect(catalog.groups.filter(group => group.kind === "experiment").map(group => group.title))
      .toEqual(["실험07", "실험10"]);
    expect(catalog.documents.filter(doc => doc.type === "explanation").map(doc => doc.sourcePath))
      .toEqual(paths.map(path => "복습노트/" + path));
    expect(catalog.documents.some(doc => doc.sourcePath.includes("초안"))).toBe(false);

    const other = courses.find(course => course.id === "life-science")!;
    const snapshot = await inspectSources([other], { roots: {[other.id]: f.root}, explicitUntracked: {} });
    const otherCatalog = await buildCatalog(snapshot);
    expect(otherCatalog.groups.map(group => [group.title, group.kind])).toEqual([["1109", "date"]]);
    expect(otherCatalog.documents.map(doc => doc.type)).toEqual(["note"]);
  } finally {
    await f.dispose();
  }
});

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

test("uses the one distinct note heading as the date group title", async () => {
  const f = await createSourceFixture();
  try {
    await f.write(
      "복습노트/1113/정리노트.html",
      "<title>정리노트 1113</title><h1> 전류 반송 &amp;\n <em>귀환 극성</em> — 5살도 이해하는 정리노트 </h1>",
    );
    await f.write("복습노트/1113/정리노트_별본.html", "<h1>전류 반송 &amp; 귀환 극성</h1>");
    await f.write("복습노트/1113/문제설명.html", "<h1>다른 문제 제목</h1>");
    await f.write("복습노트/1114/정리노트.html", "<h1>가우시안 혼합 모델과 책임도</h1>");
    await f.track();
    const catalog = await buildCatalog(await inspectSources([f.config], f.settings));
    expect(catalog.groups.map((group) => group.title)).toEqual([
      "가우시안 혼합 모델과 책임도",
      "전류 반송 & 귀환 극성",
    ]);
    expect(catalog.documents.find((doc) => doc.sourcePath === "복습노트/1113/정리노트.html")?.title)
      .toBe("정리노트 1113");
  } finally {
    await f.dispose();
  }
});

test("keeps the group label when note headings are ambiguous or unavailable", async () => {
  const f = await createSourceFixture();
  try {
    const files = {
      "1101/정리노트.html": "<h1>전류 반송</h1>",
      "1101/정리노트_별본.html": "<h1>전압 귀환</h1>",
      "1102/정리노트.html": "<h1>전류 반송</h1><h1>전압 귀환</h1>",
      "1103/정리노트.html": "<title>정리노트 1103</title><h1> </h1><h1>1103</h1><h1>정리노트</h1>",
      "1104/문제설명.html": "<h1>연습 문제</h1>",
      "1105/정리노트.html": "<h1>자동 후보</h1>",
      "실험01/실험01_실험설명.html": "<h1>실험 주제</h1>",
    };
    for (const [path, html] of Object.entries(files))
      await f.write(`복습노트/${path}`, html);
    f.config.groupRules.unshift({ pattern: "^1105$", kind: "date", title: "과목 설정 제목" });
    await f.track();
    const catalog = await buildCatalog(await inspectSources([f.config], f.settings));
    expect(catalog.groups.map((group) => group.title)).toEqual([
      "과목 설정 제목",
      "1104",
      "1103",
      "1102",
      "1101",
      "실험01",
    ]);
  } finally {
    await f.dispose();
  }
});

test("takes up to two distinct lesson topics from the date note body", async () => {
  const f = await createSourceFixture();
  try {
    await f.write("복습노트/1102/정리노트.html", `
      <aside><h2>목차</h2></aside>
      <main>
        <h1>이진 트리의 표현과 순회</h1>
        <h2>0. 지난 수업 복습</h2>
        <h2>들어가며: 순회의 필요성</h2>
        <section hidden><h2>숨긴 소제목</h2></section>
        <h2>1. 이진 트리를 <em>컴퓨터에</em> 담는 법</h2>
        <h2>2. 이진 트리를 컴퓨터에 담는 법</h2>
        <h2>3. 한 장 요약 · 다음 시간 예고</h2>
        <h2>4. 전위 &amp; 후위 순회</h2>
        <h2>5. 순회로 계산하기</h2>
      </main>
    `);
    await f.write("복습노트/1102/정리노트_별본.html", "<main><h2>별본의 주제</h2></main>");
    await f.write("복습노트/1105/정리노트.html", "<h2>1. 탐색과 삽입</h2><h2>2. 요약 · 예고</h2>");
    await f.write("복습노트/1112/문제설명.html", "<main><h2>문제 소제목</h2></main>");
    await f.write("복습노트/실험01/실험01_실험설명.html", "<main><h2>실험 절차</h2></main>");
    f.config.groupRules.unshift({ pattern: "^1102$", kind: "date", title: "수동 제목" });
    await f.track();
    const catalog = await buildCatalog(await inspectSources([f.config], f.settings));
    expect(catalog.groups.map(({ title, description }) => [title, description])).toEqual([
      ["1112", undefined],
      ["1105", "탐색과 삽입"],
      ["수동 제목", "이진 트리를 컴퓨터에 담는 법 · 전위 & 후위 순회"],
      ["실험01", undefined],
    ]);
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
      ["확인문제_추가.html", "check"],
      ["문제설명_추가.html", "explanation"],
      ["실험02_문제설명.html", "explanation"],
      ["실험02_기출풀이.html", "explanation"],
      ["인터렉티브_퀴즈.html", "interactive"],
      ["인터랙티브_퀴즈.html", "interactive"],
      ["학습만화_추가.html", "comic"],
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
