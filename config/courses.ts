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
import { logicWorkbookFigures } from "./dynamic-assets.js";
const additionalRoots: Record<string, string[]> = {
  "circuits-2": ["workbook/pdf/ch09-문제.pdf", "workbook/pdf/ch10-문제.pdf"],
  "data-structures": [
    "자료구조_강의록_2026/Software_2_Recursion.pdf",
    "자료구조_강의록_2026/Software_3_ArrayStructureList.pdf",
    "자료구조_강의록_2026/Software_4_List.pdf",
    "자료구조_강의록_2026/Software_5_Stack.pdf",
    "자료구조_강의록_2026/Software_6_Queue.pdf",
    "실습/실습2/Practice2.pdf",
    "과제/과제2/HW2.pdf",
  ],
  "ml-basics": ["강의노트/추가 강의"],
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
  allowedRoots: ["복습노트", ...(additionalRoots[id!] ?? [])],
  groupRules,
  typeRules,
  extraFiles: id === "logic-lab" ? logicWorkbookFigures : [],
}));
