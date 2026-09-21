/* Форма привычки. */

import { el, sheet, confirmSheet, toast, field, input, select, segmented }
  from './shared/js/ui.js';
import * as D from './data.js';

const ICONS = ['🏋️','🚶','🧘','🏃','🚴','📚','✍️','🎧','🇪🇸','🧠','💧','😴','🍎','🍬','💊','🚭',
               '📝','🎯','📥','✅','📞','💼','🧹','🙏','🎸','👨‍👩‍👧','☀️','🌙'];

export function habitForm({ t, habit = null, onDone }) {
  const editing = !!habit;
  const draft = {
    title: habit?.title ?? '',
    icon: habit?.icon ?? '✅',
    area: habit?.area ?? 'body',
    when: habit?.when ?? 'any',
    type: habit?.type ?? 'check',
    unit: habit?.unit ?? '',
    target: habit?.target ? String(habit.target) : '1',
    freq: habit?.freq ?? 'daily',
    days: [...(habit?.days ?? [1, 2, 3, 4, 5, 6, 0])],
    perWeek: habit?.perWeek ?? 3,
  };
  let s;
  const body = el('div.stack');

  function render() {
    const iconGrid = el('div.chips');
    for (const ic of ICONS) {
      iconGrid.append(el('button.chip', {
        type: 'button', 'aria-pressed': String(ic === draft.icon),
        onclick: () => { draft.icon = ic; render(); },
      }, [el('span', { text: ic })]));
    }

    const parts = [
      field(t('habit_title'), input({
        value: draft.title, placeholder: t('habit_title_ph'), enterkeyhint: 'done',
        oninput: e => { draft.title = e.target.value; },
      })),

      el('div.field', {}, [el('span.label', { text: t('habit_icon') }), iconGrid]),

      el('div.field', {}, [
        el('span.label', { text: t('habit_cat') }),
        segmented(D.AREAS.map(a => ({ value: a, label: t('cat_' + a) })), draft.area,
          v => { draft.area = v; render(); }, { accent: true }),
      ]),

      el('div.field', {}, [
        el('span.label', { text: t('habit_when') }),
        segmented(D.WHENS.map(w => ({ value: w, label: t('when_' + w) })), draft.when,
          v => { draft.when = v; render(); }),
      ]),

      el('div.field', {}, [
        el('span.label', { text: t('habit_type') }),
        segmented([
          { value: 'check', label: t('type_check') },
          { value: 'count', label: t('type_count') },
        ], draft.type, v => { draft.type = v; render(); }),
      ]),
    ];

    if (draft.type === 'count') {
      parts.push(
        field(t('habit_target'), input({
          inputmode: 'numeric', value: draft.target,
          oninput: e => { draft.target = e.target.value; },
        })),
        field(t('habit_unit'), input({
          value: draft.unit, placeholder: t('habit_unit_ph'), enterkeyhint: 'done',
          oninput: e => { draft.unit = e.target.value; },
        })),
      );
    }

    parts.push(el('div.field', {}, [
      el('span.label', { text: t('habit_freq') }),
      segmented([
        { value: 'daily', label: t('freq_daily') },
        { value: 'days', label: t('freq_days') },
        { value: 'week', label: t('freq_week') },
      ], draft.freq, v => { draft.freq = v; render(); }),
    ]));

    if (draft.freq === 'days') {
      const order = D.S().settings.weekStart === 0 ? [0,1,2,3,4,5,6] : [1,2,3,4,5,6,0];
      const names = { 0: t('sun'), 1: t('mon'), 2: t('tue'), 3: t('wed'), 4: t('thu'), 5: t('fri'), 6: t('sat') };
      const row = el('div.chips');
      for (const d of order) {
        row.append(el('button.chip', {
          type: 'button', 'aria-pressed': String(draft.days.includes(d)),
          style: { minWidth: '46px', justifyContent: 'center' },
          text: names[d],
          onclick: () => {
            draft.days = draft.days.includes(d)
              ? draft.days.filter(x => x !== d)
              : [...draft.days, d];
            render();
          },
        }));
      }
      parts.push(el('div.field', {}, [el('span.label', { text: t('freq_days') }), row]));
    }

    if (draft.freq === 'week') {
      parts.push(field(t('per_week'), select(
        [1,2,3,4,5,6].map(n => ({ value: String(n), label: t('times_week', { n }) })),
        { value: String(draft.perWeek), onchange: e => { draft.perWeek = Number(e.target.value); } })));
    }

    if (editing) {
      parts.push(
        el('button.btn.btn--ghost.btn--block', {
          text: habit.active ? t('habit_archive') : t('habit_restore'),
          onclick: () => { D.updateHabit(habit.id, { active: !habit.active }); s.close(); onDone?.(); },
        }),
        el('button.btn.btn--danger.btn--block', {
          text: t('delete'),
          onclick: () => confirmSheet({
            title: t('delete_confirm'),
            text: t('done_n_times', { n: countDone(habit.id) }),
            confirmLabel: t('delete'), cancelLabel: t('cancel'),
            onConfirm: () => { D.removeHabit(habit.id); s.close(); toast(t('deleted')); onDone?.(); },
          }),
        }),
      );
    }

    body.replaceChildren(...parts);
  }
  render();

  function countDone(id) {
    return Object.values(D.S().logs).filter(day => day[id]).length;
  }

  function save() {
    const title = draft.title.trim();
    if (!title) { toast(t('required'), { error: true }); return; }
    if (draft.freq === 'days' && !draft.days.length) {
      toast(t('freq_days'), { error: true }); return;
    }

    const payload = {
      title, icon: draft.icon, area: draft.area, when: draft.when,
      type: draft.type,
      unit: draft.type === 'count' ? draft.unit.trim() : null,
      target: draft.type === 'count' ? Math.max(1, Number(draft.target) || 1) : 0,
      freq: draft.freq,
      days: draft.freq === 'days' ? draft.days : [1, 2, 3, 4, 5, 6, 0],
      perWeek: draft.perWeek,
    };

    if (editing) D.updateHabit(habit.id, payload);
    else D.addHabit(payload);
    s.close(); toast(t('saved')); onDone?.();
  }

  s = sheet({
    title: editing ? t('edit_habit') : t('add_habit'),
    body: [body],
    actions: [
      el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => s.close() }),
      el('button.btn.btn--primary', { text: t('save'), onclick: save }),
    ],
  });
}

/** Ввод точного количества — когда прибавлять по шагу долго. */
export function countForm({ t, habit, iso, onDone }) {
  let s;
  const cur = D.valueOf(habit.id, iso);
  const node = input({
    class: 'input--amount', inputmode: 'numeric', value: String(cur), placeholder: '0',
  });

  s = sheet({
    title: `${habit.icon} ${habit.title}`,
    body: [
      node,
      el('div.small.muted', { style: { textAlign: 'center' },
        text: `${t('habit_target')}: ${habit.target} ${habit.unit || ''}`.trim() }),
    ],
    actions: [
      el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => s.close() }),
      el('button.btn.btn--primary', { text: t('save'), onclick: () => {
        D.setValue(habit.id, iso, node.value);
        s.close(); onDone?.();
      } }),
    ],
  });
}
