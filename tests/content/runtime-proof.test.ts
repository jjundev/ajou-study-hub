import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  assertCurrentBundle,
  serveManifest,
} from "../../tools/runtime-server.js";
import type { BuildReport } from "../../tools/content/report.js";
const sha = (b: string) => createHash("sha256").update(b).digest("hex");
it("binds proof to exact app bytes and refuses changed, added and content-only bundles", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-proof-"));
  const dist = join(root, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "index.html"), "app");
  await writeFile(join(dist, "assets/app.js"), "app code");
  await writeFile(join(dist, "catalog.json"), "{}");
  const outputs = [
    { path: "catalog.json", sha256: sha("{}"), size: 2 },
    { path: "index.html", sha256: sha("app"), size: 3 },
    { path: "assets/app.js", sha256: sha("app code"), size: 8 },
  ];
  const report: BuildReport = {
    createdAt: "",
    bundleHash: sha(outputs.map((f) => `${f.path}\0${f.sha256}\n`).join("")),
    sources: [],
    inputs: [],
    outputs,
    issues: [],
  };
  try {
    await expect(
      assertCurrentBundle(dist, report, root),
    ).resolves.toBeUndefined();
    await writeFile(join(dist, "catalog.json"), "changed catalog");
    await expect(assertCurrentBundle(dist, report, root)).rejects.toThrow(
      "Changed bundle output: catalog.json",
    );
    await writeFile(join(dist, "catalog.json"), "{}");
    const linked = await mkdtemp(join(tmpdir(), "study-proof-link-"));
    try {
      await symlink(dist, join(linked, "dist"), "junction");
      await expect(
        assertCurrentBundle(join(linked, "dist"), report, linked),
      ).rejects.toThrow("Symlink bundle root");
    } finally {
      await rm(linked, { recursive: true, force: true });
    }
    await writeFile(join(dist, "assets/app.js"), "changed");
    await expect(assertCurrentBundle(dist, report, root)).rejects.toThrow(
      "Changed bundle",
    );
    await writeFile(join(dist, "assets/app.js"), "app code");
    await writeFile(join(dist, "stale.html"), "stale");
    await expect(assertCurrentBundle(dist, report, root)).rejects.toThrow(
      "inventory",
    );
    await rm(join(dist, "stale.html"));
    await expect(
      assertCurrentBundle(dist, { ...report, bundleHash: "stale" }, root),
    ).rejects.toThrow("hash");
    const only = { ...report, outputs: outputs.slice(0, 1) };
    only.bundleHash = sha(
      only.outputs.map((f) => `${f.path}\0${f.sha256}\n`).join(""),
    );
    await expect(assertCurrentBundle(dist, only, root)).rejects.toThrow();
    const server = await serveManifest(dist, report);
    try {
      expect((await fetch(server.baseUrl + "/stale.html")).status).toBe(404);
      expect(await (await fetch(server.baseUrl + "/")).text()).toBe("app");
    } finally {
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
