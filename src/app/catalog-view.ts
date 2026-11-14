import { contentUrl, type Catalog, type Course, type DocumentInfo, type Group, type MaterialType } from '../content/model.js';
import { formatRoute, parseRoute, type CatalogRoute } from './router.js';
import lessonCopy from './lesson-copy.json' with { type: 'json' };

const labels: Record<MaterialType, string> = {
  note: '정리노트', review: '복습문제', check: '확인문제', explanation: '문제설명',
  interactive: '인터랙티브', comic: '학습만화', other: '기타 자료',
};
const courseOrder = ['life-science', 'circuits-2', 'data-structures', 'ml-basics', 'logic-lab'];
const curated: Record<string, { title: string; description?: string }> = lessonCopy;
const pageSize = 4;
const recentKey = 'study-hub:recent:v1';
const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase('ko-KR');

type Lesson = {
  group: Group;
  course: Course;
  title: string;
  description?: string;
  documents: DocumentInfo[];
  reviewPdfs: string[];
};
type BrowsePosition = { hash: string; limit: number; top: number; courseLeft: number };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function makeLessons(catalog: Catalog, courses: Map<string, Course>): Lesson[] {
  const groups = new Map(catalog.groups.map(group => [group.id, group]));
  const lessons = new Map<string, Lesson>();
  function getLesson(group: Group) {
    let lesson = lessons.get(group.id);
    if (!lesson) {
      const folder = group.sourcePath.split('/').at(-1);
      const copy = curated[group.courseId + '/' + folder];
      lesson = {
        group, course: courses.get(group.courseId)!, title: copy?.title ?? group.title,
        description: copy?.description ?? group.description, documents: [], reviewPdfs: group.reviewPdfs ?? [],
      };
      lessons.set(group.id, lesson);
    }
    return lesson;
  }
  for (const doc of catalog.documents) {
    if (!doc.listed) continue;
    const group = (doc.groupId && groups.get(doc.groupId)) || {
      id: doc.courseId + ':extra', courseId: doc.courseId, kind: 'supplement',
      title: '추가 자료', date: null, sourcePath: '', order: Number.MAX_SAFE_INTEGER,
    } satisfies Group;
    getLesson(group).documents.push(doc);
  }
  for (const group of catalog.groups) if (group.reviewPdfs?.length) getLesson(group);
  return [...lessons.values()];
}

function readRecent(docs: Map<string, DocumentInfo>): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]');
    if (Array.isArray(value)) return value.filter(id => typeof id === 'string' && docs.has(id)).slice(0, 8);
  } catch { /* Ignore malformed or unavailable storage. */ }
  return [];
}

