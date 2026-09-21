/* Модель данных Ritmo и расчёты серий.
   logs хранит числа: для привычки-отметки это 0/1, для количественной — сколько сделано. */

import { createStore, uid } from './shared/js/store.js';
import { stamp, tombstone, alive, now as syncNow } from './shared/js/sync.js';
import { toISODate, addDays, startOfWeek, startOfMonth, endOfMonth, daysBetween }
  from './shared/js/format.js';

export const AREAS = ['body', 'mind', 'health', 'work'];
export const WHENS = ['morning', 'day', 'evening', 'any'];

export const AREA_COLOR = { body: '--c1', mind: '--c3', health: '--c6', work: '--c4' };

/* Готовый набор: по нему видно, как устроены привычки разных типов. */
const STARTER = [
  ['🏋️', 'Тренировка',            'body',   'check', null,        0,     'days',  [1,3,5], 'morning'],
  ['🚶', '10 000 шагов',           'body',   'count', 'шагов',     10000, 'daily', null,    'any'],
  ['🧘', 'Растяжка 10 минут',      'body',   'check', null,        0,     'daily', null,    'evening'],
  ['📚', 'Читать',                 'mind',   'count', 'страниц',   20,    'daily', null,    'evening'],
  ['🇪🇸', 'Испанский 15 минут',     'mind',   'check', null,        0,     'daily', null,    'day'],
  ['💧', 'Вода',                   'health', 'count', 'стаканов',  8,     'daily', null,    'any'],
  ['😴', 'Лечь до полуночи',       'health', 'check', null,        0,     'daily', null,    'evening'],
  ['🍬', 'День без сладкого',      'health', 'check', null,        0,     'daily', null,    'any'],
  ['💊', 'Витамины',               'health', 'check', null,        0,     'daily', null,    'morning'],
  ['📝', 'План дня',               'work',   'check', null,        0,     'days',  [1,2,3,4,5], 'morning'],
  ['🎯', 'Глубокая работа',        'work',   'count', 'часа',      2,     'days',  [1,2,3,4,5], 'day'],
  ['📥', 'Разобрать входящие',     'work',   'check', null,        0,     'days',  [1,2,3,4,5], 'day'],
  ['✅', 'Итоги дня',              'work',   'check', null,        0,     'daily', null,    'evening'],
];

/* fixedIds — для набора по умолчанию: на двух устройствах он должен
   получиться одинаковым, иначе после первой синхронизации привычки
   задвоятся. При добавлении набора вручную ключи новые. */
export function starterHabits({ fixedIds = false } = {}) {
  const today = toISODate();
  return STARTER.map(([icon, title, area, type, unit, target, freq, days, when], i) => stamp({
    id: fixedIds ? 'h-' + i : uid('h'), icon, title, area, type, unit, target,
    freq, days: days || [1, 2, 3, 4, 5, 6, 0], perWeek: 3,
    when, color: AREA_COLOR[area], active: true, order: i,
    createdDate: today, createdAt: new Date().toISOString(),
  }));
}

/* Дата появления привычки — по местному времени. Дни до неё не считаются
   пропущенными: иначе первый же месяц выглядит как сплошной провал. */
const createdOn = (h) => h.createdDate || (h.createdAt || '').slice(0, 10) || '1970-01-01';
export const existsOn = (h, iso) => iso >= createdOn(h);

const seed = {
  v: 1,
  settings: {
    lang: null,
    theme: 'dark',
    weekStart: 1,
    reminders: { enabled: false, time: '20:00' },
  },
  habits: starterHabits({ fixedIds: true }),
  logs: {},      // 'YYYY-MM-DD' → { habitId: число }
  logsMeta: {},  // 'YYYY-MM-DD' → { habitId: когда изменено } — для слияния
  notes: {},     // 'YYYY-MM-DD' → текст
  notesMeta: {},
  mood: {},      // 'YYYY-MM-DD' → 1..5
  moodMeta: {},
};

export const store = createStore({
  key: 'lifeos.ritmo',
  version: 1,
  seed,
  stampField: 'settings',
  migrate: (data) => data,
});

export const S = () => store.state;

/* Удалённые привычки остаются помеченными, чтобы второе устройство
   не вернуло их обратно. На экранах их не видно. */
export const liveHabits = () => alive(S().habits);

