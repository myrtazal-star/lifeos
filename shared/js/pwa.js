/* Всё, что превращает страницу в приложение на телефоне:
   регистрация офлайн-кэша, подсказка установки, тема. */

export function registerSW(path = './sw.js') {
  if (!('serviceWorker' in navigator)) return;

  // Было ли приложение уже под управлением кэша: на самой первой установке
  // перезагружаться не нужно, там и так свежий код.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  /* Когда новая версия берёт управление, страница всё ещё выполняет старый
     код. Без перезагрузки человек видит прежнее приложение и думает, что
     ничего не изменилось. Поэтому перезагружаем сами — один раз. */
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(path, { scope: './' });

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('pwa:update-ready'));
          }
        });
      });

      // Проверяем обновление при каждом возвращении в приложение:
      // установленное приложение иначе может неделями жить на старой версии.
      const check = () => { if (!document.hidden) reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', check);
      window.addEventListener('online', check);
      setTimeout(check, 3000);
    } catch (e) { console.warn('Офлайн-режим недоступен:', e); }
  });
}

/** Принудительно перепроверить и применить обновление. */
export async function forceUpdate() {
  if (!('serviceWorker' in navigator)) { location.reload(); return; }
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.update()));
    // если новой версии нет, просто перечитываем страницу без кэша браузера
    setTimeout(() => location.reload(), 600);
  } catch { location.reload(); }
}

/** Тема: 'dark' | 'light' | 'auto' */
export function applyTheme(mode) {
  const root = document.documentElement;
  const sysLight = matchMedia('(prefers-color-scheme: light)').matches;
  const effective = mode === 'auto' ? (sysLight ? 'light' : 'dark') : mode;
  root.setAttribute('data-theme', effective);
  // цвет строки состояния телефона должен совпадать с фоном приложения
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || '#0b0d10';
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
  meta.content = bg;
}

export function watchSystemTheme(getMode) {
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getMode() === 'auto') applyTheme('auto');
  });
}

/* ─────────── Установка на телефон ─────────── */

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  window.dispatchEvent(new CustomEvent('pwa:installable'));
});

export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function canPromptInstall() { return !!deferredPrompt; }

/** Возвращает 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome;
}

/* ─────────── Напоминания ─────────── */

export async function requestNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try { return await Notification.requestPermission(); }
  catch { return 'denied'; }
}

export function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try { new Notification(title, { body, badge: './icons/icon-192.png', icon: './icons/icon-192.png' }); return true; }
  catch { return false; }
}
