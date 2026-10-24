import type { Issue } from "../../src/content/model.js";
export const bundleLimits = { maxFiles: 20000, maxFileBytes: 25 * 1024 * 1024 };
export function checkBundle(
  files: { path: string; size: number }[],
  limits: { maxFiles: number; maxFileBytes: number },
): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, reason: string) =>
    issues.push({
      code: "bundle-limit",
      courseId: "",
      sourcePath: path,
      target: path,
      reason,
      severity: "error",
    });
  if (files.length > limits.maxFiles)
    add("", `File count ${files.length} exceeds ${limits.maxFiles}`);
  for (const f of files)
    if (f.size > limits.maxFileBytes)
      add(f.path, `File size ${f.size} exceeds ${limits.maxFileBytes}`);
  return issues;
}
export type ContentException = {
  courseId: string;
  sourcePath: string;
  target: string;
  reason: string;
};
/** No glob, prefix, or reasonless exception can authorize a missing reference. */
export function matchingException(
  issue: Pick<Issue, "courseId" | "sourcePath" | "target">,
  exceptions: ContentException[],
): ContentException | undefined {
  return exceptions.find(
    (e) =>
      e.courseId === issue.courseId &&
      e.sourcePath === issue.sourcePath &&
      e.target === issue.target &&
      typeof e.reason === "string" &&
      e.reason.trim().length > 0,
  );
}
