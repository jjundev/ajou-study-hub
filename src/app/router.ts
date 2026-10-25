export type Route =
  | { kind: 'catalog'; courseId?: string; groupId?: string; query?: string }
  | { kind: 'read'; documentId: string; anchor?: string; search?: string }
  | { kind: 'invalid' };

export function parseRoute(hash: string): Route {
  try {
    const [path, search = ''] = (hash.replace(/^#/, '') || '/catalog').split('?');
    const params = new URLSearchParams(search);
    if (path === '/catalog') return {
      kind: 'catalog', courseId: params.get('course') || undefined,
      groupId: params.get('group') || undefined, query: params.get('q') || undefined,
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
  } else {
    if (route.anchor) params.set('anchor', route.anchor);
    // Keep document URL.search opaque, including duplicates and original escapes.
    if (route.search) params.set('search', route.search);
  }
  const query = params.toString();
  const path = route.kind === 'read' ? 'read/' + encodeURIComponent(route.documentId) : 'catalog';
  return `#/${path}${query ? '?' + query : ''}`;
}
