export function mountTheme(button: HTMLButtonElement) {
  const root = document.documentElement;
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const key = 'od-theme';
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches;

  function updateLabel() {
    const label = isDark() ? '라이트 모드로 전환' : '다크 모드로 전환';
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function sync() {
    try {
      const theme = localStorage.getItem(key);
      if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
      else delete root.dataset.theme;
    } catch { /* A visit still supports changing the theme when storage is unavailable. */ }
    updateLabel();
  }

  button.addEventListener('click', () => {
    const theme = isDark() ? 'light' : 'dark';
    if ((theme === 'dark') === systemDark.matches) {
      delete root.dataset.theme;
      try { localStorage.removeItem(key); } catch { /* CSS follows the system preference. */ }
    } else {
      root.dataset.theme = theme;
      try { localStorage.setItem(key, theme); } catch { /* Retain the preference for this visit. */ }
    }
    updateLabel();
  });
  systemDark.addEventListener('change', updateLabel);
  window.addEventListener('pageshow', sync);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) sync();
  });
  sync();
}
