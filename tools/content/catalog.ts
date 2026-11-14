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

function* elementsByTag(
  node: DefaultTreeAdapterMap["node"],
  tag: string,
  skip?: (element: DefaultTreeAdapterMap["element"]) => boolean,
): Generator<DefaultTreeAdapterMap["element"], void> {
  if ("tagName" in node) {
    if (skip?.(node)) return;
    if (node.tagName === tag) yield node;
  }
  if ("childNodes" in node)
    for (const child of node.childNodes) yield* elementsByTag(child, tag, skip);
}

function textContent(node: DefaultTreeAdapterMap["node"]): string {
  if ("value" in node) return node.value;
  if ("tagName" in node && (node.tagName === "script" || node.tagName === "style"))
    return "";
  return "childNodes" in node ? node.childNodes.map(textContent).join("") : "";
}

function titleFromTree(
  tree: DefaultTreeAdapterMap["document"],
  fallback: string,
): string {
  const title = elementsByTag(tree, "title").next().value;
  if (!title) return fallback;
  const text = title.childNodes
    .map((node) => ("value" in node ? node.value : ""))
    .join("")
    .trim();
  return text || fallback;
}

export function documentTitle(html: string, fallback: string): string {
  return titleFromTree(parse(html), fallback);
}

function noteDescription(tree: DefaultTreeAdapterMap["document"]): string | undefined {
  const body = elementsByTag(tree, "main").next().value ?? elementsByTag(tree, "body").next().value;
  if (!body) return undefined;
  const topics = new Set<string>();
  const headings = elementsByTag(body, "h2", (element) =>
    ["aside", "nav", "header", "footer"].includes(element.tagName) ||
    element.attrs.some(({ name, value }) => name === "hidden" || (name === "aria-hidden" && value === "true")),
  );
  for (const heading of headings) {
    const label = textContent(heading).normalize("NFC").replace(/\s+/g, " ").trim();
    if (/^0\s*[.)]/u.test(label)) continue;
    const topic = label.replace(/^\d+\s*[.)]\s*/u, "");
    if (!topic || /^(?:목차|들어가며|지난 수업 복습|오늘의 큰 그림|(?:한 장 )?요약|예고|다음 시간 예고)(?=$|[\s:：·])/u.test(topic)) continue;
    topics.add(topic);
    if (topics.size === 2) break;
  }
  return [...topics].join(" · ") || undefined;
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
  const noteHeadings = new Map<Group, Set<string>>();
  const descriptionSources = new Map<Group, string>();
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
      if (rule.kind === "date" && rule.title === undefined)
        noteHeadings.set(group, new Set());
    }
    const basename = posix.basename(entry.sourcePath);
    const type =
      config.typeRules.find((r) => new RegExp(r.pattern).test(basename))
        ?.type ?? "other";
    const tree = parse(
      new TextDecoder().decode(await snapshot.readFile(entry.courseId, entry.sourcePath)),
    );
    if (type === "note" && group.kind === "date") {
      const source = descriptionSources.get(group);
      const path = entry.sourcePath.normalize("NFC");
      if (source === undefined || path < source) {
        const description = noteDescription(tree);
        if (description) {
          group.description = description;
          descriptionSources.set(group, path);
        }
      }
    }
    const candidates = noteHeadings.get(group);
    if (type === "note" && candidates) {
      for (const heading of elementsByTag(tree, "h1")) {
        const topic = textContent(heading)
          .normalize("NFC")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/\s*—\s*5살도 이해하는 정리노트$/, "");
        if (topic && topic !== group.title && topic !== "정리노트")
          candidates.add(topic);
      }
    }
    catalog.documents.push({
      id: id("document", entry.courseId, entry.sourcePath),
      courseId: entry.courseId,
      groupId: group.id,
      title: titleFromTree(tree, basename.replace(/\.html?$/i, "")),
      type,
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
  for (const [group, headings] of noteHeadings)
    if (headings.size === 1) group.title = [...headings][0]!;

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
