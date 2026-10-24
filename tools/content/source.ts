import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { CourseConfig } from "../../config/courses.js";
const exec = promisify(execFile);
export type SourceSettings = {
  roots: Record<string, string>;
  explicitUntracked: Record<string, string[]>;
};
export type SourceEntry = {
  courseId: string;
  groupPath: string;
  sourcePath: string;
};
export type SourceProvenance = {
  courseId: string;
  commit: string;
  dirty: boolean;
  trackedPaths: string[];
  explicitUntracked: string[];
};
export type SelectedFile = {
  courseId: string;
  sourcePath: string;
  bytes: Uint8Array;
  hash: string;
};
export type SourceSnapshot = {
  catalogInputs: SourceEntry[];
  readFile: (courseId: string, path: string) => Promise<Uint8Array>;
  provenance: SourceProvenance[];
  configs: CourseConfig[];
  selectedFiles: SelectedFile[];
};
function pathName(path: string): string {
  const p = path.replaceAll("\\", "/");
  if (
    !p ||
    isAbsolute(p) ||
    /^[A-Za-z]:/.test(p) ||
    p.split("/").some((s) => !s || s === "." || s === "..")
  )
    throw new Error(`Unsafe source path: ${path}`);
  return p;
}
const within = (path: string, root: string) =>
  path === root || path.startsWith(root + "/");
export async function inspectSources(
  configs: CourseConfig[],
  settings: SourceSettings,
): Promise<SourceSnapshot> {
  const provenance: SourceProvenance[] = [];
  const catalogInputs: SourceEntry[] = [];
  const selectedFiles: SelectedFile[] = [];
  const sources = new Map<
    string,
    {
      root: string;
      config: CourseConfig;
      selected: Set<string>;
      explicit: Set<string>;
    }
  >();
  for (const config of configs) {
    if (sources.has(config.id))
      throw new Error(`Duplicate course: ${config.id}`);
    const location = settings.roots[config.id];
    if (!location) throw new Error(`Missing root: ${config.id}`);
    const root = await realpath(resolve(location));
    const git = async (...args: string[]) =>
      (
        await exec("git", args, {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
        })
      ).stdout;
    const trackedPaths = (await git("ls-files", "-z"))
      .split("\0")
      .filter(Boolean)
      .map(pathName);
    const explicitUntracked = (settings.explicitUntracked[config.id] ?? []).map(
      pathName,
    );
    const selected = new Set([...trackedPaths, ...explicitUntracked]);
    const normalized = new Set<string>();
    for (const p of selected) {
      const n = p.normalize("NFC");
      if (normalized.has(n)) throw new Error(`Normalized path collision: ${p}`);
      normalized.add(n);
    }
    for (const allowed of config.allowedRoots) pathName(allowed);
    sources.set(config.id, {
      root,
      config,
      selected,
      explicit: new Set(explicitUntracked),
    });
    provenance.push({
      courseId: config.id,
      commit: (await git("rev-parse", "HEAD")).trim(),
      dirty: !!(await git("status", "--porcelain", "-z")),
      trackedPaths,
      explicitUntracked,
    });
    for (const p of selected) {
      const parts = p.split("/");
      const content = config.contentRoot.split("/");
      if (
        !p.startsWith(config.contentRoot + "/") ||
        parts.length !== content.length + 2 ||
        !/\.html?$/i.test(p)
      )
        continue;
      if (
        parts.some((s) => s.startsWith(".") || /^backup[-_]/i.test(s)) ||
        /제작/.test(parts.at(-1)!)
      )
        continue;
      const group = parts[content.length]!;
      const rule = config.groupRules.find((r) =>
        new RegExp(r.pattern).test(group),
      );
      if (!rule) continue;
      if (rule.kind === "date") {
        const month = Number(group.slice(0, 2)),
          day = Number(group.slice(2));
        const d = new Date(Date.UTC(2026, month - 1, day));
        if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) continue;
      }
      catalogInputs.push({
        courseId: config.id,
        groupPath: config.contentRoot + "/" + group,
        sourcePath: p,
      });
    }
  }
  return {
    configs,
    provenance,
    catalogInputs,
    selectedFiles,
    readFile: async (courseId, path) => {
      const s = sources.get(courseId);
      if (!s) throw new Error(`Unknown course: ${courseId}`);
      const p = pathName(path);
      if (
        !s.selected.has(p) ||
        !s.config.allowedRoots.some((r) => within(p, r))
      )
        throw new Error(`Source not allowed: ${p}`);
      if (!s.explicit.has(p)) {
        const current = (
          await exec("git", ["ls-files", "-z", "--", p], {
            cwd: s.root,
            encoding: "utf8",
          })
        ).stdout.split("\0");
        if (!current.includes(p))
          throw new Error(`Source no longer tracked: ${p}`);
      }
      const target = await realpath(resolve(s.root, p));
      const rel = relative(s.root, target);
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new Error(`Source escapes repository: ${p}`);
      const realAllowed = await Promise.all(
        s.config.allowedRoots.map((r) => realpath(resolve(s.root, r))),
      );
      if (
        !realAllowed.some((r) => {
          const part = relative(r, target);
          return !part.startsWith("..") && !isAbsolute(part);
        })
      )
        throw new Error(`Source escapes allowed roots: ${p}`);
      const bytes = new Uint8Array(await readFile(target));
      const hash = createHash("sha256").update(bytes).digest("hex");
      const prior = selectedFiles.find(
        (f) => f.courseId === courseId && f.sourcePath === p,
      );
      if (prior && prior.hash !== hash)
        throw new Error(`Source changed during snapshot: ${p}`);
      if (!prior)
        selectedFiles.push({
          courseId,
          sourcePath: p,
          bytes: bytes.slice(),
          hash,
        });
      return bytes;
    },
  };
}
