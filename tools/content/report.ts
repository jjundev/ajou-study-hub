import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
export async function writeReport(
  report: BuildReport,
  path: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + "\n");
}
