import { mountCatalog } from './app/catalog-view.js';
import type { Catalog } from './content/model.js';

const root = document.querySelector<HTMLElement>('#app')!;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string');
function isCatalog(value: unknown): value is Catalog {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.courses) || !Array.isArray(value.groups) || !Array.isArray(value.documents)) return false;
  const courses = value.courses, groups = value.groups, docs = value.documents;
  if (!courses.every(c => record(c) && strings(c, ['id','name','repo']) && c.semester === '2026-2')) return false;
  const courseIds = new Set(courses.map(c => c.id));
  if (courseIds.size !== courses.length) return false;
  if (!groups.every(g => record(g) && strings(g, ['id','courseId','title','sourcePath']) && courseIds.has(g.courseId) && ['date','experiment','supplement'].includes(g.kind as string) && (g.date === null || typeof g.date === 'string') && typeof g.order === 'number' && Number.isFinite(g.order))) return false;
  const groupIds = new Set(groups.map(g => g.id));
  if (groupIds.size !== groups.length) return false;
  const groupCourses = new Map(groups.map(g => [g.id, g.courseId]));
  return docs.every(d => record(d) && strings(d, ['id','courseId','title','sourcePath','url']) && courseIds.has(d.courseId) && (d.groupId === null || (groupIds.has(d.groupId) && groupCourses.get(d.groupId) === d.courseId)) && ['note','review','explanation','interactive','other'].includes(d.type as string) && typeof d.listed === 'boolean' && (d.url as string).startsWith('/content/')) && new Set(docs.map(d => d.id)).size === docs.length;
}
async function load() {
  root.replaceChildren();
  const loading = document.createElement('p'); loading.className = 'load-state'; loading.role = 'status'; loading.textContent = '자료 목록을 불러오는 중입니다…'; root.append(loading);
  try {
    const response = await fetch('/catalog.json', { cache: 'no-store' });
    if (!response.ok) throw Error('Catalog request failed');
    const catalog: unknown = await response.json();
    if (!isCatalog(catalog)) throw Error('Invalid catalog');
    mountCatalog(root, catalog, () => {});
  } catch {
    const message = document.createElement('div'); message.className = 'load-state'; message.role = 'alert';
    const title = document.createElement('h1'); title.textContent = '자료 목록을 불러오지 못했습니다';
    const hint = document.createElement('p'); hint.textContent = '연결 상태를 확인하고 다시 시도해 주세요.';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '다시 시도'; retry.addEventListener('click', load);
    message.append(title, hint, retry); root.replaceChildren(message);
  }
}
void load();
