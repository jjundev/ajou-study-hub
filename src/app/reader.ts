import type { Catalog } from '../content/model.js';

export function mountReader(root: HTMLElement, catalog: Catalog, onNavigate: (documentId: string, anchor?: string) => void) {
  let frame: HTMLIFrameElement | undefined;
  let selected: string | undefined;
  let generation = 0;
  const path = (url: URL) => {
    try { return decodeURIComponent(url.pathname); }
    catch { return url.pathname; }
  };
  const find = (url: URL) => url.origin === location.origin
    ? catalog.documents.find(d => path(new URL(d.url, location.origin)) === path(url)) : undefined;
  const anchorOf = (url: URL) => {
    try { return decodeURIComponent(url.hash.slice(1)) || undefined; }
    catch { return url.hash.slice(1) || undefined; }
  };
  function error() {
    frame?.remove();
    frame = undefined;
    const alert = document.createElement('p');
    alert.role = 'alert';
    alert.textContent = '자료를 불러오지 못했습니다.';
    root.replaceChildren(alert);
  }
  function synchronize() {
    if (!frame) return;
    try {
      const url = new URL(frame.contentWindow!.location.href);
      if (url.href === 'about:blank') return;
      const doc = find(url);
      if (!doc || !frame.contentDocument?.querySelector('script[data-study-hub]')) { error(); return; }
      selected = doc.id;
      frame.title = doc.title;
      onNavigate(doc.id, anchorOf(url));
    } catch { error(); }
  }
  function message(event: MessageEvent) {
    if (!frame || event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.type !== 'study-hub:navigate' || typeof data.documentId !== 'string' || typeof data.url !== 'string') return;
    try {
      // documentId identifies the sender; url is the proposed destination.
      const current = new URL(frame.contentWindow!.location.href);
      if (find(current)?.id !== data.documentId) return;
      const url = new URL(data.url);
      const doc = find(url);
      if (!doc) return;
      if (url.href === current.href) { selected = doc.id; frame.title = doc.title; }
      onNavigate(doc.id, anchorOf(url));
    } catch { /* Ignore malformed or inaccessible messages. */ }
  }
  window.addEventListener('message', message);
  return {
    open(id: string, anchor?: string) {
      const doc = catalog.documents.find(d => d.id === id);
      if (!doc) { ++generation; selected = undefined; error(); return; }
      const url = new URL(doc.url, location.origin);
      if (anchor) url.hash = anchor;
      if (frame && selected === id) {
        try {
          const current = new URL(frame.contentWindow!.location.href);
          if (find(current)?.id === id) {
            if (current.hash !== url.hash) {
              // Parent history owns bridge-click anchors. Avoid an extra iframe entry.
              frame.contentWindow!.history.replaceState(null, '', url.href);
              frame.contentDocument?.getElementById(anchor ?? '')?.scrollIntoView();
              if (!anchor) frame.contentWindow!.scrollTo(0, 0);
            }
            return;
          }
        } catch { /* Replace a frame whose current location is inaccessible. */ }
      }
      const token = ++generation;
      selected = id;
      frame?.remove();
      frame = undefined;
      const loading = document.createElement('p');
      loading.role = 'status';
      loading.textContent = '자료를 불러오는 중입니다…';
      root.replaceChildren(loading);
      const next = document.createElement('iframe');
      next.title = doc.title;
      next.style.cssText = 'width:100%;min-height:75vh;border:0';
      next.addEventListener('load', () => {
        if (token === generation && frame === next) synchronize();
      });
      // Verify status and the copied-document marker; Vite can return index.html for missing files.
      void fetch(url.href, { cache: 'no-store' }).then(async response => {
        if (token !== generation) return;
        if (!response.ok) { error(); return; }
        const text = await response.text();
        if (token !== generation) return;
        if (!text.includes('data-study-hub')) { error(); return; }
        frame = next;
        next.src = url.href;
        root.replaceChildren(next);
      }).catch(() => { if (token === generation) error(); });
    },
    destroy() {
      ++generation;
      window.removeEventListener('message', message);
      frame?.remove();
      frame = undefined;
      root.replaceChildren();
    },
  };
}
