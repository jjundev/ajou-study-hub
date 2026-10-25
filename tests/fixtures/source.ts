import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { courses } from "../../config/courses.js";
import type { SourceSettings } from "../../tools/content/source.js";
export async function createSourceFixture() {
  const root = await mkdtemp(join(tmpdir(), "study-source-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  await writeFile(join(root, ".fixture"), "synthetic");
  git("add", ".");
  git("-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", "commit", "-qm", "fixture");
  const config = structuredClone(courses[0]!);
  config.extraFiles = []; // Unit fixtures opt into their own dynamic dependencies.
  const settings: SourceSettings = {
    roots: { [config.id]: root },
    explicitUntracked: {},
  };
  return {
    root,
    config,
    settings,
    write: async (path: string, text: string | Uint8Array) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    },
    track: async () => {
      git("add", "-A");
    },
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