export const activeHabits = () =>
  liveHabits().filter(h => h.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export const habitById = (id) => {
  const h = S().habits.find(x => x.id === id);
  return h && !h.deleted ? h : null;
};

/* ─────── Отметки ─────── */

export function valueOf(habitId, iso) {
  return S().logs[iso]?.[habitId] ?? 0;
}

export function doneOn(habit, iso) {
  const v = valueOf(habit.id, iso);
  return habit.type === 'count' ? v >= (habit.target || 1) : v >= 1;
}

/** Сколько раз привычка выполнена за неделю, содержащую iso, строго ДО этого дня. */
function doneEarlierInWeek(habit, iso) {
  const ws = startOfWeek(iso, S().settings.weekStart);
  let n = 0;
  for (let d = ws; d < iso; d = addDays(d, 1)) if (doneOn(habit, d)) n++;
  return n;
}

/** Запланирована ли привычка на этот день.
    Для «N раз в неделю» день считается запланированным, пока недельная норма не закрыта. */
export function scheduledOn(habit, iso) {
  if (habit.freq === 'daily') return true;
  if (habit.freq === 'days') {
    const dow = new Date(iso + 'T00:00:00').getDay();
    return (habit.days || []).includes(dow);
  }
  if (habit.freq === 'week') return doneEarlierInWeek(habit, iso) < (habit.perWeek || 1);
  return true;
}

export function habitsForDay(iso) {
  return activeHabits().filter(h => existsOn(h, iso) && (scheduledOn(h, iso) || doneOn(h, iso)));
}

/** Поставить отметку. Для количественных — прибавить шаг, для обычных — переключить. */
export function toggle(habitId, iso, delta) {
  const h = habitById(habitId);
  if (!h) return;
  store.update(s => {
    if (!s.logs[iso]) s.logs[iso] = {};
    const cur = s.logs[iso][habitId] ?? 0;
    let next;
    if (h.type === 'count') {
      next = Math.max(0, cur + (delta ?? step(h)));
    } else {
      next = cur >= 1 ? 0 : 1;
    }
    if (next === 0) delete s.logs[iso][habitId];
    else s.logs[iso][habitId] = next;
    if (!Object.keys(s.logs[iso]).length) delete s.logs[iso];
    markLog(s, iso, habitId);
  });
}

export function setValue(habitId, iso, value) {
  store.update(s => {
    if (!s.logs[iso]) s.logs[iso] = {};
    const v = Math.max(0, Number(value) || 0);
    if (v === 0) delete s.logs[iso][habitId];
    else s.logs[iso][habitId] = v;
    if (!Object.keys(s.logs[iso]).length) delete s.logs[iso];
    markLog(s, iso, habitId);
  });
}

/* Время правки хранится по каждой ячейке: утренняя отметка с телефона
   и вечерняя с компьютера не должны затирать друг друга. */
function markLog(s, iso, habitId) {
  if (!s.logsMeta) s.logsMeta = {};
  if (!s.logsMeta[iso]) s.logsMeta[iso] = {};
  s.logsMeta[iso][habitId] = syncNow();
}

/** Удобный шаг прибавления: для больших целей — крупнее. */
export function step(habit) {
  const t = habit.target || 1;
  if (t >= 5000) return 1000;
  if (t >= 500) return 100;
  if (t >= 50) return 10;
  if (t >= 10) return 1;
  return 1;
}

/* ─────── Серии ─────── */

/** Текущая серия: сколько запланированных дней подряд закрыто.
    Сегодняшний незакрытый день серию не рвёт — день ещё не кончился. */
export function streakOf(habit, today = toISODate()) {
  let day = doneOn(habit, today) ? today : addDays(today, -1);
  let n = 0;
  // ограничение в 2 года — защита от бесконечного цикла на пустых данных
  for (let guard = 0; guard < 730; guard++) {
    if (!scheduledOn(habit, day)) { day = addDays(day, -1); continue; }
    if (!doneOn(habit, day)) break;
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function bestStreakOf(habit) {
  const days = Object.keys(S().logs).sort();
  if (!days.length) return 0;
  let best = 0, run = 0;
  for (let d = days[0]; d <= toISODate(); d = addDays(d, 1)) {
    if (!existsOn(habit, d) || !scheduledOn(habit, d)) continue;
    if (doneOn(habit, d)) { run++; best = Math.max(best, run); }
    else run = 0;
  }
  return best;
}

/* ─────── Прогресс дня и периода ─────── */

export function dayProgress(iso) {
  const list = habitsForDay(iso);
  const done = list.filter(h => doneOn(h, iso)).length;
  return { done, total: list.length, ratio: list.length ? done / list.length : 0 };
}

export function isPerfectDay(iso) {
  const p = dayProgress(iso);
  return p.total > 0 && p.done === p.total;
}

/** Данные для календаря-заливки: доля выполнения по каждому дню периода. */
export function heatmap(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push({ date: d, ...dayProgress(d) });
  }
  return out;
}

export function rangeStats(from, to) {
  let done = 0, scheduled = 0, activeDays = 0, perfect = 0;
  const today = toISODate();
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
    const p = dayProgress(d);
    if (!p.total) continue;
    scheduled += p.total;
    done += p.done;
    if (p.done > 0) activeDays++;
    if (p.done === p.total) perfect++;
  }
  return { done, scheduled, activeDays, perfect, ratio: scheduled ? done / scheduled : 0 };
}

/** Выполнение по каждой привычке за период. */
export function byHabit(from, to) {
  const today = toISODate();
  return activeHabits().map(h => {
    let done = 0, scheduled = 0;
    for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
      if (!existsOn(h, d)) continue;
      if (!scheduledOn(h, d) && !doneOn(h, d)) continue;
      scheduled++;
      if (doneOn(h, d)) done++;
    }
    return { habit: h, done, scheduled, ratio: scheduled ? done / scheduled : 0, streak: streakOf(h) };
  }).sort((a, b) => b.ratio - a.ratio);
}

