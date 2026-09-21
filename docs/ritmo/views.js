/* Экраны Ritmo. */

import { el, icons, sheet, confirmSheet, toast, segmented, emptyState, haptic,
         downloadFile, pickFile, field, input, select, textarea } from './shared/js/ui.js';
import { toISODate, addDays, addMonths, startOfMonth, endOfMonth, startOfWeek,
         relativeDay, formatMonth, formatDate, weekdayNames } from './shared/js/format.js';
import { LANGS } from './shared/js/i18n.js';
import { canPromptInstall, promptInstall, isIOS, isStandalone, requestNotifications }
  from './shared/js/pwa.js';
import * as D from './data.js';
import { habitForm, countForm } from './forms.js';
import { cloudCard } from './shared/js/cloud-ui.js';
import { runner } from './sync.js';

export const ui = {
  day: toISODate(),
  month: startOfMonth(toISODate()),
  statsPeriod: 'week',
  showArchived: false,
};

/* ─────────── Кольцо прогресса ─────────── */

function ring(ratio, size = 96, label, sub) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  return el('div', { style: { position: 'relative', width: size + 'px', height: size + 'px', flex: '0 0 auto' } }, [
    el('div', {
      html: `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle class="ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="7"/>
        <circle class="ring__fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="7"
          stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - ratio)).toFixed(1)}"/>
      </svg>`,
    }),
    el('div', {
      style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center',
               textAlign: 'center', lineHeight: '1.15' },
    }, [
      el('div', {}, [
        el('div.amount.num', { style: { fontSize: size > 80 ? '22px' : '16px' }, text: label }),
        sub && el('div.tiny.muted-3', { text: sub }),
      ]),
    ]),
  ]);
}

/* ─────────── Экран «Сегодня» ─────────── */

function dayNav(t, lang, rerender) {
  const isToday = ui.day === toISODate();
  return el('div.hstack', { style: { justifyContent: 'space-between' } }, [
    el('button.icon-btn', { html: icons.chevL, 'aria-label': 'Предыдущий день',
      onclick: () => { ui.day = addDays(ui.day, -1); haptic(); rerender(); } }),
    el('button', {
      style: { fontWeight: '650', fontSize: '15px', color: 'var(--text)' },
      text: relativeDay(ui.day, lang, t),
      onclick: () => { ui.day = toISODate(); rerender(); },
    }),
    el('button.icon-btn', {
      html: icons.chevR, 'aria-label': 'Следующий день',
      disabled: isToday,
      style: { opacity: isToday ? '.25' : '1' },
      onclick: () => { if (!isToday) { ui.day = addDays(ui.day, 1); haptic(); rerender(); } },
    }),
  ]);
}

function habitRow(t, h, iso, rerender, { editable = true } = {}) {
  const done = D.doneOn(h, iso);
  const value = D.valueOf(h.id, iso);
  const streak = D.streakOf(h);
  const color = `var(${h.color})`;

  const sub = h.type === 'count'
    ? `${value} ${t('of_n', { n: h.target })} ${h.unit || ''}`.trim()
    : (streak > 1 ? `🔥 ${streak} ${t('streak_days')}` : t('cat_' + h.area));

  let control;
  if (h.type === 'count') {
    control = el('div.hstack', { style: { gap: '4px' } }, [
      el('button.icon-btn', {
        style: { width: '36px', height: '36px' },
        html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
        'aria-label': '−',
        onclick: (e) => { e.stopPropagation(); D.toggle(h.id, iso, -D.step(h)); haptic(); rerender(); },
      }),
      el('button', {
        style: { minWidth: '44px', textAlign: 'center', fontWeight: '680', fontSize: '15px',
                 color: done ? color : 'var(--text)', fontVariantNumeric: 'tabular-nums' },
        text: String(value),
        onclick: (e) => { e.stopPropagation(); countForm({ t, habit: h, iso, onDone: rerender }); },
      }),
      el('button.icon-btn', {
        style: { width: '36px', height: '36px', color: color },
        html: icons.plus, 'aria-label': '+',
        onclick: (e) => { e.stopPropagation(); D.toggle(h.id, iso, D.step(h)); haptic(); rerender(); },
      }),
    ]);
  } else {
    control = el('button', {
      'aria-label': h.title, 'aria-pressed': String(done),
      style: {
        width: '40px', height: '40px', borderRadius: '999px', flex: '0 0 auto',
        display: 'grid', placeItems: 'center',
        background: done ? color : 'transparent',
        border: done ? 'none' : '2px solid var(--line)',
        color: done ? 'var(--bg)' : 'transparent',
        transition: 'background .18s, border-color .18s',
      },
      html: icons.check,
      onclick: (e) => { e.stopPropagation(); D.toggle(h.id, iso); haptic(done ? 8 : 20); rerender(); },
    });
  }

  return el('div.row', {}, [
    el('div.avatar', {
      style: { background: `color-mix(in srgb, ${color} ${done ? 26 : 14}%, transparent)`,
               opacity: done ? '1' : '.85' },
      text: h.icon,
    }),
    el('button.row__main', {
      style: { background: 'none', textAlign: 'left' },
      onclick: () => editable && habitForm({ t, habit: h, onDone: rerender }),
    }, [
      el('div.row__title', {
        style: { textDecoration: done && h.type === 'check' ? 'line-through' : 'none',
                 color: done ? 'var(--text-2)' : 'var(--text)' },
        text: h.title,
      }),
      el('div.row__sub', { text: sub }),
    ]),
    control,
  ]);
}

