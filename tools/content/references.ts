import { parse, type DefaultTreeAdapterMap } from "parse5";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
export function extractReferences(
  text: string,
  kind: "html" | "css",
): string[] {
  const refs: string[] = [];
  if (kind === "css") {
    const root = postcss.parse(text);
    const values = (value: string) =>
      valueParser(value).walk((n) => {
        if (n.type === "function" && n.value.toLowerCase() === "url") {
          refs.push(
            valueParser.stringify(n.nodes).replace(/^(['"])(.*)\1$/, "$2"),
          );
          return false;
        }
      });
    root.walkDecls((d) => {
      values(d.value);
    });
    root.walkAtRules("import", (r) => {
      const first = valueParser(r.params).nodes[0];
      if (first?.type === "string") refs.push(first.value);
      else values(r.params);
    });
    return refs;
  }
  const visit = (n: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in n) {
      for (const a of n.attrs) {
        if (n.tagName === "base") continue;
        if (["href", "src", "poster", "data", "xlink:href"].includes(a.name))
          refs.push(a.value);
        if (a.name === "srcset")
          for (const part of a.value.split(/,\s*(?![^\s]*,)/)) {
            const url = part.trim().split(/\s+/)[0];
            if (url) refs.push(url);
          }
        if (a.name === "style")
          refs.push(...extractReferences(`x{${a.value}}`, "css"));
      }
      if (n.tagName === "style")
        refs.push(
          ...extractReferences(
            n.childNodes.map((c) => ("value" in c ? c.value : "")).join(""),
            "css",
          ),
        );
    }
    if ("childNodes" in n) n.childNodes.forEach(visit);
  };
  visit(parse(text));
  return refs;
}
export function extractBase(text: string): string | undefined {
  let base: string | undefined;
  const visit = (n: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in n && n.tagName === "base" && base === undefined)
      base = n.attrs.find((a) => a.name === "href")?.value;
    if ("childNodes" in n) n.childNodes.forEach(visit);
  };
  visit(parse(text));
  return base;
}
