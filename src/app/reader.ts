import type { Catalog } from '../content/model.js';
import type { ReaderHostWindow, ReaderWindow } from '../compat/reader-bridge.js';
import { formatRoute, parseRoute } from './router.js';

export type ReaderEntry = { entryId: string; state: unknown };
export type ReaderChange = { state: unknown; previous?: { anchor?: string; search?: string; state: unknown } };
export type ReaderMode = 'push' | 'replace' | 'sync' | 'native-sync' | 'state-push' | 'state-replace';

export function mountReader(root: HTMLElement, catalog: Catalog,
  onNavigate: (documentId: string, anchor?: string, search?: string, mode?: ReaderMode, change?: ReaderChange) => void) {
  let frame: HTMLIFrameElement | undefined;
  let generation = 0;
  let pending: string | undefined;
  let requestedUrl: string | undefined;
  let expectedParent: { route: string; entryId: unknown; generation: number } | undefined;
  let nativeDestination: { url: string; generation: number; topRoute: string } | undefined;
  let active = true;
  let inFlight = false;
  let restorationTarget: (ReaderEntry & { url: string; generation: number }) | undefined;
  let restoring: (ReaderEntry & { url: string; cursor: string }) | undefined;
  let restoredEntry: string | undefined;
  let sourceInstance: string | undefined;
  let sourceSequence = 0;
  function observeInstance(child: ReaderWindow) {
    if (sourceInstance === child.__studyHubReaderInstance) return;
    sourceInstance = child.__studyHubReaderInstance;
    sourceSequence = 0;
    // Browser traversal can install another Document after an app replacement
    // already fulfilled this entry. Its startup still belongs to the same saved
    // restoration, not a new source navigation.
    if (restorationTarget?.generation === generation && parentIsCurrent() &&
        restorationTarget.entryId === expectedParent!.entryId &&
        find(new URL(child.location.href))?.id === find(new URL(restorationTarget.url))?.id) {
      restoring = {...restorationTarget,cursor:restorationTarget.url};
      pending = restorationTarget.url;
    }
  }
  let disposed = false;
  let approved: { instance: string; from: string; url: string; generation: number } | undefined;
  const status = document.createElement('p');
  status.hidden = true;
  root.append(status);
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
  const parentContext = () => ({route:formatRoute(parseRoute(location.hash)),entryId:history.state?.studyHub?.entryId,generation});
  function parentIsCurrent() {
    const current = parentContext();
    return expectedParent?.generation === current.generation && expectedParent.route === current.route && expectedParent.entryId === current.entryId;
  }
  function sourceRoute(url: URL) {
    const doc = find(url);
    return doc && formatRoute({kind:'read',documentId:doc.id,anchor:anchorOf(url),search:url.search || undefined});
  }
  function sourceIsCurrent(url: URL) {
    // The browser can commit another parent entry before our traversal handler
    // advances generation. Both route and entry identity must still match.
    return parentIsCurrent() && requestedUrl === url.href && expectedParent!.route === sourceRoute(url);
  }
  function rememberAcceptedParent(url: URL, token: number) {
    if (token !== generation || sourceRoute(url) !== parentContext().route) return;
    requestedUrl = url.href;
    expectedParent = parentContext();
  }
  const host = {
    canNavigate(source: Window, url: string) {
      return active && !disposed && source === frame?.contentWindow && !!find(new URL(url));
    },
    consume(source: Window, instance: string, from: string, url: string, navigationType: string) {
      if (!active || disposed || !parentIsCurrent() || source !== frame?.contentWindow || navigationType !== 'replace' ||
          !approved || approved.generation !== generation || approved.instance !== instance ||
          approved.from !== from || approved.url !== url) return false;
      approved = undefined;
      return true;
    },
    allowNative(source: Window, instance: string, from: string, url: string) {
      if (host.canNavigate(source, url) && instance === (source as ReaderWindow).__studyHubReaderInstance &&
          from === source.location.href && sourceIsCurrent(new URL(from)) && (!pending || pending === from)) {
        restorationTarget = undefined;
        nativeDestination = {url,generation,topRoute:location.hash};
      }
    },
  };
  (window as ReaderHostWindow).__studyHubReader = host;
  function error() {
    active = false;
    pending = undefined;
    approved = undefined;
    status.hidden = false;
    status.role = 'alert';
    status.textContent = '자료를 불러오지 못했습니다.';
    if (frame) frame.hidden = true;
  }
  function synchronize() {
    if (!frame || disposed || !active) return;
    try {
      let url = new URL(frame.contentWindow!.location.href);
      if (url.href === 'about:blank' || pending && url.href !== (restoring?.cursor ?? pending)) return;
      const doc = find(url);
      if (!doc || !frame.contentDocument?.querySelector('script[data-study-hub]')) { error(); return; }
      const child = frame.contentWindow as ReaderWindow;
      observeInstance(child);
      if ((child.__studyHubReaderHistory?.sequence ?? 0) > sourceSequence) return;
      if (restoring && !parentIsCurrent()) return;
      pending = undefined;
      inFlight = false;
      if (restoring && child.__studyHubReaderHistory) {
        const entry = restoring; restoring = undefined; restoredEntry = entry.entryId;
        child.__studyHubReaderHistory.restore(entry.url, entry.state);
        url = new URL(entry.url);
      }
      status.hidden = true;
      frame.hidden = false;
      frame.title = doc.title;
      const unowned = nativeDestination?.url === url.href && nativeDestination.generation === generation && nativeDestination.topRoute === location.hash ||
        !child.navigation && url.href !== requestedUrl;
      nativeDestination = undefined;
      const token = generation;
      onNavigate(doc.id, anchorOf(url), url.search || undefined, unowned ? 'native-sync' : 'sync', {state:child.history.state});
      rememberAcceptedParent(url, token);
    } catch { error(); }
  }
  function message(event: MessageEvent) {
    if (!frame || disposed || !active || event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.type !== 'study-hub:navigate' || typeof data.documentId !== 'string' || typeof data.url !== 'string') return;
    try {
      const current = new URL(frame.contentWindow!.location.href);
      const child = frame.contentWindow as ReaderWindow;
      observeInstance(child);
      if (find(current)?.id !== data.documentId || data.instance !== child.__studyHubReaderInstance ||
          typeof data.instance !== 'string') return;
      if (data.intent === 'history') {
        const url = new URL(data.url), previous = new URL(data.previousUrl);
        // Startup may advance the child URL while the parent restoration entry
        // must stay fixed. Validate that chain against its own cursor, retaining
        // the unchanged parent route/entry/generation guard for every message.
        const previousIsCurrent = restoring
          ? parentIsCurrent() && previous.href === restoring.cursor && expectedParent!.route === sourceRoute(new URL(restoring.url))
          : sourceIsCurrent(previous);
        // Source pushes execute synchronously: the child may already be at the
        // second hash when the first message arrives. Instance + ordered sequence
        // + same document identity validate each committed state without dropping it.
        if (data.sourceUrl !== url.href || find(url)?.id !== data.documentId || find(previous)?.id !== data.documentId ||
            !Number.isSafeInteger(data.sequence) || data.sequence !== sourceSequence + 1 ||
            data.sequence > (child.__studyHubReaderHistory?.sequence ?? 0) ||
            !['push','replace'].includes(data.history) || !previousIsCurrent ||
            pending && find(new URL(pending))?.id !== data.documentId) return;
        sourceSequence = data.sequence;
        if (restoring) {
          restoring.cursor = url.href;
          if (frame.contentDocument?.readyState === 'complete') synchronize();
          return;
        }
        restorationTarget = undefined;
        requestedUrl = url.href;
        if (pending) pending = url.href;
        const token = generation;
        onNavigate(data.documentId, anchorOf(url), url.search || undefined,
          data.history === 'push' ? 'state-push' : 'state-replace',
          {state:data.state,previous:{anchor:anchorOf(previous),search:previous.search || undefined,state:data.previousState}});
        rememberAcceptedParent(url, token);
        return;
      }
      if (data.sourceUrl !== current.href || pending && pending !== current.href) return;
      if (data.intent === 'sync') {
        if (data.url === current.href) synchronize();
      } else if (data.intent === 'navigate' && (data.history === undefined || data.history === 'push' || data.history === 'replace')) {
        if (!sourceIsCurrent(current)) return;
        const url = new URL(data.url);
        const doc = find(url);
        if (doc) onNavigate(doc.id, anchorOf(url), url.search || undefined, data.history ?? 'push');
      }
    } catch { /* Ignore malformed or inaccessible messages. */ }
  }
  function apply(url: URL) {
    const child = frame!.contentWindow as ReaderWindow;
    inFlight = true;
    try {
      approved = { instance: child.__studyHubReaderInstance ?? '', from: child.location.href, url: url.href, generation };
    } catch { approved = undefined; }
    child.location.replace(url.href);
  }
  function open(id: string, anchor?: string, search?: string, entry?: ReaderEntry) {
    active = true;
    const token = ++generation;
    expectedParent = parentContext();
    nativeDestination = undefined;
    approved = undefined;
    restorationTarget = undefined;
    restoring = undefined;
    const doc = catalog.documents.find(d => d.id === id);
    if (!doc) { error(); return; }
    const url = new URL(doc.url, location.origin);
    if (search) url.search = search;
    if (anchor) url.hash = anchor;
    requestedUrl = url.href;
    restorationTarget = entry ? {...entry,url:url.href,generation} : undefined;
    restoring = restorationTarget ? {...restorationTarget,cursor:url.href} : undefined;
    try {
      const current = frame && new URL(frame.contentWindow!.location.href);
      const child = frame?.contentWindow as ReaderWindow | undefined;
      if (child) { observeInstance(child); sourceSequence = child.__studyHubReaderHistory?.sequence ?? 0; }
      if (current?.href === url.href && inFlight && pending !== url.href) {
        pending = url.href;
        apply(url); // Supersede an older already-applied navigation, even before it commits.
        return;
      }
      if (current && current.pathname === url.pathname && current.search === url.search && !inFlight && entry && child?.__studyHubReaderHistory) {
        pending = undefined; restoring = undefined;
        if (restoredEntry !== entry.entryId || current.href !== url.href) {
          restoredEntry = entry.entryId;
          child.__studyHubReaderHistory.restore(url.href, entry.state);
        }
        status.hidden = true; frame!.hidden = false;
        return;
      }
      if (current?.href === url.href && !inFlight) {
        pending = undefined;
        synchronize();
        return;
      }
      if (current && current.pathname === url.pathname && current.search === url.search && !inFlight) {
        pending = url.href;
        apply(url);
        return;
      }
    } catch { /* A native fallback can temporarily leave the same origin. */ }
    pending = url.href;
    status.hidden = false;
    status.role = 'status';
    status.textContent = '자료를 불러오는 중입니다…';
    void fetch(url.href, { cache: 'no-store' }).then(async response => {
      const text = await response.text();
      if (token !== generation || disposed || !active) return;
      if (!response.ok || !text.includes('data-study-hub')) { error(); return; }
      if (!frame) {
        frame = document.createElement('iframe');
        frame.title = doc.title;
        frame.style.cssText = 'width:100%;min-height:75vh;border:0';
        frame.addEventListener('load', synchronize);
        inFlight = true;
        frame.src = url.href;
        root.append(frame);
      } else apply(url);
    }).catch(() => { if (token === generation && !disposed && active) error(); });
  }
  window.addEventListener('message', message);
  return {
    open,
    suspend() { active = false; ++generation; approved = undefined; restoring = undefined; },
    destroy() {
      disposed = true;
      ++generation;
      if ((window as ReaderHostWindow).__studyHubReader === host) delete (window as ReaderHostWindow).__studyHubReader;
      window.removeEventListener('message', message);
      frame?.remove();
      frame = undefined;
      root.replaceChildren();
    },
  };
}
