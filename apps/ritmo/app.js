/* Ritmo — точка входа. */

import { createI18n } from './shared/js/i18n.js';
import { createShell } from './shared/js/shell.js';
import { el, icons, toast, haptic } from './shared/js/ui.js';
import { registerSW, applyTheme, watchSystemTheme, notify } from './shared/js/pwa.js';
import { toISODate } from './shared/js/format.js';
import * as D from './data.js';
import { dict } from './dict.js';
import { todayView, habitsView, statsView, settingsView, ui } from './views.js';
import { habitForm } from './forms.js';
import { runner, watchSync } from './sync.js';

const i18n = createI18n(dict, D.S().settings.lang || undefined);
const t = i18n.t;

if (!D.S().settings.lang) D.store.update(s => { s.settings.lang = i18n.lang; });

applyTheme(D.S().settings.theme);
watchSystemTheme(() => D.S().settings.theme);
window.addEventListener('theme:change', () => applyTheme(D.S().settings.theme));

const root = document.getElementById('root');

const tabs = [
  { id: 'today',    icon: 'check',    get label() { return t('tab_today'); },    get title() { return t('app_name'); },     view: () => todayView(t, i18n.lang, rerender) },
  { id: 'habits',   icon: 'target',   get label() { return t('tab_habits'); },   get title() { return t('tab_habits'); },   view: () => habitsView(t, i18n.lang, rerender) },
  { id: 'stats',    icon: 'chart',    get label() { return t('tab_stats'); },    get title() { return t('tab_stats'); },    view: () => statsView(t, i18n.lang, rerender) },
  { id: 'settings', icon: 'gear',     get label() { return t('tab_settings'); }, get title() { return t('tab_settings'); }, view: () => settingsView(t, i18n.lang, rerender, i18n) },
];

const shell = createShell({ root, tabs, onTabChange: () => syncFab() });

function rerender() { shell.render(); }

const fab = el('button.fab', {
  'aria-label': t('add_habit'),
  html: icons.plus,
  onclick: () => { haptic(15); habitForm({ t, onDone: rerender }); },
});
document.body.append(fab);

function syncFab() { fab.style.display = shell.current === 'habits' ? 'grid' : 'none'; }
syncFab();
window.addEventListener('hashchange', syncFab);

i18n.onChange(() => { shell.relabel(); syncFab(); });
window.addEventListener('store:error', () => toast(t('storage_full'), { error: true, ms: 5000 }));

/* Если приложение пролежало открытым до следующего дня — показываем новый день */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const today = toISODate();
  if (ui.day < today) { ui.day = today; rerender(); }
});

/* ─────── Напоминание ───────
   Браузер не умеет будить приложение по расписанию, поэтому напоминание
   срабатывает, пока вкладка жива. Это честное ограничение веба — о нём
   написано прямо в настройках. */
let lastNotified = null;
setInterval(() => {
  const s = D.S().settings.reminders;
  if (!s.enabled) return;
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const today = toISODate();
  if (hhmm !== s.time || lastNotified === today) return;

  const p = D.dayProgress(today);
  if (p.total && p.done < p.total) {
    notify(t('app_name'), `${t('done_today')}: ${p.done} ${t('of_n', { n: p.total })}`);
  }
  lastNotified = today;
}, 30000);

/* Обмен с другими устройствами. Запускается только если выполнен вход;
   без него приложение работает ровно как раньше, на своём устройстве. */
runner.start();
watchSync(() => { if (shell.current === 'settings') rerender(); });

registerSW('./sw.js');
