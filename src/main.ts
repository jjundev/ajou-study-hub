import { mountCatalog } from './app/catalog-view.js';
import { documentUrl, parseRoute } from './app/router.js';
import { mountTheme } from './app/theme.js';
import { isCatalog } from './content/catalog-validation.js';
import type { Catalog } from './content/model.js';

const root = document.querySelector<HTMLElement>('#app')!;
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
