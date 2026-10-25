import { createHash } from "node:crypto";
import { posix } from "node:path";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { Catalog, Group } from "../../src/content/model.js";
import type { SourceSnapshot } from "./source.js";
const id = (kind: string, course: string, path: string) =>
  kind +
  "-" +
  createHash("sha256")
    .update(course + "/" + path.replaceAll("\\", "/").normalize("NFC"))
    .digest("hex");
export function documentTitle(html: string, fallback: string): string {
  const visit = (node: DefaultTreeAdapterMap["node"]): string | null => {
    if ("tagName" in node && node.tagName === "title")
      return node.childNodes
        .map((n) => ("value" in n ? n.value : ""))
        .join("")
        .trim();
    if ("childNodes" in node)
      for (const child of node.childNodes) {
        const found = visit(child);
        if (found !== null) return found;
      }
    return null;
  };
  return visit(parse(html)) || fallback;
}
export async function buildCatalog(snapshot: SourceSnapshot): Promise<Catalog> {
  const catalog: Catalog = {
    version: 1,
    courses: snapshot.configs.map(({ id, name, repo, semester }) => ({
      id,
      name,
      repo,
      semester,
    })),
    groups: [],
    documents: [],
  };
  for (const entry of snapshot.catalogInputs) {
    const config = snapshot.configs.find((c) => c.id === entry.courseId)!;
    let group = catalog.groups.find(
      (g) => g.courseId === entry.courseId && g.sourcePath === entry.groupPath,
    );
    if (!group) {
      const name = posix.basename(entry.groupPath);
      const rule = config.groupRules.find((r) =>
        new RegExp(r.pattern).test(name),
      )!;
      group = {
        id: id("group", entry.courseId, entry.groupPath),
        courseId: entry.courseId,
        title: rule.title ?? name,
        sourcePath: entry.groupPath,
        kind: rule.kind,
        date:
          rule.kind === "date"
            ? `2026-${name.slice(0, 2)}-${name.slice(2)}`
            : null,
        order: 0,
      };
      catalog.groups.push(group);
    }
    const basename = posix.basename(entry.sourcePath);
    catalog.documents.push({
      id: id("document", entry.courseId, entry.sourcePath),
      courseId: entry.courseId,
      groupId: group.id,
      title: documentTitle(
        new TextDecoder().decode(
          await snapshot.readFile(entry.courseId, entry.sourcePath),
        ),
        basename.replace(/\.html?$/i, ""),
      ),
      type:
        config.typeRules.find((r) => new RegExp(r.pattern).test(basename))
          ?.type ?? "other",
      sourcePath: entry.sourcePath,
      url:
        "/content/" +
        entry.courseId +
        "/" +
        entry.sourcePath
          .normalize("NFC")
          .split("/")
          .map(encodeURIComponent)
          .join("/"),
      listed: true,
    });
  }
  const rank: Record<Group["kind"], number> = {
    date: 0,
    experiment: 1,
    supplement: 2,
  };
  catalog.groups.sort(
    (a, b) =>
      snapshot.configs.findIndex((c) => c.id === a.courseId) -
        snapshot.configs.findIndex((c) => c.id === b.courseId) ||
      rank[a.kind] - rank[b.kind] ||
      (a.kind === "date"
        ? b.sourcePath.localeCompare(a.sourcePath)
        : a.sourcePath.localeCompare(b.sourcePath, undefined, {
            numeric: true,
          })),
  );
  catalog.groups.forEach((g, i) => (g.order = i));
  catalog.documents.sort(
    (a, b) =>
      catalog.groups.findIndex((g) => g.id === a.groupId) -
        catalog.groups.findIndex((g) => g.id === b.groupId) ||
      a.sourcePath.localeCompare(b.sourcePath),
  );
  return catalog;
}
