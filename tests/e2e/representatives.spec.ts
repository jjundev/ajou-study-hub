import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { transformHtml } from "../../tools/content/transform.js";
import { pagerHistory, trackRepresentativeRequests } from "../../tools/representatives.js";
import type { Catalog, DocumentInfo } from "../../src/content/model.js";
test("representative pager check requires rendered source history after actual Next actions", async ({
  page,
}) => {
  const doc: DocumentInfo = {
    id: "doc-synthetic",
    courseId: "c",
    groupId: null,
    title: "Synthetic pager",
    type: "note",
    listed: true,
    sourcePath: "notes/pager.html",
    url: "/content/c/notes/pager.html",
  };
  const catalog: Catalog = {
    version: 1,
    courses: [
      {
        id: "c",
        name: "Synthetic course",
        repo: "fixture",
        semester: "2026-2",
      },
    ],
    groups: [],
    documents: [doc],
  };
  const bundle = await build({
    stdin: {
      contents:
        "import {installReaderBridge} from './src/compat/reader-bridge.ts';installReaderBridge(window.__STUDY_HUB__.document.id);",
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "iife",
    write: false,
  });
  await page.route("**/catalog.json", (r) => r.fulfill({ json: catalog }));
  await page.route("**/content/c/notes/pager.html", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: transformHtml(
        `<section id="s0" class="screen is-current">Cover</section><section id="s1" class="screen" hidden>One</section><section id="s2" class="screen" hidden>Two</section><button id="pager-next">Next</button><script>let i=Number(location.hash.slice(2))||0;function render(){document.querySelectorAll('section').forEach((s,n)=>{s.hidden=n!==i;s.className='screen'+(n===i?' is-current':'');});}document.querySelector('button').onclick=()=>{i++;history.pushState(null,'','#s'+i);render();};onpopstate=()=>{i=Number(location.hash.slice(2))||0;render();};render();</script>`,
        doc,
        bundle.outputFiles[0]!.text,
      ),
    }),
  );
  await page.goto("/#/read/" + doc.id);
  const result = await pagerHistory(page, page.frameLocator("iframe"));
  expect(result).toEqual({ initial: "s0", first: "s1", second: "s2" });
});

test("waits for a representative's delayed requests before the verifier reloads it", async ({ page }) => {
  let responseSent = false;
  await page.route("**/slow-representative-resource", async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.fulfill({ body: "ok" });
    responseSent = true;
  });
  await page.goto("/");
  const settle = trackRepresentativeRequests(page);
  await page.evaluate(() => { void fetch("/slow-representative-resource"); });
  await settle();
  expect(responseSent).toBe(true);
});
