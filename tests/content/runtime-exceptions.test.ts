import { matchingException } from "../../tools/content/preflight.js";
import { it, expect } from "vitest";
import { runtimeIssue } from "../../tools/runtime-exceptions.js";
const doc = {
  id: "d",
  courseId: "c",
  sourcePath: "a.html",
  groupId: null,
  title: "a",
  type: "note" as const,
  listed: true,
  url: "/a.html",
};
const failure = {
  documentId: "d",
  kind: "http",
  target: "https://cdn.invalid/font.css",
  reason: "HTTP 400",
  classification: "external" as const,
};
const exception = {
  courseId: "c",
  sourcePath: "a.html",
  target: failure.target,
  reason:
    "Verified original stylesheet requests unsupported font; HTTP400 evidence retained",
  runtime: [{ kind: "http", reason: "HTTP 400" }],
};
it("only accepts exact justified runtime exceptions and retains warning", () => {
  expect(runtimeIssue(failure, doc, [exception]).severity).toBe("warning");
  for (const changed of [
    { target: failure.target + "?other" },
    { reason: "HTTP 503" },
    { kind: "requestfailed" },
    { classification: "copy" as const },
  ])
    expect(
      runtimeIssue({ ...failure, ...changed }, doc, [exception]).severity,
    ).toBe("error");
  expect(
    runtimeIssue(failure, { ...doc, sourcePath: "other.html" }, [exception])
      .severity,
  ).toBe("error");
  expect(
    runtimeIssue(failure, doc, [{ ...exception, reason: "" }]).severity,
  ).toBe("error");
});

it("runtime-only exceptions do not authorize static collection failures", () => {
  expect(
    matchingException(
      { courseId: "c", sourcePath: "a.html", target: failure.target },
      [exception],
    ),
  ).toBeUndefined();
});