export function todayView(t, lang, rerender) {
  const iso = ui.day;
  const list = D.habitsForDay(iso);
  const p = D.dayProgress(iso);
  const nodes = [dayNav(t, lang, rerender)];

  /* Шапка с кольцом */
  const perfectStreak = (() => {
    let n = 0, d = D.isPerfectDay(toISODate()) ? toISODate() : addDays(toISODate(), -1);
    for (let g = 0; g < 365; g++) {
      if (!D.isPerfectDay(d)) break;
      n++; d = addDays(d, -1);
    }
    return n;
  })();

  nodes.push(el('div.card.hstack', { style: { gap: '16px' } }, [
    ring(p.ratio, 92, Math.round(p.ratio * 100) + '%', t('of_n', { n: p.total })),
    el('div', { style: { flex: '1', minWidth: '0' } }, [
      el('div.amount.amount--lg.num', { text: `${p.done} / ${p.total}` }),
      el('div.small.muted', { text: t('done_today') }),
      perfectStreak > 0 && el('div.hstack', { style: { marginTop: '8px', gap: '6px', color: 'var(--warn)' } }, [
        el('span', { html: icons.flame, style: { width: '17px', display: 'block' } }),
        el('span.small', { style: { fontWeight: '620' },
          text: `${perfectStreak} ${t('streak_days')}` }),
      ]),
    ]),
  ]));

  if (!list.length) {
    nodes.push(D.activeHabits().length
      ? emptyState('🌤️', t('nothing_today'), t('nothing_today_sub'))
      : emptyState('🌱', t('no_habits'), t('no_habits_sub'),
          el('button.btn.btn--primary', { text: t('add_starter'),
            onclick: () => { D.addStarterSet(); toast(t('starter_added')); rerender(); } })));
    return nodes;
  }

  if (p.total && p.done === p.total) {
    nodes.push(el('div.card', {
      style: { borderColor: 'var(--accent)', background: 'var(--accent-bg)', textAlign: 'center' },
    }, [
      el('div', { style: { fontSize: '28px' }, text: '🎉' }),
      el('div', { style: { fontWeight: '650', marginTop: '4px' }, text: t('all_done') }),
      el('div.small.muted', { text: t('all_done_sub') }),
    ]));
  }

  /* Группы по времени дня */
  for (const when of D.WHENS) {
    const group = list.filter(h => h.when === when);
    if (!group.length) continue;
    nodes.push(el('div.section-title', { text: t('when_' + when) }));
    nodes.push(el('div.card', {}, [
      el('div.list', {}, group.map(h => habitRow(t, h, iso, rerender))),
    ]));
  }

  /* Самочувствие */
  const moodValue = D.S().mood[iso];
  nodes.push(el('div.card', {}, [
    el('div.card__title', { style: { marginBottom: '10px' }, text: t('mood') }),
    el('div.hstack', { style: { justifyContent: 'space-between' } },
      [1, 2, 3, 4, 5].map(v => el('button', {
        'aria-label': t('mood_' + v), 'aria-pressed': String(moodValue === v),
        style: {
          width: '52px', height: '52px', borderRadius: '999px', fontSize: '25px',
          background: moodValue === v ? 'var(--accent-bg)' : 'transparent',
          border: moodValue === v ? '2px solid var(--accent)' : '2px solid transparent',
          opacity: moodValue && moodValue !== v ? '.4' : '1',
        },
        text: ['😞', '😕', '😐', '🙂', '😄'][v - 1],
        onclick: () => { D.setMood(iso, moodValue === v ? null : v); haptic(); rerender(); },
      }))),
  ]));

  /* Заметка дня */
  const note = textarea({
    placeholder: t('note_ph'), rows: 2, value: D.S().notes[iso] || '',
    onchange: e => D.setNote(iso, e.target.value),
  });
  nodes.push(el('div.card', {}, [
    el('div.card__title', { style: { marginBottom: '10px' }, text: t('note_today') }),
    note,
  ]));

  return nodes;
}

