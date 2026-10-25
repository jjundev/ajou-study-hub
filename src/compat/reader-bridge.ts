export type ReaderWindow = Window & { __studyHubReaderInstance?: string; __studyHubReaderHistory?: {
  sequence: number;
  restore(url: string, state: unknown): void;
} };
export type ReaderHostWindow = Window & { __studyHubReader?: {
  canNavigate(source: Window, url: string): boolean;
  consume(source: Window, instance: string, from: string, url: string, navigationType: string): boolean;
  allowNative(source: Window, instance: string, from: string, url: string): void;
} };

/** Runs before original scripts in trusted copied documents. */
export function installReaderBridge(documentId: string): void {
  if (window.parent === window) return;
  const instance = crypto.randomUUID();
  (window as ReaderWindow).__studyHubReaderInstance = instance;
  const notify = (url: string, intent: 'navigate' | 'sync', history: 'push' | 'replace' = 'push') => parent.postMessage({
    type: 'study-hub:navigate', documentId, url, sourceUrl: location.href, instance, intent, history, state: window.history.state,
  }, location.origin);
  const nativePush = history.pushState;
  const nativeReplace = history.replaceState;
  const sourceHistory = {
    sequence: 0,
    restore(url: string, state: unknown) {
      const oldURL = location.href;
      nativeReplace.call(history, state, '', url);
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      if (new URL(oldURL).hash !== location.hash) dispatchEvent(new HashChangeEvent('hashchange', {oldURL,newURL:location.href}));
    },
  };
  (window as ReaderWindow).__studyHubReaderHistory = sourceHistory;
  for (const mode of ['push', 'replace'] as const) {
    const original = mode === 'push' ? nativePush : nativeReplace;
    history[mode === 'push' ? 'pushState' : 'replaceState'] = function (state, unused, url) {
      let destination: URL;
      try { destination = new URL(url == null ? location.href : String(url), location.href); }
      catch { return original.call(this, state, unused, url); }
      const host = (parent as ReaderHostWindow).__studyHubReader;
      if (this !== history || destination.pathname !== location.pathname || !host?.canNavigate(window, destination.href)) {
        return original.call(this, state, unused, url);
      }
      const previousUrl = location.href;
      const previousState = history.state;
      // Preserve native synchronous URL/state/serialization behavior, but let
      // the parent own the new entry. No source state is written into the URL.
      nativeReplace.call(this, state, unused, url);
      parent.postMessage({type:'study-hub:navigate',documentId,url:location.href,sourceUrl:location.href,
        instance,intent:'history',history:mode,sequence:++sourceHistory.sequence,
        state:history.state,previousUrl,previousState},location.origin);
    };
  }
  // Cancel before a native script creates a child-only history entry. The
  // parent records the route, then authorizes exactly one real replacement.
  // Older browsers retain ordinary bridge clicks and native URL synchronization.
  window.navigation?.addEventListener('navigate', event => {
    const host = (parent as ReaderHostWindow).__studyHubReader;
    if (host?.consume(window, instance, location.href, event.destination.url, event.navigationType)) return;
    if (event.navigationType === 'traverse' || event.navigationType === 'reload' ||
        event.destination.sameDocument && !event.hashChange) return;
    const url = new URL(event.destination.url);
    if (url.origin !== location.origin || !/\.html?$/i.test(url.pathname) || !host?.canNavigate(window, url.href)) return;
    if (!event.cancelable || event.formData || event.downloadRequest !== null) {
      host.allowNative(window, instance, location.href, url.href);
      return;
    }
    event.preventDefault();
    notify(url.href, 'navigate', event.navigationType === 'replace' ? 'replace' : 'push');
  });
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(target instanceof HTMLAnchorElement) || event.defaultPrevented) return;
    let url: URL;
    try { url = new URL(target.href); } catch { return; }
    const separate = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0 ||
      !!target.target && target.target !== '_self';
    const external = url.origin !== location.origin || !/\.html?$/i.test(url.pathname);
    if (separate || external) {
      target.rel = [...new Set([...target.relList, 'noopener'])].join(' ');
      if (!target.hasAttribute('download') && ['http:', 'https:'].includes(url.protocol)) {
        event.preventDefault();
        window.open(url.href, target.target && target.target !== '_self' ? target.target : '_blank', 'noopener');
      }
      return;
    }
    if (target.hasAttribute('download')) return;
    event.preventDefault();
    notify(url.href, 'navigate');
  });
  window.addEventListener('hashchange', () => notify(location.href, 'sync'));
  window.addEventListener('popstate', () => notify(location.href, 'sync'));
  window.addEventListener('pageshow', () => notify(location.href, 'sync'));
}
