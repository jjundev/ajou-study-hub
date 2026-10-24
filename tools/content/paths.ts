import { realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, posix } from "node:path";
import type { CourseConfig } from "../../config/courses.js";
export type ResolvedReference =
  | { kind: "local"; sourcePath: string; suffix: string }
  | { kind: "external" | "anchor" | "ignored" }
  | { kind: "invalid"; reason: string };
export function sourcePath(path: string): string {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    isAbsolute(path) ||
    /^[a-z]:/i.test(path) ||
    path.split("/").some((s) => !s || s === "." || s === "..")
  )
    throw new Error(`Unsafe source path: ${path}`);
  return path;
}
export const within = (path: string, root: string) =>
  path === root || path.startsWith(root + "/");
const contained = (root: string, target: string) => {
  const r = relative(root, target);
  return (
    r !== ".." &&
    !r.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) &&
    !isAbsolute(r)
  );
};
export async function validateSourcePath(
  path: string,
  config: CourseConfig,
  repoRoot: string,
): Promise<string> {
  const p = sourcePath(path);
  if (!config.allowedRoots.some((r) => within(p, sourcePath(r))))
    throw new Error(`Source not allowed: ${p}`);
  const root = await realpath(repoRoot),
    target = await realpath(resolve(root, p));
  if (!contained(root, target))
    throw new Error(`Source escapes repository: ${p}`);
  let allowed = false;
  for (const r of config.allowedRoots) {
    try {
      const realRoot = await realpath(resolve(root, sourcePath(r)));
      if (contained(root, realRoot) && contained(realRoot, target))
        allowed = true;
    } catch {}
  }
  if (!allowed) throw new Error(`Source escapes allowed roots: ${p}`);
  return target;
}
export async function resolveReference(
  input: { courseId: string; from: string; ref: string },
  config: CourseConfig,
  repoRoot: string,
): Promise<ResolvedReference> {
  try {
    const ref = input.ref.trim();
    if (input.courseId !== config.id) throw new Error("Course mismatch");
    if (!ref || ref.startsWith("#")) return { kind: "anchor" };
    if (ref.includes("\\") || /^[a-z]:/i.test(ref))
      throw new Error("Windows paths are forbidden");
    if (/^(https?:)?\/\//i.test(ref)) return { kind: "external" };
    if (/^(data|javascript|mailto|tel|blob):/i.test(ref))
      return { kind: "ignored" };
    if (/^[a-z][a-z\d+.-]*:/i.test(ref))
      throw new Error("Unsupported URL scheme");
    const at = ref.search(/[?#]/),
      raw = at < 0 ? ref : ref.slice(0, at),
      suffix = at < 0 ? "" : ref.slice(at);
    const decoded = decodeURIComponent(raw);
    if (
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      /%[0-9a-f]{2}/i.test(decoded) ||
      /^[a-z]:/i.test(decoded) ||
      decoded.startsWith("//")
    )
      throw new Error("Ambiguous encoded path");
    const path = posix.normalize(
      decoded.startsWith("/")
        ? decoded.slice(1)
        : posix.join(posix.dirname(sourcePath(input.from)), decoded),
    );
    await validateSourcePath(path, config, repoRoot);
    return { kind: "local", sourcePath: path, suffix };
  } catch (error) {
    return { kind: "invalid", reason: (error as Error).message };
  }
}
