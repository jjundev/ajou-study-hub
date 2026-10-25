import type { Issue, DocumentInfo } from "../src/content/model.js";
import type { Observation } from "./verify-content.js";
export type RuntimeException = {
  courseId: string;
  sourcePath: string;
  target: string;
  reason: string;
  runtime?: { kind: string; reason: string }[];
};
export function runtimeIssue(
  o: Observation,
  doc: DocumentInfo,
  exceptions: RuntimeException[] = [],
): Issue {
  const exception = exceptions.find(
    (e) =>
      o.classification === "external" &&
      e.courseId === doc.courseId &&
      e.sourcePath === doc.sourcePath &&
      e.target === o.target &&
      e.reason.trim() &&
      e.runtime?.some((r) => r.kind === o.kind && r.reason === o.reason),
  );
  return {
    code: `runtime-${o.classification}-${o.kind}`,
    courseId: doc.courseId,
    sourcePath: doc.sourcePath,
    target: o.target,
    reason:
      o.reason + (exception ? `; Explicit exception: ${exception.reason}` : ""),
    severity: exception ? "warning" : "error",
  };
}
