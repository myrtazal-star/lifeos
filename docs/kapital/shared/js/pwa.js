/* Всё, что превращает страницу в приложение на телефоне:
   регистрация офлайн-кэша, подсказка установки, тема. */

export function registerSW(path = './sw.js') {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(path, { scope: './' });
      // Если вышла новая версия — обновляем при следующем открытии, без прерывания работы.
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('pwa:update-ready'));
          }
        });
      });
    } catch (e) { console.warn('Офлайн-режим недоступен:', e); }
  });
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
