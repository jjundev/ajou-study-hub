/** Runs in trusted copied documents; standalone links retain their behavior. */
export function installReaderBridge(documentId: string): void {
  if (window.parent === window) return;
  const notify = (url: string) => parent.postMessage({ type: 'study-hub:navigate', documentId, url }, location.origin);
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
    notify(url.href);
  });
  window.addEventListener('hashchange', () => notify(location.href));
  window.addEventListener('pageshow', () => notify(location.href));
}
