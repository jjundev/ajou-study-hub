import type { Course, Group, MaterialType } from "../src/content/model.js";
export type GroupRule = {
  kind: Group["kind"];
  pattern: string;
  title?: string;
};
export type TypeRule = { pattern: string; type: MaterialType };
export type CourseConfig = Course & {
  contentRoot: string;
  allowedRoots: string[];
  groupRules: GroupRule[];
  typeRules: TypeRule[];
  extraFiles: string[];
};
const groupRules: GroupRule[] = [
  { kind: "date", pattern: "^\\d{4}$" },
  { kind: "experiment", pattern: "^실험0[1-6]$" },
  { kind: "supplement", pattern: "^칩 정리$" },
];
const typeRules: TypeRule[] = [
  { pattern: "^정리노트", type: "note" },
  {
    pattern: "^(복습문제|실험\\d{2}_기출문제|문제풀이\\.html$)",
    type: "review",
  },
  {
    pattern: "^(문제설명|실험\\d{2}_(문제설명|기출풀이))",
    type: "explanation",
  },
  { pattern: "^(인터렉티브|인터랙티브)", type: "interactive" },
];
export const courses: CourseConfig[] = [
  ["logic-lab", "논리회로실험", "jjundev/ajou-nonhoesil"],
  ["life-science", "생명과학", "jjundev/ajou-life-science"],
  ["circuits-2", "전자회로2", "jjundev/ajou-electronic-circuits-2"],
  ["data-structures", "자료구조", "jjundev/ajou-jagual"],
  ["ml-basics", "기계학습기초", "jjundev/ajou-ml-basics"],
].map(([id, name, repo]) => ({
  id: id!,
  name: name!,
  repo: repo!,
  semester: "2026-2",
  contentRoot: "복습노트",
  allowedRoots: ["복습노트"],
  groupRules,
  typeRules,
  extraFiles: [],
}));