/* ─────────── Экран «Привычки» ─────────── */

function freqLabel(t, h) {
  if (h.freq === 'daily') return t('freq_daily');
  if (h.freq === 'week') return t('times_week', { n: h.perWeek });
  const names = { 0: t('sun'), 1: t('mon'), 2: t('tue'), 3: t('wed'), 4: t('thu'), 5: t('fri'), 6: t('sat') };
  const order = D.S().settings.weekStart === 0 ? [0,1,2,3,4,5,6] : [1,2,3,4,5,6,0];
  return order.filter(d => h.days?.includes(d)).map(d => names[d]).join(' ');
}

export function habitsView(t, lang, rerender) {
  const all = D.S().habits;
  const archived = all.filter(h => !h.active);
  const nodes = [];

  if (!all.length) {
    nodes.push(emptyState('🌱', t('no_habits'), t('no_habits_sub'),
      el('button.btn.btn--primary', { text: t('add_starter'),
        onclick: () => { D.addStarterSet(); toast(t('starter_added')); rerender(); } })));
    return nodes;
  }

  for (const area of D.AREAS) {
    const group = D.activeHabits().filter(h => h.area === area);
    if (!group.length) continue;
    nodes.push(el('div.section-title', { text: t('cat_' + area) }));
    nodes.push(el('div.card', {}, [
      el('div.list', {}, group.map(h => {
        const streak = D.streakOf(h);
        return el('button.row', { onclick: () => habitForm({ t, habit: h, onDone: rerender }) }, [
          el('div.avatar', { style: { background: `color-mix(in srgb, var(${h.color}) 18%, transparent)` },
            text: h.icon }),
          el('div.row__main', {}, [
            el('div.row__title', { text: h.title }),
            el('div.row__sub', { text: freqLabel(t, h) + (h.type === 'count' ? ` · ${h.target} ${h.unit || ''}`.trimEnd() : '') }),
          ]),
          streak > 0 && el('div.hstack', { style: { gap: '3px', color: 'var(--warn)' } }, [
            el('span', { html: icons.flame, style: { width: '15px', display: 'block' } }),
            el('span.small.num', { style: { fontWeight: '650' }, text: String(streak) }),
          ]),
          el('span.muted-3', { html: icons.chevR }),
        ]);
      })),
    ]));
  }

  if (archived.length) {
    nodes.push(el('button.btn.btn--ghost.btn--block', {
      text: ui.showArchived ? t('close') : t('archived_n', { n: archived.length }),
      onclick: () => { ui.showArchived = !ui.showArchived; rerender(); },
    }));
    if (ui.showArchived) {
      nodes.push(el('div.card', {}, [
        el('div.list', {}, archived.map(h => el('button.row', {
          style: { opacity: '.6' },
          onclick: () => habitForm({ t, habit: h, onDone: rerender }),
        }, [
          el('div.avatar', { text: h.icon }),
          el('div.row__main', {}, [el('div.row__title', { text: h.title })]),
          el('span.muted-3', { html: icons.chevR }),
        ]))),
      ]));
    }
  }

  return nodes;
}

/* ─────────── Экран «Прогресс» ─────────── */

function heatmapGrid(t, lang, rerender) {
  const from = ui.month, to = endOfMonth(ui.month);
  const cells = D.heatmap(from, to);
  const weekStart = D.S().settings.weekStart;
  const lead = (new Date(from + 'T00:00:00').getDay() - weekStart + 7) % 7;
  const today = toISODate();

  const grid = el('div', {
    style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '5px' },
  });

  for (const name of weekdayNames(lang, weekStart, 'short')) {
    grid.append(el('div.tiny.muted-3', { style: { textAlign: 'center', paddingBottom: '2px' }, text: name }));
  }
  for (let i = 0; i < lead; i++) grid.append(el('div'));

  for (const c of cells) {
    const future = c.date > today;
    // заливка только там, где что-то реально сделано — иначе пустой день
    // выглядит как частичный успех
    const alpha = c.done ? 0.22 + c.ratio * 0.78 : 0;
    grid.append(el('button', {
      'aria-label': `${c.date}: ${c.done}/${c.total}`,
      style: {
        aspectRatio: '1', borderRadius: '8px',
        display: 'grid', placeItems: 'center',
        fontSize: '11px', fontWeight: '600',
        color: c.ratio > 0.55 ? 'var(--bg)' : 'var(--text-3)',
        background: future ? 'transparent'
          : (alpha ? `color-mix(in srgb, var(--accent) ${Math.round(alpha * 100)}%, var(--surface-2))`
                   : 'var(--surface-2)'),
        border: c.date === today ? '1.5px solid var(--accent)' : '1.5px solid transparent',
        opacity: future ? '.3' : '1',
      },
      text: String(Number(c.date.slice(8))),
      onclick: () => { ui.day = c.date; location.hash = '#today'; },
    }));
  }

  return el('div.card', {}, [
    el('div.card__head', {}, [
      el('button.icon-btn', { html: icons.chevL,
        onclick: () => { ui.month = addMonths(ui.month, -1); rerender(); } }),
      el('div.card__title', { style: { textAlign: 'center', flex: '1' },
        text: formatMonth(ui.month, lang) }),
      el('button.icon-btn', { html: icons.chevR,
        onclick: () => { ui.month = addMonths(ui.month, 1); rerender(); } }),
    ]),
    grid,
  ]);
}

