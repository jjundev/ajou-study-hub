import { documentUrl } from '../app/router.js';
import { materialTypes, type Catalog, type DocumentInfo } from './model.js';
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string');
function validPdfPaths(value: unknown, groupPath: string): boolean {
  if (value === undefined) return true;
  const prefix = groupPath + '/';
  return Array.isArray(value) && value.every(path => typeof path === 'string' &&
    path.startsWith(prefix) && /^(?:\.pack\/)?[^/\\\x00-\x1f]+\.pdf$/i.test(path.slice(prefix.length)) &&
    path.split('/').every(part => part && part !== '.' && part !== '..'));
}
export function isCatalog(value: unknown): value is Catalog {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.courses) || !Array.isArray(value.groups) || !Array.isArray(value.documents)) return false;
  const courses = value.courses, groups = value.groups, docs = value.documents;
  if (!courses.every(c => record(c) && strings(c, ['id', 'name', 'repo']) && c.semester === '2026-2')) return false;
  const courseIds = new Set(courses.map(c => c.id));
  if (courseIds.size !== courses.length) return false;
  if (!groups.every(g => record(g) && strings(g, ['id', 'courseId', 'title', 'sourcePath']) && (g.description === undefined || typeof g.description === 'string') && courseIds.has(g.courseId) && ['date', 'experiment', 'supplement'].includes(g.kind as string) && (g.date === null || typeof g.date === 'string') && typeof g.order === 'number' && Number.isFinite(g.order) && validPdfPaths(g.reviewPdfs, g.sourcePath as string) && validPdfPaths(g.answerPdfs, g.sourcePath as string))) return false;
  const groupIds = new Set(groups.map(g => g.id));
  if (groupIds.size !== groups.length) return false;
  const groupCourses = new Map(groups.map(g => [g.id, g.courseId]));
  return docs.every(d => record(d) && strings(d, ['id', 'courseId', 'title', 'sourcePath', 'url']) && courseIds.has(d.courseId) && (d.groupId === null || (groupIds.has(d.groupId) && groupCourses.get(d.groupId) === d.courseId)) && (materialTypes as readonly string[]).includes(d.type as string) && typeof d.listed === 'boolean' && documentUrl(d as DocumentInfo, 'https://catalog.invalid/') !== null) && new Set(docs.map(d => d.id)).size === docs.length;
}

export function catalogSlice(catalog: Catalog, id: string): Catalog {
  return {
    version: 1,
    courses: catalog.courses.filter(course => course.id === id),
    groups: catalog.groups.filter(group => group.courseId === id).map((group, order) => ({ ...group, order })),
    documents: catalog.documents.filter(document => document.courseId === id),
  };
}

export function mergeCatalogs(slices: Catalog[]): Catalog {
  return {
    version: 1,
    courses: slices.flatMap(slice => slice.courses),
    groups: slices.flatMap(slice => slice.groups).map((group, order) => ({ ...group, order })),
    documents: slices.flatMap(slice => slice.documents),
  };
}