/** Выполнение по областям жизни. */
export function byArea(from, to) {
  const rows = byHabit(from, to);
  return AREAS.map(area => {
    const items = rows.filter(r => r.habit.area === area);
    const done = items.reduce((s, r) => s + r.done, 0);
    const scheduled = items.reduce((s, r) => s + r.scheduled, 0);
    return { area, done, scheduled, ratio: scheduled ? done / scheduled : 0, count: items.length };
  }).filter(r => r.count > 0);
}

/* ─────── Изменение привычек ─────── */

export function addHabit(data) {
  const id = uid('h');
  store.update(s => s.habits.push(stamp({
    id, active: true, order: s.habits.length,
    createdDate: toISODate(),
    createdAt: new Date().toISOString(),
    color: AREA_COLOR[data.area] || '--c8',
    ...data,
  })));
  return id;
}

export function updateHabit(id, patch) {
  store.update(s => {
    const h = s.habits.find(x => x.id === id);
    if (h) stamp(Object.assign(h, patch, { color: AREA_COLOR[patch.area ?? h.area] || h.color }));
  });
}

export function removeHabit(id) {
  store.update(s => {
    const h = s.habits.find(x => x.id === id);
    if (h) tombstone(h);
    // отметки удалённой привычки тоже снимаем — со временем правки,
    // иначе второе устройство вернёт их обратно
    for (const day of Object.keys(s.logs)) {
      if (s.logs[day][id] == null) continue;
      delete s.logs[day][id];
      if (!Object.keys(s.logs[day]).length) delete s.logs[day];
      markLog(s, day, id);
    }
  });
}

export function addStarterSet() {
  store.update(s => {
    const base = s.habits.length;
    starterHabits().forEach((h, i) => s.habits.push({ ...h, order: base + i }));
  });
}

/* ─────── Заметки и самочувствие ─────── */

export function setNote(iso, text) {
  store.update(s => {
    if (text?.trim()) s.notes[iso] = text.trim();
    else delete s.notes[iso];
    if (!s.notesMeta) s.notesMeta = {};
    s.notesMeta[iso] = syncNow();
  });
}

export function setMood(iso, value) {
  store.update(s => {
    if (value) s.mood[iso] = value;
    else delete s.mood[iso];
    if (!s.moodMeta) s.moodMeta = {};
    s.moodMeta[iso] = syncNow();
  });
}

/* ─────── Выгрузка ─────── */

export function toCSV() {
  const habits = liveHabits();
  const days = Object.keys(S().logs).sort();
  const head = ['Дата', ...habits.map(h => h.title), 'Самочувствие', 'Заметка'];
  const esc = v => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const rows = days.map(d => [
    d,
    ...habits.map(h => S().logs[d]?.[h.id] ?? ''),
    S().mood[d] ?? '',
    S().notes[d] ?? '',
  ].map(esc).join(';'));
  return '﻿' + [head.join(';'), ...rows].join('\r\n');
}