function statsRange() {
  const today = toISODate();
  if (ui.statsPeriod === 'week') return [startOfWeek(today, D.S().settings.weekStart), today];
  if (ui.statsPeriod === 'month') return [startOfMonth(today), endOfMonth(today)];
  return [today.slice(0, 4) + '-01-01', today.slice(0, 4) + '-12-31'];
}

export function statsView(t, lang, rerender) {
  const [from, to] = statsRange();
  const st = D.rangeStats(from, to);
  const habits = D.byHabit(from, to);
  const areas = D.byArea(from, to);

  const nodes = [
    segmented([
      { value: 'week', label: t('stats_week') },
      { value: 'month', label: t('stats_month') },
      { value: 'year', label: t('stats_year') },
    ], ui.statsPeriod, v => { ui.statsPeriod = v; rerender(); }),
  ];

  if (!D.activeHabits().length) {
    nodes.push(emptyState('📈', t('no_stats'), t('no_stats_sub')));
    return nodes;
  }

  nodes.push(el('div.card.hstack', { style: { gap: '16px' } }, [
    ring(st.ratio, 92, Math.round(st.ratio * 100) + '%'),
    el('div', { style: { flex: '1' } }, [
      el('div.card__title', { text: t('completion') }),
      el('div.amount.amount--lg.num', { text: `${st.done} / ${st.scheduled}` }),
    ]),
  ]));

  nodes.push(el('div.grid.grid--3', {}, [
    tile(t('perfect_days'), String(st.perfect)),
    tile(t('days_active'), String(st.activeDays)),
    tile(t('total_done'), String(st.done)),
  ]));

  nodes.push(heatmapGrid(t, lang, rerender));

  if (areas.length) {
    nodes.push(el('div.card', {}, [
      el('div.card__head', {}, [el('div.card__title', { text: t('by_area') })]),
      el('div.stack', { style: { gap: '11px' } }, areas.map(a => el('div', {}, [
        el('div.hstack', { style: { marginBottom: '5px' } }, [
          el('span.small', { style: { fontWeight: '570' }, text: t('cat_' + a.area) }),
          el('div.spacer'),
          el('span.small.num', { style: { fontWeight: '620' }, text: Math.round(a.ratio * 100) + '%' }),
        ]),
        el('div.bar', {}, [el('div.bar__fill', {
          style: { width: Math.max(2, a.ratio * 100) + '%', background: `var(${D.AREA_COLOR[a.area]})` },
        })]),
      ]))),
    ]));
  }

  nodes.push(el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('by_habit') })]),
    el('div.list', {}, habits.map(r => el('div.row', {}, [
      el('div.avatar', { style: { background: `color-mix(in srgb, var(${r.habit.color}) 18%, transparent)` },
        text: r.habit.icon }),
      el('div.row__main', {}, [
        el('div.row__title', { text: r.habit.title }),
        el('div.bar', { style: { marginTop: '6px' } }, [el('div.bar__fill', {
          style: { width: Math.max(2, r.ratio * 100) + '%', background: `var(${r.habit.color})` },
        })]),
      ]),
      el('div.row__end', {}, [
        el('div.small.num', { style: { fontWeight: '650' }, text: Math.round(r.ratio * 100) + '%' }),
        el('div.tiny.muted-3.num', { text: `${r.done}/${r.scheduled}` }),
      ]),
    ]))),
  ]));

  return nodes;
}

function tile(label, value) {
  return el('div.card.card--flat', { style: { padding: '13px' } }, [
    el('div.tiny.muted-3', { text: label }),
    el('div.amount.num', { style: { fontSize: '19px', marginTop: '3px' }, text: value }),
  ]);
}

