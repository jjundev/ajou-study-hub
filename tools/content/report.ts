import {
  mkdir,
  writeFile,
  lstat,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import type { Issue } from "../../src/content/model.js";
import type { SourceProvenance } from "./source.js";
export type BuildReport = {
  createdAt: string;
  bundleHash: string;
  sources: SourceProvenance[];
  inputs: { courseId: string; path: string; sha256: string }[];
  outputs: { path: string; sha256: string; size: number }[];
  issues: Issue[];
};

const contains = (root: string, path: string) => {
  const r = relative(root, path);
  return (
    r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(".." + sep))
  );
};
/** Reports may only live under the canonical project-owned .reports tree. */
export async function validateReportPath(
  path: string,
  exclusions: string[] = [],
  projectRoot = process.cwd(),
): Promise<void> {
  const project = await realpath(projectRoot),
    owned = resolve(project, ".reports"),
    target = resolve(path);
  if (target === owned || !contains(owned, target))
    throw new Error(
      "Unsafe report destination: expected a project .reports file",
    );
  if (exclusions.some((root) => contains(root, target)))
    throw new Error("Report destination overlaps source or deployment output");
  let cursor = target;
  while (cursor !== project) {
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink())
        throw new Error(`Symlink report destination or ancestor: ${cursor}`);
      const actual = await realpath(cursor);
      if (
        !contains(owned, actual) ||
        exclusions.some((root) => contains(root, actual))
      )
        throw new Error("Unsafe canonical report destination");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    cursor = dirname(cursor);
  }
}
export async function writeReport(
  report: unknown,
  path: string,
  exclusions: string[] = [],
  projectRoot = process.cwd(),
): Promise<void> {
  path = resolve(path);
  await validateReportPath(path, exclusions, projectRoot);
  await mkdir(dirname(path), { recursive: true });
  await validateReportPath(path, exclusions, projectRoot);
  const temporary = path + ".tmp-" + randomUUID();
  try {
    await validateReportPath(temporary, exclusions, projectRoot);
    await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await validateReportPath(path, exclusions, projectRoot);
    await rename(temporary, path);
  } finally {
    await validateReportPath(temporary, exclusions, projectRoot);
    try {
      await unlink(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
