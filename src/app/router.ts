import { materialTypes, type DocumentInfo, type MaterialType } from '../content/model.js';

export type CatalogRoute = {
  kind: 'catalog';
  courseId?: string;
  groupId?: string;
  query?: string;
  type?: MaterialType;
  sort?: 'oldest';
};

export type Route =
  | CatalogRoute
  | { kind: 'read'; documentId: string; anchor?: string; search?: string }
  | { kind: 'invalid' };

export function parseRoute(hash: string): Route {
  try {
    const [path, search = ''] = (hash.replace(/^#/, '') || '/catalog').split('?');
    const params = new URLSearchParams(search);
    const type = params.get('type') as MaterialType;
    if (path === '/catalog' || path === 'materials') return {
      kind: 'catalog', courseId: params.get('course') || undefined,
      groupId: params.get('group') || undefined, query: params.get('q') || undefined,
      type: materialTypes.includes(type) ? type : undefined,
      sort: params.get('sort') === 'oldest' ? 'oldest' : undefined,
    };
    const match = /^\/read\/([^/]+)$/.exec(path!);
    if (match) {
      const id = decodeURIComponent(match[1]!);
      if (!/^[\w-]+$/.test(id)) return { kind: 'invalid' };
      return { kind: 'read', documentId: id, anchor: params.get('anchor') || undefined, search: params.get('search') || undefined };
    }
  } catch { /* Invalid percent escapes are invalid routes. */ }
  return { kind: 'invalid' };
}

export function formatRoute(route: Route): string {
  if (route.kind === 'invalid') return '#/invalid';
  const params = new URLSearchParams();
  if (route.kind === 'catalog') {
    if (route.courseId) params.set('course', route.courseId);
    if (route.groupId) params.set('group', route.groupId);
    if (route.query) params.set('q', route.query);
    if (route.type) params.set('type', route.type);
    if (route.sort) params.set('sort', route.sort);
  } else {
    if (route.anchor) params.set('anchor', route.anchor);
    // Keep document URL.search opaque, including duplicates and original escapes.
    if (route.search) params.set('search', route.search);
  }
  const query = params.toString();
  const path = route.kind === 'read' ? 'read/' + encodeURIComponent(route.documentId) : 'catalog';
  return `#/${path}${query ? '?' + query : ''}`;
}


export function documentUrl(doc: DocumentInfo, base: string): URL | null {
  if (!doc.url.startsWith('/content/')) return null;
  const url = URL.parse(doc.url, base);
  return url && url.origin === new URL(base).origin &&
    url.pathname === doc.url && /\.html?$/i.test(url.pathname) &&
    !url.search && !url.hash ? url : null;
}
