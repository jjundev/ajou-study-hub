import { mountCatalog } from './app/catalog-view.js';
import { documentUrl, parseRoute } from './app/router.js';
import { mountTheme } from './app/theme.js';
import { materialTypes, type Catalog, type DocumentInfo } from './content/model.js';

const root = document.querySelector<HTMLElement>('#app')!;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string');
function validPdfPaths(value: unknown, groupPath: string): boolean {
  if (value === undefined) return true;
  const prefix = groupPath + '/';
  return Array.isArray(value) && value.every(path => typeof path === 'string' &&
    path.startsWith(prefix) && /^(?:\.pack\/)?[^/\\\x00-\x1f]+\.pdf$/i.test(path.slice(prefix.length)) &&
    path.split('/').every(part => part && part !== '.' && part !== '..'));
}
function isCatalog(value: unknown): value is Catalog {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.courses) || !Array.isArray(value.groups) || !Array.isArray(value.documents)) return false;
  const courses = value.courses, groups = value.groups, docs = value.documents;
  if (!courses.every(c => record(c) && strings(c, ['id', 'name', 'repo']) && c.semester === '2026-2')) return false;
  const courseIds = new Set(courses.map(c => c.id));
  if (courseIds.size !== courses.length) return false;
  if (!groups.every(g => record(g) && strings(g, ['id', 'courseId', 'title', 'sourcePath']) && (g.description === undefined || typeof g.description === 'string') && courseIds.has(g.courseId) && ['date', 'experiment', 'supplement'].includes(g.kind as string) && (g.date === null || typeof g.date === 'string') && typeof g.order === 'number' && Number.isFinite(g.order) && validPdfPaths(g.reviewPdfs, g.sourcePath as string) && validPdfPaths(g.answerPdfs, g.sourcePath as string))) return false;
  const groupIds = new Set(groups.map(g => g.id));
  if (groupIds.size !== groups.length) return false;
  const groupCourses = new Map(groups.map(g => [g.id, g.courseId]));
  return docs.every(d => record(d) && strings(d, ['id', 'courseId', 'title', 'sourcePath', 'url']) && courseIds.has(d.courseId) && (d.groupId === null || (groupIds.has(d.groupId) && groupCourses.get(d.groupId) === d.courseId)) && (materialTypes as readonly string[]).includes(d.type as string) && typeof d.listed === 'boolean' && documentUrl(d as DocumentInfo, document.baseURI) !== null) && new Set(docs.map(d => d.id)).size === docs.length;
}

const error = root.querySelector<HTMLElement>('#catalog-error')!;
const errorHeading = root.querySelector<HTMLHeadingElement>('#catalog-error-heading')!;
const retry = root.querySelector<HTMLButtonElement>('#retry-catalog')!;
const status = root.querySelector<HTMLElement>('#catalog-status')!;

let catalog: Catalog | undefined;

function followRoute() {
  if (!catalog) return false;
  const route = parseRoute(location.hash);
  if (route.kind === 'read') {
    const doc = catalog.documents.find(d => d.id === route.documentId);
    const url = doc && documentUrl(doc, document.baseURI);
    if (url) {
      url.search = route.search ?? '';
      url.hash = route.anchor ?? '';
      location.replace(url.href);
      return true;
    }
  }
  errorHeading.textContent = '자료를 찾을 수 없습니다';
  retry.textContent = '목록으로 돌아가기';
  error.hidden = route.kind === 'catalog';
  return false;
}

async function load() {
  error.hidden = true;
  status.hidden = false;
  status.textContent = '자료 목록을 불러오는 중입니다…';

  const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#material-search, #type-filter, #sort-order');
  controls.forEach(control => { control.disabled = true; });
  try {
    const response = await fetch('/catalog.json', { cache: 'no-store' });
    if (!response.ok) throw Error('Catalog request failed');
    const value: unknown = await response.json();
    if (!isCatalog(value)) throw Error('Invalid catalog');
    catalog = value;
    if (followRoute()) return;
    controls.forEach(control => { control.disabled = false; });
    mountCatalog(root, catalog);
  } catch {
    catalog = undefined;
    errorHeading.textContent = '자료 목록을 불러오지 못했습니다';
    retry.textContent = '다시 시도';
    error.hidden = false;
  } finally {
    status.hidden = true;
  }
}

const fontLicense = document.createElement('link');
fontLicense.rel = 'license';
fontLicense.href = new URL('./app/fonts/OFL.txt', import.meta.url).href;
document.head.append(fontLicense);

mountTheme(root.querySelector<HTMLButtonElement>('#theme-toggle')!);
window.addEventListener('hashchange', followRoute);
retry.addEventListener('click', () => {
  if (catalog) location.hash = '#/catalog';
  else void load();
});
void load();
