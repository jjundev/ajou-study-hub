import { it, expect } from "vitest";
import { auditWorkbookFigures } from "../../tools/runtime-workbooks.js";
it("rejects an unclicked later workbook figure omitted from output", async () => {
  const html =
    '<script id="workbook-data" type="application/json">{"problems":[{"figures":[{"src":"first.png"}]},{"figures":[{"src":"later.png"}]}]}</script>';
  const input = {
    courseId: "logic-lab",
    sourcePath: "복습노트/실험01/workbook.html",
  };
  await expect(
    auditWorkbookFigures([input], async () => new TextEncoder().encode(html), [
      "content/logic-lab/복습노트/실험01/first.png",
    ]),
  ).rejects.toThrow("later.png");
  const result = await auditWorkbookFigures(
    [input],
    async () => new TextEncoder().encode(html),
    [
      "content/logic-lab/복습노트/실험01/first.png",
      "content/logic-lab/복습노트/실험01/later.png",
    ],
  );
  expect(result.figures).toHaveLength(2);
});

it("audits HTML strings nested inside workbook solution JSON", async () => {
  const html =
    '<script id="workbook-data">' +
    JSON.stringify({
      solution: { steps: [{ html: '<img src=".pack/solution.png">' }] },
    }) +
    "</script>";
  await expect(
    auditWorkbookFigures(
      [{ courseId: "logic-lab", sourcePath: "복습노트/실험01/a.html" }],
      async () => new TextEncoder().encode(html),
      [],
    ),
  ).rejects.toThrow("solution.png");
});
