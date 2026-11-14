import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { CourseConfig } from "../../config/courses.js";
import { contentUrl, type Catalog, type DocumentInfo, type Issue } from "../../src/content/model.js";
import type { SourceSnapshot } from "./source.js";
import { resolveReference, sourcePath } from "./paths.js";
import { extractReferences, extractBase } from "./references.js";
import { documentTitle } from "./catalog.js";
export type CollectedFile = {
  courseId: string;
  sourcePath: string;
  bytes: Uint8Array;
  sha256: string;
  kind: "html" | "css" | "asset";
};
export type FileGraph = {
  files: CollectedFile[];
  linkedDocuments: DocumentInfo[];
  issues: Issue[];
};
export async function collectDependencies(
  snapshot: SourceSnapshot,
  catalog: Catalog,
  configs: CourseConfig[],
): Promise<FileGraph> {
  const graph: FileGraph = { files: [], linkedDocuments: [], issues: [] },
    seen = new Set<string>();
  const queue = catalog.documents.map((d) => ({
    courseId: d.courseId,
    path: d.sourcePath,
  }));
  for (const group of catalog.groups)
    for (const path of [...(group.reviewPdfs ?? []), ...(group.answerPdfs ?? [])])
      queue.push({ courseId: group.courseId, path });
  for (const config of configs)
    for (const path of config.extraFiles)
      queue.push({ courseId: config.id, path });
  while (queue.length) {
    const item = queue.shift()!,
      key = item.courseId + "/" + item.path;
    if (seen.has(key)) continue;
    seen.add(key);
    const config = configs.find((c) => c.id === item.courseId)!;
    const issue = (
      target: string,
      reason: string,
      severity: "warning" | "error" = "error",
    ) =>
      graph.issues.push({
        code: severity === "error" ? "invalid-reference" : "external-reference",
        courseId: item.courseId,
        sourcePath: item.path,
        target,
        reason,
        severity,
      });
    try {
      sourcePath(item.path);
      const captured = snapshot.selectedFiles.find(
        (f) => f.courseId === item.courseId && f.sourcePath === item.path,
      );
      const bytes =
          captured?.bytes ??
          (await snapshot.readFile(item.courseId, item.path)),
        text = new TextDecoder().decode(bytes);
      const kind = /\.html?$/i.test(item.path)
        ? "html"
        : /\.css$/i.test(item.path)
          ? "css"
          : "asset";
      graph.files.push({
        courseId: item.courseId,
        sourcePath: item.path,
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        kind,
      });
      if (
        kind === "html" &&
        !catalog.documents.some(
          (d) => d.courseId === item.courseId && d.sourcePath === item.path,
        )
      ) {
        const group = catalog.groups.find(
          (g) =>
            g.courseId === item.courseId &&
            item.path.startsWith(g.sourcePath + "/"),
        );
        graph.linkedDocuments.push({
          id:
            "document-" +
            createHash("sha256")
              .update(item.courseId + "/" + item.path.normalize("NFC"))
              .digest("hex"),
          courseId: item.courseId,
          groupId: group?.id ?? null,
          title: documentTitle(text, posix.basename(item.path).replace(/\.html?$/i, "")),
          type:
            config.typeRules.find((r) =>
              new RegExp(r.pattern).test(posix.basename(item.path)),
            )?.type ?? "other",
          sourcePath: item.path,
          url: contentUrl(item.courseId, item.path),
          listed: false,
        });
      }
      if (kind === "asset") continue;
      let base: URL | undefined;
      const origin = "https://source.invalid/";
      if (kind === "html") {
        const href = extractBase(text);
        if (href !== undefined) {
          if (href.includes("\\")) throw new Error("Unsafe base href");
          base = new URL(
            href,
            new URL(
              item.path.split("/").map(encodeURIComponent).join("/"),
              origin,
            ),
          );
        }
      }
      for (let ref of extractReferences(text, kind)) {
        if (base && !ref.startsWith("#")) {
          // Preserve raw traversal checks before URL normalization removes dot segments.
          if (ref.includes("\\")) {
            issue(ref, "Windows paths are forbidden");
            continue;
          }
          const resolved = new URL(ref, base);
          ref =
            resolved.origin === "https://source.invalid"
              ? resolved.pathname + resolved.search + resolved.hash
              : resolved.href;
        }
        const result = await resolveReference(
          { courseId: item.courseId, from: item.path, ref },
          config,
          snapshot.repoRoots[item.courseId]!,
        );
        if (result.kind === "local")
          queue.push({ courseId: item.courseId, path: result.sourcePath });
        else if (result.kind === "invalid") issue(ref, result.reason);
        else if (result.kind === "external")
          issue(ref, "External dependency (not collected)", "warning");
      }
    } catch (error) {
      issue(item.path, (error as Error).message);
    }
  }
  return graph;
}
