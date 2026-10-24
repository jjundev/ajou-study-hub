import { mkdir, writeFile } from "node:fs/promises";
import { courses } from "../config/courses.js";
import { createSourceFixture } from "../tests/fixtures/source.js";
const settings = { roots: {} as Record<string, string>, explicitUntracked: {} };
// Fixtures persist for local development; each location is a synthetic temporary repository.
for (const course of courses) {
  const fixture = await createSourceFixture();
  await fixture.write(
    "복습노트/1001/정리노트.html",
    `<!doctype html><title>${course.name} 합성 자료</title><h1>합성 학습 자료</h1>`,
  );
  await fixture.track();
  settings.roots[course.id] = fixture.root;
}
await mkdir(".local", { recursive: true });
await writeFile(
  ".local/fixture-sources.json",
  JSON.stringify(settings, null, 2) + "\n",
);
console.log(
  "Created five synthetic sources; settings: .local/fixture-sources.json",
);
