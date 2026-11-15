import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Catalog } from "../../src/content/model.js";
import { verifyReviewDownloads } from "../../tools/representatives.js";

const groupPath = "복습노트/실험01";
const reviewPath = groupPath + "/실험01_기출문제.pdf";
const answerPath = groupPath + "/실험01_기출풀이.pdf";
const review = { path: "content/logic-lab/" + reviewPath, body: "%PDF-1.4\nreview" };
const answer = { path: "content/logic-lab/" + answerPath, body: "%PDF-1.4\nanswer" };
const outputs = [review, answer].map(({ path, body }) => ({
  path, sha256: createHash("sha256").update(body).digest("hex"),
}));
test("verifies both experiment downloads when the experiment has only PDFs", async ({ page, request, baseURL }) => {
  const catalog: Catalog = await (await request.get("/catalog.json")).json();
  expect(catalog.documents.some(doc => doc.courseId === "logic-lab" && doc.sourcePath.startsWith(groupPath + "/"))).toBe(false);
  await expect(verifyReviewDownloads(page, baseURL!, catalog, outputs)).resolves.toEqual([
    { kind: "review", ...outputs[0] }, { kind: "answer", ...outputs[1] },
  ]);

  const swapped = [{ ...outputs[0]!, sha256: outputs[1]!.sha256 }, outputs[1]!];
  await expect(verifyReviewDownloads(page, baseURL!, catalog, swapped)).rejects.toThrow("REVIEW_PDF_BYTES_MISMATCH");
  const missing = structuredClone(catalog);
  delete missing.groups.find(group => group.courseId === "logic-lab" && group.sourcePath === groupPath)!.answerPdfs;
  await expect(verifyReviewDownloads(page, baseURL!, missing, outputs)).rejects.toThrow("ANSWER_PDF_MISSING");
});
