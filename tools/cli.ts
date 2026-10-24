import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildContent } from "./content/build.js";
import type { SourceSettings } from "./content/source.js";
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "content:build") throw new Error("Expected content:build");
  let sources = ".local/sources.json";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sources" && args[i + 1]) sources = args[++i]!;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const settings = JSON.parse(
    await readFile(resolve(sources), "utf8"),
  ) as SourceSettings;
  if (
    !settings ||
    typeof settings.roots !== "object" ||
    !settings.explicitUntracked ||
    typeof settings.explicitUntracked !== "object"
  )
    throw new Error("Invalid source settings");
  const result = await buildContent({
    settings,
    outputDir: resolve(".generated/content"),
    reportDir: resolve(".reports"),
  });
  console.log(
    JSON.stringify(
      {
        courses: result.catalog.courses.length,
        groups: result.catalog.groups.length,
        listed: result.catalog.documents.filter((d) => d.listed).length,
        documents: result.catalog.documents.length,
        bundleHash: result.bundleHash,
        reportPath: result.reportPath,
        issues: result.issues.length,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
