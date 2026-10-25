import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { courses } from "../../config/courses.js";
import { verifyActual } from "../../tools/verify-actual.js";
import { writeReport } from "../../tools/content/report.js";
it("invalidates an old eligible proof before failing source inspection", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-preflight-"));
  const settings = join(root, "sources.json");
  const reportPath = resolve(
    ".reports",
    "synthetic-preflight-" + randomUUID() + ".json",
  );
  try {
    await writeFile(
      settings,
      JSON.stringify({
        roots: Object.fromEntries(
          courses.map((c) => [c.id, join(root, "missing")]),
        ),
        explicitUntracked: {},
      }),
    );
    await writeReport({ passed: true, deploymentEligible: true }, reportPath);
    await expect(verifyActual(settings, { reportPath })).rejects.toThrow();
    expect(
      JSON.parse(await readFile(reportPath, "utf8")).deploymentEligible,
    ).toBe(false);
  } finally {
    await unlink(reportPath);
    await rm(root, { recursive: true, force: true });
  }
});
