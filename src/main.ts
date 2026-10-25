import { mountCatalog } from './app/catalog-view.js';
import { mountReader, type ReaderMode, type ReaderChange } from './app/reader.js';
import {parseRoute,formatRoute,type Route} from './app/router.js';
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
    const value: unknown = await response.json();
    if (!isCatalog(value)) throw Error('Invalid catalog');
    loading.remove();
    const catalog = value;
    const view = mountCatalog(root, catalog, id => navigate({kind:'read',documentId:id}),
      state => navigate({kind:'catalog',...state}));
    const panel = root.querySelector<HTMLElement>('#reader')!;
    const host = document.createElement('div');
    const back = document.createElement('a'); back.href = '#/catalog'; back.textContent = '목록으로';
    back.addEventListener('click', event => { event.preventDefault(); navigate({kind:'catalog'}); });
    const standalone = document.createElement('a'); standalone.textContent = '새 탭에서 열기'; standalone.target = '_blank'; standalone.rel = 'noopener';
    const actions = document.createElement('div'); actions.className = 'reader-actions'; actions.append(back, standalone);
    const holder = document.createElement('div'); host.append(actions, holder); panel.append(host);
    const reader = mountReader(holder, catalog, (documentId, anchor, search, mode, change) =>
      navigate({kind:'read',documentId,anchor,search}, mode, change));
    const entryId = () => history.state?.studyHub?.entryId ?? crypto.randomUUID();
    function navigate(route: Route, mode: ReaderMode = 'push', change?: ReaderChange) {
      // Traversal commits location before popstate/hashchange rendering. A late
      // child sync must not replace that already-committed parent destination.
      if (mode === 'sync' && formatRoute(parseRoute(location.hash)) !== formatRoute(route)) { renderRoute(); return; }
      const applied = mode === 'sync' || mode === 'native-sync' || mode.startsWith('state-');
      if (mode.startsWith('state-') && route.kind === 'read' && change?.previous &&
          formatRoute(parseRoute(location.hash)) !== formatRoute({kind:'read',documentId:route.documentId,
            anchor:change.previous.anchor,search:change.previous.search})) return;
      if (mode === 'state-push' && route.kind === 'read' && change?.previous) {
        const previous = change.previous;
        history.replaceState({studyHub:{entryId:entryId(),documentId:route.documentId,state:previous.state}}, '',
          formatRoute({kind:'read',documentId:route.documentId,anchor:previous.anchor,search:previous.search}));
      }
      const hash = formatRoute(route);
      const push = mode === 'state-push' || mode === 'push' && location.hash !== hash;
      const state = {studyHub:{entryId:push ? crypto.randomUUID() : entryId(),
        ...(applied && route.kind === 'read' ? {documentId:route.documentId,state:change?.state} : {})}};
      if (applied || push || mode === 'replace') history[push ? 'pushState' : 'replaceState'](state, '', hash);
      if (applied) display(route);
      else renderRoute();
    }
    function display(route: Route) {
      host.hidden = route.kind === 'catalog';
      standalone.hidden = true; standalone.removeAttribute('href');
      if (route.kind === 'catalog') {
        view.setBrowseState(route); view.setSelection(null); document.title = '아주 학습 자료실';
        return;
      }
      const id = route.kind === 'read' ? route.documentId : '';
      view.setSelection(id, false, history.state?.studyHub?.entryId ?? formatRoute(route));
      const doc = catalog.documents.find(d => d.id === id);
      if (doc && route.kind === 'read') {
        const url = new URL(doc.url, location.origin);
        // Match the reader URL construction without parsing or normalizing its opaque query.
        url.search = route.search ?? ''; url.hash = route.anchor ?? '';
        if (url.origin === location.origin && url.pathname.startsWith('/content/')) {
          standalone.href = url.pathname + url.search + url.hash; standalone.hidden = false;
        }
      }
      document.title = doc ? doc.title + ' · 아주 학습 자료실' : '자료 오류 · 아주 학습 자료실';
    }
    function renderRoute() {
      const route = parseRoute(location.hash);
      display(route);
      if (route.kind === 'catalog') { reader.suspend(); return; }
      const id = route.kind === 'read' ? route.documentId : '';
      const entry = history.state?.studyHub;
      reader.open(id, route.kind === 'read' ? route.anchor : undefined, route.kind === 'read' ? route.search : undefined,
        entry?.documentId === id ? {entryId:entry.entryId,state:entry.state} : undefined);
    }
    window.addEventListener('hashchange', renderRoute);
    window.addEventListener('popstate', renderRoute);
    renderRoute();
  } catch {
    const message = document.createElement('div'); message.className = 'load-state'; message.role = 'alert';
    const title = document.createElement('h1'); title.textContent = '자료 목록을 불러오지 못했습니다';
    const hint = document.createElement('p'); hint.textContent = '연결 상태를 확인하고 다시 시도해 주세요.';
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '다시 시도'; retry.addEventListener('click', load);
    message.append(title, hint, retry); loading.remove(); root.append(message);
  }
}
void load();
