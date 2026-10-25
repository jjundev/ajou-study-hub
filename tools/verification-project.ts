import { lstat, realpath } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
export const verifierProject = resolve(
  fileURLToPath(new URL("../", import.meta.url)),
);
/** Test roots are reserved owned children, never arbitrary caller projects or originals. */
export async function verificationProject(testRoot?: string): Promise<string> {
  const project = await realpath(verifierProject);
  if (!testRoot) return project;
  const scope = resolve(project, ".generated/verification-tests");
  const target = resolve(testRoot);
  if (
    dirname(target) !== scope ||
    !/^[a-z0-9-]+$/i.test(relative(scope, target))
  )
    throw Error("Unsafe isolated verification project");
  let cursor = target;
  while (cursor !== project) {
    if ((await lstat(cursor)).isSymbolicLink())
      throw Error("Symlink isolated verification project");
    cursor = dirname(cursor);
  }
  if ((await realpath(target)) !== target)
    throw Error("Noncanonical isolated verification project");
  return target;
}