/* ─────────── Экран «Ещё» ─────────── */

export function settingsView(t, lang, rerender, i18n) {
  const s = D.S().settings;
  const nodes = [cloudCard({ t, runner, rerender })];

  if (!isStandalone()) {
    nodes.push(el('div.card', { style: { borderColor: 'var(--accent)' } }, [
      el('div.card__title', { text: t('install') }),
      el('p.small.muted', { style: { marginTop: '6px' },
        text: isIOS()
          ? 'Нажмите «Поделиться» внизу Safari → «На экран «Домой»». Приложение появится иконкой рядом с остальными.'
          : 'Установите приложение на телефон — оно будет открываться с иконки и работать без интернета.' }),
      canPromptInstall() && el('button.btn.btn--primary.btn--block', {
        style: { marginTop: '12px' }, text: t('install'),
        onclick: async () => { await promptInstall(); rerender(); },
      }),
    ]));
  }

  /* Напоминания */
  nodes.push(el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('reminders') })]),
    el('div.switch-row', {}, [
      el('span', { text: t('reminders_on') }),
      el('label.switch', {}, [
        el('input', {
          type: 'checkbox', checked: s.reminders.enabled,
          onchange: async e => {
            if (e.target.checked) {
              const res = await requestNotifications();
              if (res !== 'granted') {
                e.target.checked = false;
                toast(t('reminders_denied'), { error: true, ms: 4000 });
                return;
              }
            }
            D.store.update(st => { st.settings.reminders.enabled = e.target.checked; });
            rerender();
          },
        }),
        el('span'),
      ]),
    ]),
    s.reminders.enabled && field(t('reminder_time'), input({
      type: 'time', value: s.reminders.time,
      onchange: e => D.store.update(st => { st.settings.reminders.time = e.target.value || '20:00'; }),
    })),
    el('p.tiny.muted-3', { style: { marginTop: '10px' },
      text: isIOS() ? t('reminders_ios') : t('reminders_hint') }),
  ]));

  /* Вид */
  nodes.push(el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('settings') })]),
    field(t('language'), select(
      LANGS.map(l => ({ value: l.code, label: `${l.flag} ${l.label}` })),
      { value: i18n.lang, onchange: e => {
          D.store.update(st => { st.settings.lang = e.target.value; });
          i18n.setLang(e.target.value);
        } })),
    el('div', { style: { height: '12px' } }),
    field(t('theme'), select([
      { value: 'dark', label: t('theme_dark') },
      { value: 'light', label: t('theme_light') },
      { value: 'auto', label: t('theme_auto') },
    ], { value: s.theme, onchange: e => {
      D.store.update(st => { st.settings.theme = e.target.value; });
      window.dispatchEvent(new CustomEvent('theme:change'));
      rerender();
    } })),
    el('div', { style: { height: '12px' } }),
    field(t('week_start'), select([
      { value: '1', label: t('ws_mon') },
      { value: '0', label: t('ws_sun') },
    ], { value: String(s.weekStart), onchange: e => {
      D.store.update(st => { st.settings.weekStart = Number(e.target.value); });
      rerender();
    } })),
  ]));

  /* Копии */
  nodes.push(el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('backup') })]),
    el('p.tiny.muted-3', { style: { marginBottom: '12px' }, text: t('backup_hint') }),
    el('div.stack', { style: { gap: '9px' } }, [
      el('button.btn.btn--ghost.btn--block', { text: t('export'), onclick: () => {
        downloadFile(`ritmo-${toISODate()}.json`, D.store.export());
        toast(t('export_done'));
      } }),
      el('button.btn.btn--ghost.btn--block', { text: 'Выгрузить в таблицу (CSV)', onclick: () => {
        downloadFile(`ritmo-${toISODate()}.csv`, D.toCSV(), 'text/csv');
        toast(t('export_done'));
      } }),
      el('button.btn.btn--ghost.btn--block', { text: t('import'), onclick: async () => {
        const file = await pickFile();
        if (!file) return;
        const res = D.store.import(file.text);
        if (res.ok) { toast(t('import_ok')); rerender(); }
        else toast(t('import_err'), { error: true });
      } }),
      el('button.btn.btn--danger.btn--block', { text: t('reset'), onclick: () => confirmSheet({
        title: t('reset'), text: t('reset_confirm'),
        confirmLabel: t('delete'), cancelLabel: t('cancel'),
        onConfirm: () => { D.store.reset(); toast(t('deleted')); rerender(); },
      }) }),
    ]),
  ]));

  return nodes;
}
