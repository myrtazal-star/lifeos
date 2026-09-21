/* Kapital — точка входа. */

import { createI18n } from './shared/js/i18n.js';
import { createShell } from './shared/js/shell.js';
import { el, icons, toast, haptic } from './shared/js/ui.js';
import { registerSW, applyTheme, watchSystemTheme } from './shared/js/pwa.js';
import * as D from './data.js';
import { dict } from './dict.js';
import { homeView, txView, reportsView, settingsView } from './views.js';
import { txForm } from './forms.js';

const i18n = createI18n(dict, D.S().settings.lang || undefined);
const t = i18n.t;

// Язык, выбранный в настройках, запоминаем на будущее
if (!D.S().settings.lang) D.store.update(s => { s.settings.lang = i18n.lang; });

applyTheme(D.S().settings.theme);
watchSystemTheme(() => D.S().settings.theme);
window.addEventListener('theme:change', () => applyTheme(D.S().settings.theme));

const root = document.getElementById('root');

const tabs = [
  { id: 'home',     icon: 'home',   get label() { return t('tab_home'); },     get title() { return t('app_name'); },      view: () => homeView(t, i18n.lang, rerender) },
  { id: 'tx',       icon: 'list',   get label() { return t('tab_tx'); },       get title() { return t('tab_tx'); },        view: () => txView(t, i18n.lang, rerender) },
  { id: 'reports',  icon: 'chart',  get label() { return t('tab_reports'); },  get title() { return t('tab_reports'); },   view: () => reportsView(t, i18n.lang, rerender) },
  { id: 'settings', icon: 'gear',   get label() { return t('tab_settings'); }, get title() { return t('tab_settings'); },  view: () => settingsView(t, i18n.lang, rerender, i18n) },
];

const shell = createShell({ root, tabs, onTabChange: () => syncFab() });

function rerender() { shell.render(); }

/* Кнопка «добавить операцию» — видна на всех экранах, кроме настроек */
const fab = el('button.fab', {
  'aria-label': t('new_tx'),
  html: icons.plus,
  onclick: () => {
    haptic(15);
    txForm({ t, lang: i18n.lang, book: D.S().settings.book, onDone: rerender });
  },
});
document.body.append(fab);

function syncFab() { fab.style.display = shell.current === 'settings' ? 'none' : 'grid'; }
syncFab();
window.addEventListener('hashchange', syncFab);

/* Перерисовка при смене языка */
i18n.onChange(() => { shell.relabel(); syncFab(); });

/* Ошибки хранилища показываем человеку, а не только в консоль */
window.addEventListener('store:error', () => toast(t('storage_full'), { error: true, ms: 5000 }));

/* Регулярные платежи: если срок наступил, подсветим на обзоре */
if (D.dueRecurring(D.S().settings.book).length) shell.go('home');

registerSW('./sw.js');
