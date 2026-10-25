/** Audit every embedded figure, including pages never selected by a representative. */
export async function auditWorkbookFigures(
  documents: { courseId: string; sourcePath: string }[],
  read: (courseId: string, path: string) => Promise<Uint8Array>,
  outputs: string[],
) {
  const available = new Set(outputs);
  const figures = new Set<string>();
  let workbooks = 0;
  for (const doc of documents) {
    if (doc.courseId !== "logic-lab") continue;
    const html = new TextDecoder().decode(
      await read(doc.courseId, doc.sourcePath),
    );
    const m = html.match(
      /<script[^>]*id="workbook-data"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (!m) continue;
    workbooks++;
    const data: unknown = JSON.parse(m[1]!);
    function add(src: string) {
      const url = new URL(
        src,
        "https://source.invalid/" +
          doc.sourcePath.split("/").map(encodeURIComponent).join("/"),
      );
      if (url.origin !== "https://source.invalid")
        throw Error(
          "External workbook figure requires explicit review: " + src,
        );
      const path =
        "content/" +
        doc.courseId +
        "/" +
        decodeURIComponent(url.pathname.slice(1));
      if (!available.has(path))
        throw Error("Missing dynamic workbook figure: " + path);
      figures.add(path);
    }
    function walk(v: unknown) {
      if (typeof v === "string") {
        for (const match of v.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/g))
          add(match[1]!);
        return;
      }
      if (!v || typeof v !== "object") return;
      const object = v as Record<string, unknown>;
      if (typeof object.src === "string") add(object.src);
      for (const x of Object.values(v)) walk(x);
    }
    walk(data);
  }
  return { workbooks, figures: [...figures].sort() };
}
