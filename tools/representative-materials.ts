import { contentUrl, type Catalog } from "../src/content/model.js";

export const representativePaths = [
  ["life-science", "복습노트/0901/복습문제_0901_Biomolecules_and_Cells.html"],
  ["data-structures", "복습노트/1012/정리노트_1012_Queue.html"],
  ["ml-basics", "복습노트/1012/정리노트_1012_Several_Mathematical_Proofs.html"],
  ["ml-basics", "복습노트/1014/인터렉티브_01_사전분포와_사후분포.html"],
  ["logic-lab", "복습노트/실험01/실험01_문제설명.html"],
  ["circuits-2", "복습노트/0909/문제설명_0909_Cascode_Stage.html"],
] as const;

export const reviewDownloadCase = {
  id: "logic-lab-experiment-01-downloads",
  courseId: "logic-lab",
  groupPath: "복습노트/실험01",
} as const;
export const representativeBrowserNames = ["chromium", "firefox", "webkit"] as const;
export const representativeWidths = [390, 1440] as const;
export const representativeScenarioCount =
  (representativePaths.length + 1) * representativeBrowserNames.length * representativeWidths.length;

export class ReviewDownloadError extends Error {}

export function resolveReviewDownloads(catalog: Catalog, outputs: readonly { path: string; sha256: string }[]) {
  const { courseId, groupPath } = reviewDownloadCase;
  const groups = catalog.groups.filter(group =>
    group.courseId === courseId && group.kind === "experiment" && group.sourcePath === groupPath);
  if (groups.length !== 1) throw new ReviewDownloadError("REVIEW_PDF_GROUP_UNAVAILABLE");
  const group = groups[0]!;
  const pathHashes = new Map(outputs.map(file => [file.path, file.sha256]));
  const seen = new Set<string>();
  const files = [
    { kind: "review", paths: group.reviewPdfs, missing: "REVIEW_PDF_MISSING" },
    { kind: "answer", paths: group.answerPdfs, missing: "ANSWER_PDF_MISSING" },
  ] as const;
  const downloads = files.flatMap(({ kind, paths, missing }) => {
    if (!paths?.length) throw new ReviewDownloadError(missing);
    return paths.map(sourcePath => {
      const path = `content/${courseId}/${sourcePath.normalize("NFC")}`;
      const sha256 = pathHashes.get(path);
      if (!sha256 || seen.has(path) || !sourcePath.startsWith(groupPath + "/") || !/\.pdf$/i.test(sourcePath))
        throw new ReviewDownloadError("REVIEW_PDF_INVALID_ASSET");
      seen.add(path);
      return { kind, path, sha256 };
    });
  });
  return { groupId: group.id, downloads };
}

export function reviewDownloadUrl(path: string) {
  const prefix = `content/${reviewDownloadCase.courseId}/`;
  return contentUrl(reviewDownloadCase.courseId, path.slice(prefix.length));
}
