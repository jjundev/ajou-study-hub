import { readFile, realpath, lstat, readdir } from "node:fs/promises";
import { resolve, extname, relative, isAbsolute } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import type { BuildReport } from "./content/report.js";
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
/** Verify all bytes before and after browser execution; report metadata alone is not proof. */
export async function assertCurrentBundle(
  root: string,
  report: BuildReport,
  projectRoot = process.cwd(),
  verificationDirectory?: string,
): Promise<void> {
  const canonical = await realpath(root);
  if ((await lstat(root)).isSymbolicLink()) throw Error("Symlink bundle root");
  const project = await realpath(projectRoot);
  if (canonical !== (verificationDirectory ?? resolve(project, "dist")) ||
      (verificationDirectory && !relative(resolve(project, '.generated'), canonical).match(/^course-verification-[a-zA-Z0-9]+$/)))
    throw Error("Verification requires owned dist");
  root=canonical;
  const paths = new Set<string>();
  for (const f of report.outputs) {
    const p = resolve(root, f.path);
    const r = relative(root, p);
    if (
      !r ||
      isAbsolute(r) ||
      r === ".." ||
      r.startsWith("..\\") ||
      r.startsWith("../") ||
      paths.has(f.path)
    )
      throw Error("Unsafe/duplicate manifest output");
    paths.add(f.path);
    let cursor = p;
    while (cursor !== canonical) {
      if ((await lstat(cursor)).isSymbolicLink())
        throw Error("Symlink bundle path");
      cursor = resolve(cursor, "..");
    }
    if (sha(await readFile(p)) !== f.sha256)
      throw Error("Changed bundle output: " + f.path);
  }
  if (
    sha(report.outputs.map((f) => `${f.path}\0${f.sha256}\n`).join("")) !==
    report.bundleHash
  )
    throw Error("Invalid manifest bundle hash");
  const inventory: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error("Symlink bundle inventory");
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        inventory.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  await walk(root);
  if (inventory.length !== paths.size || inventory.some((p) => !paths.has(p)))
    throw Error("Bundle inventory differs from manifest");
  if (
    !paths.has("index.html") ||
    !report.outputs.some((f) => /^assets\/.+\.js$/.test(f.path))
  )
    throw Error("App-inclusive manifest required");
}
export async function serveManifest(
  root: string,
  report: BuildReport,
  read?: (path: string) => Promise<Uint8Array>,
) {
  const files = new Set(report.outputs.map((f) => f.path));
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".pdf": "application/pdf",
  };
  const unprovenPaths: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url!, "http://localhost").pathname,
      );
      const p = pathname === "/" ? "index.html" : pathname.slice(1);
      if (!files.has(p) && !(read && /^content\/[^/]+\/.+/.test(p))) {
        if (read) unprovenPaths.push(pathname);
        res.writeHead(404);
        res.end("Not in verified manifest");
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = read ? await read(p) : await readFile(resolve(root, p));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          unprovenPaths.push("/" + p);
        throw error;
      }
      if (
        !read &&
        sha(bytes) !== report.outputs.find((f) => f.path === p)!.sha256
      )
        throw Error("Served bytes differ from manifest");
      res.writeHead(200, {
        "content-type": types[extname(p)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end("Not available");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return {
    unprovenPaths,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
  };
}
