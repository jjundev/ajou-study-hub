import { lstat, mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { courses } from "../config/courses.js";
import { createSourceFixture } from "../tests/fixtures/source.js";
const project = resolve(process.cwd());
const destination = resolve(project, '.local/fixture-sources.json');
async function validateDestination(path = destination): Promise<void> {
  if (path !== destination && !/^fixture-sources\.json\.tmp-[a-f0-9-]+$/.test(path.slice(dirname(path).length + 1)))
    throw Error('Unexpected fixture settings destination');
  if (dirname(path) !== resolve(project, '.local')) throw Error('Fixture settings must stay in the owned .local directory');
  let cursor = path;
  while (true) {
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw Error('Symlink fixture settings destination or ancestor');
      if (cursor === path ? !stat.isFile() : !stat.isDirectory()) throw Error('Invalid fixture settings destination or ancestor');
      if (await realpath(cursor) !== cursor) throw Error('Noncanonical fixture settings destination');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
}
// Reject aliases before creating any synthetic repositories, then recheck at publication.
await validateDestination();
const settings = { roots: {} as Record<string, string>, explicitUntracked: {} };
// Fixtures persist for local development; each location is a synthetic temporary repository.
for (const course of courses) {
  const fixture = await createSourceFixture();
  await fixture.write(
    "복습노트/1001/정리노트.html",
    `<!doctype html><title>${course.name} 합성 자료</title><h1>합성 학습 자료</h1><a href="#section">합성 앵커</a><div id="section">합성 본문</div><button onclick="location.hash='section'">합성 스크립트 이동</button>`,
  );
  if (course.id === 'ml-basics') {
    await fixture.write('복습노트/1001/복습문제_1001_트리 순회.html', '<title>트리 순회 퀴즈</title>');
    await fixture.write('복습노트/1001/.pack/복습문제_1001_트리 순회-문제.pdf', '%PDF-1.4\n문제\n');
    await fixture.write('복습노트/1001/.pack/복습문제_1001_트리 순회-답안.pdf', '%PDF-1.4\n답안\n');
  }
  if (course.id === 'circuits-2') {
    await fixture.write('복습노트/1001/복습문제_1001_증폭기-문제.pdf', '%PDF-1.4\nfixture\n');
    await fixture.write('복습노트/1001/복습문제_1001_증폭기-답안.pdf', '%PDF-1.4\nfixture\n');
  }
  for (const path of course.extraFiles)
    await fixture.write(
      path,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=",
        "base64",
      ),
    );
  await fixture.track();
  settings.roots[course.id] = fixture.root;
}
await validateDestination();
await mkdir(dirname(destination), { recursive: true });
await validateDestination();
const temporary = destination + '.tmp-' + randomUUID();
try {
  await validateDestination(temporary);
  await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await validateDestination(); await validateDestination(temporary);
  await rename(temporary, destination);
} finally {
  await validateDestination(temporary);
  try { await unlink(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
console.log(
  "Created five synthetic sources; settings: .local/fixture-sources.json",
);