export function mountCatalog(root: HTMLElement, catalog: Catalog) {
  const get = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const courses = new Map(catalog.courses.map(course => [course.id, course]));
  const orderedCourses = [...courseOrder, ...courses.keys()].filter((id, index, all) => courses.has(id) && all.indexOf(id) === index);
  const lessons = makeLessons(catalog, courses);
  const docs = new Map(lessons.flatMap(lesson => lesson.documents.map(doc => [doc.id, doc])));
  const lessonByDocument = new Map(lessons.flatMap(lesson => lesson.documents.map(doc => [doc.id, lesson])));
  const nav = get('course-filters');
  const list = get('material-list');
  const section = get('materials');
  const search = get<HTMLInputElement>('material-search');
  const type = get<HTMLSelectElement>('type-filter');
  const sort = get<HTMLSelectElement>('sort-order');
  const loadMore = get<HTMLButtonElement>('load-more');
  const readRoute = (): CatalogRoute => {
    const route = parseRoute(location.hash);
    if (route.kind !== 'catalog') return { kind: 'catalog' };
    const courseId = route.courseId && courses.has(route.courseId) ? route.courseId : undefined;
    const group = catalog.groups.find(item => item.id === route.groupId &&
      (!courseId || item.courseId === courseId));
    return {
      ...route,
      courseId,
      groupId: group?.id,
      query: route.query?.slice(0, 160),
    };
  };
  let state = readRoute();
  let limit = pageSize;
  let composing = false;
  let recent = readRecent(docs);

  function remember() {
    const hash = location.hash;
    const position: BrowsePosition = { hash, limit, top: window.scrollY, courseLeft: nav.scrollLeft };
    if (parseRoute(hash).kind === 'catalog') {
      history.replaceState({ browse: position }, '', location.href);
    }
  }

  function restore() {
    const position = history.state?.browse as BrowsePosition | undefined;
    const saved = position?.hash === location.hash ? position : undefined;
    limit = saved ? saved.limit : pageSize;
    recent = readRecent(docs);
    render();
    if (saved) {
      // Layout must exist before restoring the previous viewport.
      requestAnimationFrame(() => {
        nav.scrollLeft = saved.courseLeft;
        window.scrollTo(0, saved.top);
      });
    } else if (state.courseId) {
      nav.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function update(changes: Partial<CatalogRoute>) {
    state = { ...state, ...changes };
    limit = pageSize;
    history.replaceState(null, '', formatRoute(state));
    render();
  }

  function materialLink(doc: DocumentInfo, isRecent = false, detailed = false) {
    const { course, title } = lessonByDocument.get(doc.id)!;
    const link = element('a', undefined, isRecent ? 'recent-link' : 'material-link');
    const typeLabel = labels[doc.type];
    const label = detailed || doc.type === 'interactive' || doc.type === 'other' ? typeLabel + ' · ' + doc.title : typeLabel;
    link.setAttribute('href', doc.url);
    link.dataset.document = doc.id;
    link.dataset.materialType = doc.type;
    link.setAttribute('aria-label', [course.name, title, doc.title, typeLabel, '열기'].join(' · '));
    link.append(element('span', isRecent ? [course.name, title, label].join(' · ') : label));
    link.insertAdjacentHTML('beforeend', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>');
    return link;
  }

  function lessonRow(lesson: Lesson) {
    const { course, group, title, description, documents, reviewPdfs } = lesson;
    const row = element('article', undefined, 'log-row');
    const meta = element('div', undefined, 'group-meta');
    meta.append(element('span', course.name, 'course-label'));
    if (group.date) {
      const date = element('time', group.date.slice(5).replace('-', '.') + ' 수업', 'group-date num');
      date.dateTime = group.date;
      meta.append(date);
    } else if (group.kind === 'experiment' && title !== group.title) {
      meta.append(element('span', group.title.replace(/^실험(?=\d)/, '실험 '), 'group-date'));
    }
    const body = element('div', undefined, 'group-body');
    body.append(element('h3', title));
    if (description) body.append(element('p', description, 'group-description'));
    const links = element('div', undefined, 'material-links');
    const counts = new Map<MaterialType, number>();
    for (const doc of documents) counts.set(doc.type, (counts.get(doc.type) ?? 0) + 1);
    const types: MaterialType[] = ['note', 'review', 'check', 'explanation', 'interactive', 'comic', 'other'];
    for (const type of types) {
      for (const doc of documents.filter(item => item.type === type)) {
        links.append(materialLink(doc, false, counts.get(type)! > 1));
      }
      if (type !== 'review') continue;
      for (const path of reviewPdfs) {
        const filename = path.split('/').at(-1)!.normalize('NFC');
        const label = '복습문제 PDF';
        const text = reviewPdfs.length > 1 ? `${label} · ${filename.replace(/(?:-문제)?\.pdf$/i, '')}` : label;
        const link = element('a', undefined, 'material-link');
        link.href = contentUrl(course.id, path);
        link.download = filename;
        link.setAttribute('aria-label', [course.name, title, filename, `${label} 다운로드`].join(' · '));
        link.append(element('span', text));
        link.insertAdjacentHTML('beforeend', '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/></svg>');
        links.append(link);
      }
    }
    body.append(links);
    row.append(meta, body);
    return row;
  }

  function render() {
    const query = state.query ?? '';
    const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
    const course = state.courseId ? courses.get(state.courseId) : undefined;
    if (search.value !== query) search.value = query;
    get('clear-search').hidden = !query;
    get('search-shortcut').hidden = !!query;
    type.value = state.type ?? 'all';
    sort.value = state.sort ?? 'recent';
    for (const button of nav.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.course === (state.courseId ?? '')));
    }

    const result = lessons.flatMap(lesson => {
      const { group, course, title, description } = lesson;
      if ((state.courseId && state.courseId !== course.id) || (state.groupId && state.groupId !== group.id)) return [];
      const matches = (type: MaterialType, name: string, path: string) => {
        if (state.type && type !== state.type) return false;
        if (!tokens.length) return true;
        const haystack = normalize([course.name, title, description, group.title, group.date, name, path, labels[type]].join(' '));
        return tokens.every(token => haystack.includes(token));
      };
      const documents = lesson.documents.filter(doc => matches(doc.type, doc.title, doc.sourcePath));
      const reviewPdfs = lesson.reviewPdfs.filter(path => matches('review', '복습문제 PDF', path));
      return documents.length || reviewPdfs.length ? [{ ...lesson, documents, reviewPdfs }] : [];
    });
    const direction = state.sort === 'oldest' ? 1 : -1;
    const rank = { date: 0, experiment: 1, supplement: 2 };
    result.sort((a, b) => rank[a.group.kind] - rank[b.group.kind] ||
      direction * ((a.group.date ?? '').localeCompare(b.group.date ?? '') ||
        (a.group.kind === 'experiment' ? a.group.title.localeCompare(b.group.title, 'ko', { numeric: true }) : 0)) ||
      orderedCourses.indexOf(a.course.id) - orderedCourses.indexOf(b.course.id) || a.group.order - b.group.order);

    const announcement = get('results-announcement');
    announcement.textContent = query ? `검색 결과 ${result.length}개 수업을 찾았습니다.` : `${result.length}개 수업의 자료를 표시합니다.`;
    get('list-heading').textContent = query ? '검색 결과' : course?.name ?? '모든 수업';
    const repository = get('course-repository');
    repository.textContent = course?.repo.split('/').at(-1) ?? '';
    repository.hidden = !course || !!query;
    list.replaceChildren(...result.slice(0, limit).map(lessonRow));
    get('empty-state').hidden = result.length > 0;
    if (!lessons.length) {
      get('empty-heading').textContent = '아직 등록된 자료가 없어요';
      get('empty-description').textContent = '자료가 추가되면 이곳에서 확인할 수 있어요.';
      get('reset-filters').hidden = true;
    }
    get('list-bottom').hidden = limit >= result.length;
    const lastDoc = docs.get(recent[0] ?? '');
    const showRecent = lastDoc && !query && !state.courseId && !state.groupId && !state.type;
    get('recent-region').hidden = !showRecent;
    get('recent-link').replaceChildren(...(showRecent ? [materialLink(lastDoc, true)] : []));
  }

  const courseButtons = ['', ...orderedCourses].map(id => {
    const button = element('button', courses.get(id)?.name ?? '전체', 'course-button');
    button.type = 'button';
    button.dataset.course = id;
    button.addEventListener('click', () => update({ courseId: id || undefined, groupId: undefined }));
    return button;
  });
  nav.replaceChildren(...courseButtons);
  get('skip-to-materials').addEventListener('click', event => {
    event.preventDefault();
    section.focus({ preventScroll: true });
    section.scrollIntoView();
  });
  const searchChanged = () => {
    if (search.value !== (state.query ?? '')) update({ query: search.value || undefined });
  };
  search.addEventListener('compositionstart', () => { composing = true; });
  search.addEventListener('compositionend', () => { composing = false; searchChanged(); });
  search.addEventListener('input', event => { if (!composing && !(event as InputEvent).isComposing) searchChanged(); });
  get('search-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!composing) {
      searchChanged();
      section.focus({ preventScroll: true });
    }
  });
  get('clear-search').addEventListener('click', () => { update({ query: undefined }); search.focus(); });
  type.addEventListener('change', () => update({ type: type.value === 'all' ? undefined : type.value as MaterialType }));
  sort.addEventListener('change', () => update({ sort: sort.value === 'oldest' ? 'oldest' : undefined }));
  get('brand-home').addEventListener('click', event => {
    event.preventDefault();
    update({ courseId: undefined, groupId: undefined, query: undefined, sort: undefined, type: undefined });
    window.scrollTo(0, 0);
    nav.scrollLeft = 0;
  });
  get('reset-filters').addEventListener('click', () => {
    update({ courseId: undefined, groupId: undefined, query: undefined, type: undefined });
    search.focus({ preventScroll: true });
  });
  loadMore.addEventListener('click', () => {
    const firstNew = limit;
    limit += pageSize;
    render();
    list.children[firstNew]?.querySelector('a')?.focus();
  });
  root.addEventListener('click', event => {
    if (!(event.target instanceof Element) || event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest<HTMLAnchorElement>('a[data-document]');
    if (!link) return;
    remember();
    const id = link.dataset.document!;
    recent = [id, ...recent.filter(item => item !== id)].slice(0, 8);
    try { localStorage.setItem(recentKey, JSON.stringify(recent)); } catch { /* Retain the current visit's choice. */ }
  });
  root.addEventListener('keydown', event => {
    if (event.isComposing || composing) return;
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]'))) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === 'Escape' && event.target === search && state.query) {
      event.preventDefault();
      update({ query: undefined });
    }
  });
  window.addEventListener('hashchange', () => { state = readRoute(); restore(); });
  window.addEventListener('pageshow', event => { if (event.persisted) restore(); });
  window.addEventListener('pagehide', remember);
  restore();
}
