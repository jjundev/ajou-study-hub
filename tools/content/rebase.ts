import { mapSrcset } from "./references.js";
import { parse, serialize } from "parse5";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
/** Rebase source URLs only in deployment copies; collected bytes remain untouched. */
export function rebaseReferences(
  text: string,
  kind: "html" | "css",
  courseId: string,
  sourcePath: string,
): string {
  const origin = "https://source.invalid";
  let base = new URL(
    sourcePath.split("/").map(encodeURIComponent).join("/"),
    origin + "/",
  );
  const deploymentUrl = (url: URL) => {
    const path = decodeURIComponent(url.pathname)
      .normalize("NFC")
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    return `/content/${courseId}${path}${url.search}${url.hash}`;
  };
  const rewrite = (ref: string) => {
    if (
      !ref.trim() ||
      ref.startsWith("#") ||
      /^(?:[a-z][\w+.-]*:|\/\/)/i.test(ref)
    )
      return ref;
    const url = new URL(ref, base);
    return url.origin === origin ? deploymentUrl(url) : url.href;
  };
  const css = (text: string) => {
    const root = postcss.parse(text);
    const value = (s: string) => {
      const ast = valueParser(s);
      ast.walk((n) => {
        if (n.type === "function" && n.value.toLowerCase() === "url") {
          const first = n.nodes[0];
          if (first && (first.type === "string" || first.type === "word"))
            first.value = rewrite(first.value);
          return false;
        }
      });
      return ast.toString();
    };
    root.walkDecls((d) => {
      d.value = value(d.value);
    });
    root.walkAtRules("import", (r) => {
      const ast = valueParser(r.params);
      const n = ast.nodes[0];
      if (n?.type === "string") {
        n.value = rewrite(n.value);
        r.params = ast.toString();
      } else r.params = value(r.params);
    });
    return root.toString();
  };
  if (kind === "css") return css(text);
  const tree = parse(text);
  const find = (n: any) => {
    if (n.tagName === "base") {
      const a = n.attrs.find((a: any) => a.name === "href");
      if (a) base = new URL(a.value, base);
    }
    for (const c of n.childNodes ?? []) find(c);
  };
  find(tree);
  const visit = (n: any) => {
    if (n.tagName) {
      for (const a of n.attrs) {
        if (["href", "src", "poster", "data", "xlink:href"].includes(a.name)) {
          if (n.tagName === "base") {
            a.value = base.origin === origin ? deploymentUrl(base) : base.href;
          } else a.value = rewrite(a.value);
        }
        if (a.name === "srcset") a.value = mapSrcset(a.value, rewrite);
        if (a.name === "style") a.value = css(`x{${a.value}}`).slice(2, -1);
      }
      if (n.tagName === "style")
        for (const c of n.childNodes ?? [])
          if ("value" in c) c.value = css(c.value);
    }
    for (const c of n.childNodes ?? []) visit(c);
  };
  visit(tree);
  return serialize(tree);
}
