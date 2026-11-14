export const materialTypes = [
  "note",
  "review",
  "check",
  "explanation",
  "interactive",
  "comic",
  "other",
] as const;
export type MaterialType = (typeof materialTypes)[number];
export type Course = {
  id: string;
  name: string;
  repo: string;
  semester: "2026-2";
};
export type Group = {
  id: string;
  courseId: string;
  title: string;
  sourcePath: string;
  kind: "date" | "experiment" | "supplement";
  date: string | null;
  order: number;
};
export type DocumentInfo = {
  id: string;
  courseId: string;
  groupId: string | null;
  title: string;
  type: MaterialType;
  sourcePath: string;
  url: string;
  listed: boolean;
};
export type Catalog = {
  version: 1;
  courses: Course[];
  groups: Group[];
  documents: DocumentInfo[];
};
export type Issue = {
  code: string;
  courseId: string;
  sourcePath: string;
  target: string;
  reason: string;
  severity: "error" | "warning";
};
