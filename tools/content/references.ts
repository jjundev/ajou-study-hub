import { parse, type DefaultTreeAdapterMap } from "parse5";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
// Srcset URLs extend through commas until whitespace; only trailing commas
// terminate a candidate without descriptors. This preserves data URL payloads.
function srcsetReferences(value: string): string[] {
  const urls: string[] = [];
  const space = (char: string) => /[\t\n\f\r ]/.test(char);
  let position = 0;
  while (position < value.length) {
    while (
      position < value.length &&
      (space(value[position]!) || value[position] === ",")
    )
      position++;
    const start = position;
    while (position < value.length && !space(value[position]!)) position++;
    const token = value.slice(start, position);
    if (!token) break;
    const url = token.replace(/,+$/, "");
    if (url) urls.push(url);
    if (token.endsWith(",")) continue;
    // Descriptors may contain parentheses; commas inside them are not separators.
    let parentheses = 0;
    while (position < value.length) {
      const char = value[position++]!;
      if (char === "(") parentheses++;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (char === "," && parentheses === 0) break;
    }
  }
  return urls;
}
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
        if (a.name === "srcset") refs.push(...srcsetReferences(a.value));
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
