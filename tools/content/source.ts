import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { sourcePath as pathName, validateSourcePath } from "./paths.js";
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
  download?: "reviewPdfs" | "answerPdfs";
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
  repoRoots: Record<string, string>;
};
export async function inspectSources(
  configs: CourseConfig[],
  settings: SourceSettings,
  options: { batchTracking?: boolean } = {},
): Promise<SourceSnapshot> {
  const provenance: SourceProvenance[] = [];
  const catalogInputs: SourceEntry[] = [];
  const selectedFiles: SelectedFile[] = [];
  const gitMetadata = new Map<string, { trackedPaths: string[]; commit: string; dirty: boolean }>();
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
    let metadata = gitMetadata.get(root);
    if (!metadata) {
      metadata = { trackedPaths: (await git("ls-files", "-z")).split("\0").filter(Boolean).map(pathName), commit: (await git("rev-parse", "HEAD")).trim(), dirty: !!(await git("status", "--porcelain", "-z")) };
      gitMetadata.set(root, metadata);
    }
    const trackedPaths = metadata.trackedPaths;
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
    for (const p of selected)
      if (config.allowedRoots.some(r => p === r || p.startsWith(r + '/')))
        await validateSourcePath(p, config, root);
    sources.set(config.id, {
      root,
      config,
      selected,
      explicit: new Set(explicitUntracked),
    });
    provenance.push({
      courseId: config.id,
      commit: metadata.commit,
      dirty: metadata.dirty,
      trackedPaths,
      explicitUntracked,
    });
    for (const p of selected) {
      const parts = p.split("/");
      const content = config.contentRoot.split("/");
      if (!p.startsWith(config.contentRoot + "/")) continue;
      const group = parts[content.length]!;
      const filename = parts.at(-1)!;
      const depth = parts.length - content.length;
      const inLesson = depth === 2;
      const inPack = depth === 3 && parts.at(-2) === ".pack";
      const packKind = (inLesson || inPack) && /^복습문제_.+-(문제|답안)\.pdf$/i.exec(filename)?.[1];
      const examKind = inLesson && /^실험\d+_기출(문제|풀이)\.pdf$/i.exec(filename)?.[1];
      if (!(inLesson && /\.html?$/i.test(filename)) && !packKind && !examKind) continue;
      if ([...content, group, filename].some(s => s.startsWith(".") || /^backup[-_]/i.test(s)) ||
          /제작/.test(filename)) continue;
      const rule = config.groupRules.find((r) =>
        new RegExp(r.pattern).test(group),
      );
      if (!rule) continue;
      if (examKind && (rule.kind !== "experiment" || !filename.startsWith(group + "_"))) continue;
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
        ...(packKind || examKind ? {
          download: (packKind || examKind) === "문제" ? "reviewPdfs" : "answerPdfs",
        } : {}),
      });
    }
  }
  return {
    configs,
    repoRoots: Object.fromEntries([...sources].map(([id, s]) => [id, s.root])),
    provenance,
    catalogInputs,
    selectedFiles,
    readFile: async (courseId, path) => {
      const s = sources.get(courseId);
      if (!s) throw new Error(`Unknown course: ${courseId}`);
      const p = pathName(path);
      if (
        !s.selected.has(p) ||
        !s.config.allowedRoots.some((r) => p === r || p.startsWith(r + "/"))
      )
        throw new Error(`Source not allowed: ${p}`);
      if (!options.batchTracking && !s.explicit.has(p)) {
        const current = (
          await exec("git", ["ls-files", "-z", "--", p], {
            cwd: s.root,
            encoding: "utf8",
          })
        ).stdout.split("\0");
        if (!current.includes(p))
          throw new Error(`Source no longer tracked: ${p}`);
      }
      const target = await validateSourcePath(p, s.config, s.root);
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

/** Recheck live tracking and containment before comparing every captured input byte. */
export async function verifySnapshot(snapshot: SourceSnapshot): Promise<void> {
  const trackedRoots = new Map<string, Set<string>>();
  for (const config of snapshot.configs) {
    const root = snapshot.repoRoots[config.id]!;
    const tracked = trackedRoots.get(root) ?? new Set(
      (
        await exec("git", ["ls-files", "-z"], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
        })
      ).stdout.split("\0"),
    );
    trackedRoots.set(root, tracked);
    const explicit = new Set(
      snapshot.provenance.find(
        (p) => p.courseId === config.id,
      )!.explicitUntracked,
    );
    for (const file of snapshot.selectedFiles.filter(
      (f) => f.courseId === config.id,
    )) {
      if (!tracked.has(file.sourcePath) && !explicit.has(file.sourcePath))
        throw new Error(`Source no longer tracked: ${file.sourcePath}`);
      const target = await validateSourcePath(file.sourcePath, config, root);
      const hash = createHash("sha256")
        .update(await readFile(target))
        .digest("hex");
      if (hash !== file.hash)
        throw new Error(`Source changed during snapshot: ${file.sourcePath}`);
    }
  }
}
