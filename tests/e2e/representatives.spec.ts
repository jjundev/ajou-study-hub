import { test, expect } from "@playwright/test";
import { pagerHistory, trackRepresentativeRequests, confirmCancelledCdnRequest } from "../../tools/representatives.js";
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
  await page.route("**/catalog.json", (r) => r.fulfill({ json: catalog }));
  await page.route("**/content/c/notes/pager.html", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<section id="s0" class="screen is-current">Cover</section><section id="s1" class="screen" hidden>One</section><section id="s2" class="screen" hidden>Two</section><button id="pager-next">Next</button><script>let i=Number(location.hash.slice(2))||0;function render(){document.querySelectorAll('section').forEach((s,n)=>{s.hidden=n!==i;s.className='screen'+(n===i?' is-current':'');});}document.querySelector('button').onclick=()=>{i++;history.pushState(null,'','#s'+i);render();};onpopstate=()=>{i=Number(location.hash.slice(2))||0;render();};render();</script>`,
    }),
  );
  await page.goto("/#/read/" + doc.id);
  const result = await pagerHistory(page);
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

test("confirms an interrupted CDN resource only if the exact URL returns a valid response", async () => {
  const url = "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff2/Pretendard-Regular.woff2";
  const bodies = [new Response("wOF2contents", { headers: { "content-type": "font/woff2" } }),
                  new Response("<html>error</html>", { headers: { "content-type": "text/html" } }),
                  new Response("wOF2contents", { status: 404, headers: { "content-type": "font/woff2" } })];
  for (const [index, response] of bodies.entries()) {
    expect(await confirmCancelledCdnRequest(url, "font", async target => {
      expect(target).toBe(url);
      return response;
    })).toBe(index === 0);
  }
  expect(await confirmCancelledCdnRequest(url.replace("cdn.jsdelivr.net", "other.invalid"), "font", async () => {
    throw new Error("must not request an unknown CDN");
  })).toBe(false);
});
