import type { Catalog, DocumentInfo, MaterialType } from '../content/model.js';

export type BrowseState = { courseId?: string; groupId?: string; query?: string };
const labels: Record<MaterialType, string> = { note: '정리노트', review: '복습문제', explanation: '문제설명', interactive: '인터랙티브', other: '기타 자료' };
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text: string, action: () => void, className?: string) {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
export function mountCatalog(root: HTMLElement, catalog: Catalog, onSelect: (documentId: string) => void, onBrowse?: (state: BrowseState) => void) {
  let state: BrowseState = {};
  let selected: string | null = null;
  let expanded = true;
  const listed = catalog.documents.filter(d => d.listed);
  const shell = element('div', undefined, 'workspace');
  const header = element('header', undefined, 'app-header');
  const brand = element('div');
  brand.append(element('h1', '아주 학습 자료실'), element('p', '2026학년도 2학기 · 기기 내 학습 기록'));
  header.append(brand, element('span', `자료 ${listed.length}개`, 'total-count'));
  const layout = element('div', undefined, 'workspace-layout');
  const sidebar = element('aside', undefined, 'catalog-panel');
  const toggle = button('자료 목록 접기', () => { expanded = !expanded; updateExpanded(); }, 'list-toggle');
  toggle.setAttribute('aria-controls', 'catalog-body');
  const body = element('div'); body.id = 'catalog-body';
  const searchLabel = element('label', '자료 검색'); searchLabel.htmlFor = 'catalog-search';
  const search = element('input'); search.id = 'catalog-search'; search.type = 'search'; search.placeholder = '과목, 묶음, 제목, 날짜';
  const hint = element('p', '자료의 제목과 날짜에서 검색합니다.', 'search-hint');
  const clear = button('검색어 지우기', () => { search.value = ''; update({ ...state, query: '' }); search.focus(); }, 'clear-search');
  const nav = element('nav'); nav.setAttribute('aria-label', '과목 선택');
  const groups = element('div', undefined, 'material-groups');
  const results = element('p', undefined, 'result-count'); results.setAttribute('role', 'status');
  const reader = element('main', undefined, 'reader-panel'); reader.id = 'reader'; reader.tabIndex = -1;
  body.append(searchLabel, search, hint, clear, element('h2', '과목', 'section-label'), nav, results, groups);
  sidebar.append(toggle, body); layout.append(sidebar, reader); shell.append(header, layout); root.replaceChildren(shell);
  search.addEventListener('input', () => update({ ...state, query: search.value }));
  function updateExpanded() {
    toggle.textContent = expanded ? '자료 목록 접기' : '자료 목록 열기';
    toggle.setAttribute('aria-expanded', String(expanded));
    sidebar.dataset.expanded = String(expanded);
  }
  function update(next: BrowseState) { state = { ...next }; render(); onBrowse?.({ ...state }); }
  function select(doc: DocumentInfo) {
    selected = doc.id;
    if (matchMedia('(max-width: 767px)').matches) { expanded = false; updateExpanded(); }
    renderSelection(); renderGroups(); onSelect(doc.id);
    reader.focus();
  }
  function filtered() {
    const query = (state.query ?? '').normalize('NFC').trim().toLocaleLowerCase();
    return listed.filter(doc => {
      const group = catalog.groups.find(g => g.id === doc.groupId);
      const course = catalog.courses.find(c => c.id === doc.courseId);
      return (!state.courseId || doc.courseId === state.courseId) && (!state.groupId || doc.groupId === state.groupId) &&
        [doc.title, course?.name, group?.title, group?.date].join(' ').normalize('NFC').toLocaleLowerCase().includes(query);
    });
  }
  function renderGroups() {
    groups.replaceChildren();
    const docs = filtered();
    results.textContent = `목록 ${docs.length}개`;
    if (!docs.length) {
      groups.append(element('h2', state.query ? '검색 결과가 없습니다' : '등록된 자료가 없습니다'), element('p', '다른 과목을 선택하거나 검색어를 지워 보세요.', 'empty-hint'));
      return;
    }
    for (const course of catalog.courses) {
      const courseDocs = docs.filter(d => d.courseId === course.id);
      if (!courseDocs.length) continue;
      if (!state.courseId) groups.append(element('h2', course.name, 'course-heading'));
      const groupIds = [...catalog.groups.filter(g => g.courseId === course.id).sort((a,b) => a.order - b.order).map(g => g.id), null];
      for (const groupId of groupIds) {
        const entries = courseDocs.filter(d => d.groupId === groupId);
        if (!entries.length) continue;
        const group = catalog.groups.find(g => g.id === groupId);
        const section = element('section', undefined, 'material-group');
        const heading = element('div', undefined, 'group-heading');
        const title = element('h3');
        if (group) {
          const groupButton = button(group.title, () => update({ ...state, courseId: course.id, groupId: state.groupId === group.id ? undefined : group.id }), 'group-button');
          groupButton.setAttribute('aria-pressed', String(state.groupId === group.id));
          title.append(groupButton);
        } else title.textContent = '추가 자료';
        heading.append(title, element('span', `${entries.length}개`));
        if (group?.date) heading.append(element('time', group.date));
        section.append(heading);
        for (const doc of entries) {
          const item = button('', () => select(doc), 'material-button');
          item.dataset.materialType = doc.type;
          item.setAttribute('aria-pressed', String(selected === doc.id));
          item.append(element('span', labels[doc.type], 'material-type'), element('span', doc.title, 'material-title'));
          section.append(item);
        }
        groups.append(section);
      }
    }
  }
  function renderSelection() {
    const doc = catalog.documents.find(d => d.id === selected);
    reader.replaceChildren();
    if (doc) {
      reader.append(element('p', catalog.courses.find(c => c.id === doc.courseId)?.name ?? '', 'reader-course'), element('h2', doc.title), element('p', '자료를 선택했습니다. 본문 보기는 다음 단계에서 연결됩니다.', 'reader-message'));
    } else {
      const introduction = element('div', undefined, 'reader-introduction');
      introduction.append(element('h2', '오늘 공부할 자료를 선택하세요'), element('p', '과목과 학습 묶음별로 정리된 자료를 한곳에서 찾아보세요. 제목이나 날짜를 검색해 바로 찾을 수 있습니다.'), element('p', '학습 기록은 현재 브라우저에 저장됩니다.', 'storage-note'));
      reader.append(introduction);
    }
  }
  function render() {
    search.value = state.query ?? ''; clear.hidden = !state.query;
    nav.replaceChildren();
    const all = button(`전체 과목 ${listed.length}`, () => update({ query: state.query }), 'course-button');
    all.setAttribute('aria-pressed', String(!state.courseId)); nav.append(all);
    for (const course of catalog.courses) {
      const count = listed.filter(d => d.courseId === course.id).length;
      const item = button(`${course.name} ${count}`, () => update({ courseId: course.id, query: state.query }), 'course-button');
      item.setAttribute('aria-pressed', String(state.courseId === course.id)); nav.append(item);
    }
    renderGroups();
  }
  updateExpanded(); render(); renderSelection();
  return {
    setSelection(id: string | null, preserveReader = false) {
      selected = id;
      if (preserveReader) {
        const doc = catalog.documents.find(d => d.id === id);
        const heading = reader.querySelector('h2');
        if (heading && doc) heading.textContent = doc.title;
        const course = reader.querySelector('.reader-course');
        if (course && doc) course.textContent = catalog.courses.find(c => c.id === doc.courseId)?.name ?? '';
      } else renderSelection();
      renderGroups();
    },
    setBrowseState(next: BrowseState) { state = { ...next }; render(); },
    destroy() { shell.remove(); },
  };
}
