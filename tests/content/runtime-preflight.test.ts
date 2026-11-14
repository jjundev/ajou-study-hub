import { it, expect } from "vitest";
import {
  mkdir,
  writeFile,
  readFile,
  rm,
  mkdtemp,
  symlink,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { courses } from "../../config/courses.js";
import { verifyActual } from "../../tools/verify-actual.js";

it("leaves canonical full proof untouched when a scoped observation cannot start", async () => {
  const root = resolve(".generated/verification-tests", randomUUID());
  await mkdir(join(root, ".reports"), { recursive: true });
  const proof = join(root, ".reports/verification.json");
  const canonical = '{"deploymentEligible":true}';
  try {
    await writeFile(proof, canonical);
    await expect(verifyActual("missing.json", {
      testProjectRoot: root,
      observeCourses: ["life-science"],
    })).rejects.toThrow();
    expect(await readFile(proof, "utf8")).toBe(canonical);
    await expect(readFile(join(root, ".reports/course-verification-observe.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("does not overwrite a scoped report path that overlaps a configured source", async () => {
  const root = resolve(".generated/verification-tests", randomUUID());
  const source = join(root, ".reports");
  const target = join(source, "course-verification-observe.json");
  await mkdir(source, { recursive: true });
  try {
    await writeFile(target, "original sentinel");
    const settings = join(root, "sources.json");
    await writeFile(settings, JSON.stringify({
      roots: Object.fromEntries(courses.map(course => [course.id, source])), explicitUntracked: {},
    }));
    await expect(verifyActual(settings, { testProjectRoot: root, observeCourses: ["life-science"] }))
      .rejects.toThrow("overlaps source");
    expect(await readFile(target, "utf8")).toBe("original sentinel");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
for (const mode of [
  "missing-file",
  "malformed-json",
  "null",
  "missing-roots",
  "array-roots",
  "non-string-root",
  "missing-checkout",
])
  it("invalidates canonical stale proof for " + mode, async () => {
    const root = resolve(".generated/verification-tests", randomUUID());
    await mkdir(join(root, ".reports"), { recursive: true });
    const proof = join(root, ".reports/verification.json"),
      settings = join(root, "sources.json");
    try {
      await writeFile(proof, JSON.stringify({ deploymentEligible: true }));
      const valid = {
        roots: Object.fromEntries(
          courses.map((c) => [c.id, join(root, "missing")]),
        ),
        explicitUntracked: {},
      };
      const bodies: Record<string, string> = {
        "malformed-json": "{",
        null: "null",
        "missing-roots": "{}",
        "array-roots": '{"roots":[],"explicitUntracked":{}}',
        "non-string-root": JSON.stringify({
          ...valid,
          roots: { ...valid.roots, "logic-lab": null },
        }),
        "missing-checkout": JSON.stringify(valid),
      };
      if (mode !== "missing-file") await writeFile(settings, bodies[mode]!);
      const failure = await verifyActual(settings, { testProjectRoot: root, reportPath: proof }).then(() => null, error => error);
      expect(failure).toBeInstanceOf(Error);
      expect(JSON.parse(await readFile(proof, "utf8")).deploymentEligible, String(failure)).toBe(
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
it("invalidates canonical proof before rejecting an unsafe report override without changing it", async () => {
  const root = resolve(".generated/verification-tests", randomUUID());
  await mkdir(join(root, ".reports"), { recursive: true });
  const source = await mkdtemp(join(tmpdir(), "study-original-"));
  const target = join(source, "report.json");
  try {
    await writeFile(target, "original sentinel");
    await writeFile(
      join(root, ".reports/verification.json"),
      '{"deploymentEligible":true}',
    );
    const settings = join(root, "sources.json");
    await writeFile(
      settings,
      JSON.stringify({
        roots: Object.fromEntries(courses.map((c) => [c.id, source])),
        explicitUntracked: {},
      }),
    );
    await expect(
      verifyActual(settings, { testProjectRoot: root, reportPath: target }),
    ).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("original sentinel");
    expect(
      JSON.parse(
        await readFile(join(root, ".reports/verification.json"), "utf8"),
      ).deploymentEligible,
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});
it("rejects a symlink isolated project without touching its target", async () => {
  const root = resolve(".generated/verification-tests", randomUUID());
  await mkdir(resolve(".generated/verification-tests"), { recursive: true });
  const source = await mkdtemp(join(tmpdir(), "study-root-"));
  try {
    await mkdir(join(source, ".reports"));
    await writeFile(
      join(source, ".reports/verification.json"),
      "original sentinel",
    );
    await symlink(source, root, "junction");
    await expect(
      verifyActual("missing.json", {
        testProjectRoot: root,
        reportPath: join(root, ".reports/verification.json"),
      }),
    ).rejects.toThrow();
    expect(
      await readFile(join(source, ".reports/verification.json"), "utf8"),
    ).toBe("original sentinel");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

it("preserves source exclusions even for overrides inside the owned reports tree", async () => {
  const root = resolve(".generated/verification-tests", randomUUID());
  const source = join(root, ".reports/source");
  await mkdir(source, { recursive: true });
  const proof = join(root, ".reports/verification.json"),
    target = join(source, "report.json");
  try {
    await writeFile(proof, '{"deploymentEligible":true}');
    await writeFile(target, "original sentinel");
    const settings = join(root, "sources.json");
    await writeFile(
      settings,
      JSON.stringify({
        roots: Object.fromEntries(courses.map((c) => [c.id, source])),
        explicitUntracked: {},
      }),
    );
    await expect(
      verifyActual(settings, { testProjectRoot: root, reportPath: target }),
    ).rejects.toThrow("overlaps source");
    expect(await readFile(target, "utf8")).toBe("original sentinel");
    expect(JSON.parse(await readFile(proof, "utf8")).deploymentEligible).toBe(
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
