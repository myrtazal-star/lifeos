/* Цели накопления: формы и экраны. */

import { el, sheet, confirmSheet, toast, haptic, field, input, select, emptyState, icons }
  from './shared/js/ui.js';
import { formatMoney, parseMoney, toISODate, relativeDay, formatDate, CURRENCIES }
  from './shared/js/format.js';
import * as D from './data.js';

/* ─────────── Форма цели ─────────── */

export function goalForm({ t, lang, book, goal = null, onDone }) {
  const editing = !!goal;
  const accounts = D.accountsOf(book);

  const draft = {
    name: goal?.name ?? '',
    icon: goal?.icon ?? '🎯',
    target: goal ? String(goal.target / 100) : '',
    currency: goal?.currency ?? D.S().settings.base,
    deadline: goal?.deadline ?? '',
    accountId: goal?.accountId ?? '',
  };
  let s;
  const body = el('div.stack');

  function render() {
    const iconRow = el('div.chips');
    for (const ic of D.GOAL_ICONS) {
      iconRow.append(el('button.chip', {
        type: 'button', 'aria-pressed': String(ic === draft.icon),
        onclick: () => { draft.icon = ic; render(); },
      }, [el('span', { text: ic })]));
    }

    const parts = [
      field(t('goal_name'), input({
        value: draft.name, placeholder: t('goal_name_ph'), enterkeyhint: 'done',
        oninput: e => { draft.name = e.target.value; },
      })),

      el('div.field', {}, [el('span.label', { text: t('cat_icon') }), iconRow]),

      field(t('goal_target'), input({
        class: 'input--amount', inputmode: 'decimal', value: draft.target, placeholder: '0',
        oninput: e => { draft.target = e.target.value; },
      })),

      field(t('account_currency'), select(
        ['MXN', 'USD'].map(v => ({ value: v, label: `${v} — ${CURRENCIES[v].name}` })),
        { value: draft.currency, onchange: e => { draft.currency = e.target.value; render(); } })),

      field(t('goal_deadline'), input({
        type: 'date', value: draft.deadline,
        onchange: e => { draft.deadline = e.target.value; render(); },
      })),
      el('div.tiny.muted-3', { text: t('goal_deadline_hint') }),

      field(t('goal_account'), select(
        [{ value: '', label: t('goal_account_none') },
         ...accounts.map(a => ({ value: a.id, label: `${a.name} · ${a.currency}` }))],
        { value: draft.accountId, onchange: e => { draft.accountId = e.target.value; render(); } })),
      el('div.tiny.muted-3', {
        text: draft.accountId ? t('goal_account_auto') : t('goal_account_manual'),
      }),
    ];

    if (editing) {
      parts.push(
        el('button.btn.btn--ghost.btn--block', {
          text: goal.archived ? t('goal_reopen') : t('goal_close'),
          onclick: () => { D.updateGoal(goal.id, { archived: !goal.archived }); s.close(); onDone?.(); },
        }),
        el('button.btn.btn--danger.btn--block', {
          text: t('delete'),
          onclick: () => confirmSheet({
            title: t('delete_confirm'),
            text: t('goal_delete_warn', { n: D.savingsOf(goal.id).length }),
            confirmLabel: t('delete'), cancelLabel: t('cancel'),
            onConfirm: () => { D.removeGoal(goal.id); s.close(); toast(t('deleted')); onDone?.(); },
          }),
        }),
      );
    }

    body.replaceChildren(...parts.filter(Boolean));
  }
  render();

  function save() {
    const name = draft.name.trim();
    const target = parseMoney(draft.target);
    if (!name) { toast(t('required'), { error: true }); return; }
    if (target <= 0) { toast(t('goal_need_target'), { error: true }); return; }

    const payload = {
      book, name, icon: draft.icon, target, currency: draft.currency,
      deadline: draft.deadline || null,
      accountId: draft.accountId || null,
    };
    if (editing) D.updateGoal(goal.id, payload);
    else D.addGoal(payload);
    s.close(); toast(t('saved')); onDone?.();
  }

  s = sheet({
    title: editing ? goal.name : t('goal_new'),
    body: [body],
    actions: [
      el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => s.close() }),
      el('button.btn.btn--primary', { text: t('save'), onclick: save }),
    ],
  });
}

/* ─────────── Отложить на цель ─────────── */

export function savingForm({ t, book, goal, onDone }) {
  const draft = { amount: '', date: toISODate(), note: '' };
  let s;

  const amountInput = input({
    class: 'input--amount', inputmode: 'decimal', placeholder: '0',
    oninput: e => { draft.amount = e.target.value; },
  });

  function save() {
    const cents = parseMoney(draft.amount);
    if (cents <= 0) { toast(t('amount_required'), { error: true }); return; }
    D.addSaving({ book, goalId: goal.id, date: draft.date, amount: cents, note: draft.note.trim() });
    haptic(18);
    s.close(); toast(t('goal_added')); onDone?.();
  }

  s = sheet({
    title: `${goal.icon} ${goal.name}`,
    body: [
      el('div.card.card--flat', {}, [
        amountInput,
        el('div.small.muted', { style: { textAlign: 'center', marginTop: '2px' }, text: goal.currency }),
      ]),
      field(t('date'), input({
        type: 'date', value: draft.date,
        onchange: e => { draft.date = e.target.value || toISODate(); },
      })),
      field(t('note'), input({
        placeholder: t('goal_saving_note_ph'), enterkeyhint: 'done',
        oninput: e => { draft.note = e.target.value; },
      })),
      el('p.tiny.muted-3', { text: t('goal_saving_hint') }),
    ],
    actions: [
      el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => s.close() }),
      el('button.btn.btn--primary', { text: t('goal_put'), onclick: save }),
    ],
  });
}

/* ─────────── Карточка цели в списке ─────────── */

export function goalRow(t, lang, goal, onOpen) {
  const p = D.goalProgress(goal);
  const color = p.done ? 'var(--pos)' : p.overdue ? 'var(--neg)' : 'var(--accent)';

  return el('button', {
    style: { display: 'block', width: '100%', textAlign: 'left', padding: '11px 0',
             borderBottom: '1px solid var(--line-soft)' },
    onclick: () => onOpen(goal),
  }, [
    el('div.hstack', { style: { marginBottom: '7px' } }, [
      el('span', { style: { fontSize: '18px' }, text: goal.icon }),
      el('span', { style: { fontWeight: '570', flex: '1', minWidth: '0', overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: goal.name }),
      el('span.small.num', { style: { fontWeight: '650' },
        text: Math.round(p.ratio * 100) + '%' }),
    ]),
    el('div.bar', {}, [
      el('div.bar__fill', { style: { width: Math.max(2, p.ratio * 100) + '%', background: color } }),
    ]),
    el('div.hstack.tiny.muted-3', { style: { marginTop: '5px' } }, [
      el('span.num', { text: `${formatMoney(p.saved, goal.currency, { decimals: 0 })} ${t('goal_of')} ${formatMoney(p.target, goal.currency, { decimals: 0 })}` }),
      el('div.spacer'),
      el('span', { style: p.overdue ? { color: 'var(--neg)' } : {},
        text: goalHint(t, lang, goal, p) }),
    ]),
  ]);
}

function goalHint(t, lang, goal, p) {
  if (p.done) return '✓ ' + t('goal_done');
  if (!goal.deadline) return t('goal_left', { v: formatMoney(p.remaining, goal.currency, { decimals: 0 }) });
  if (p.overdue) return t('goal_overdue');
  return t('goal_per_month', { v: formatMoney(p.perMonth, goal.currency, { decimals: 0 }) });
}

/* ─────────── Экран одной цели ─────────── */

export function goalSheet({ t, lang, book, goal, onDone }) {
  let s;
  const body = el('div.stack');

  function render() {
    const g = D.goalById(goal.id);
    if (!g) { s.close(); onDone?.(); return; }
    const p = D.goalProgress(g);
    const history = D.savingsOf(g.id);

    body.replaceChildren(
      el('div.card', { style: { textAlign: 'center' } }, [
        el('div', { style: { fontSize: '34px' }, text: g.icon }),
        el('div.amount.amount--xl.num', { style: { marginTop: '4px' },
          text: formatMoney(p.saved, g.currency) }),
        el('div.small.muted', { text: `${t('goal_of')} ${formatMoney(p.target, g.currency)}` }),
        el('div.bar', { style: { marginTop: '14px' } }, [
          el('div.bar__fill', { style: { width: Math.max(2, p.ratio * 100) + '%',
            background: p.done ? 'var(--pos)' : 'var(--accent)' } }),
        ]),
        el('div.hstack.tiny.muted-3', { style: { marginTop: '6px' } }, [
          el('span', { text: Math.round(p.ratio * 100) + '%' }),
          el('div.spacer'),
          el('span', { text: p.done ? t('goal_done')
            : t('goal_left', { v: formatMoney(p.remaining, g.currency, { decimals: 0 }) }) }),
        ]),
      ]),

      g.deadline && el('div.grid.grid--2', {}, [
        tile(t('goal_deadline'), formatDate(g.deadline, lang, { day: 'numeric', month: 'short', year: 'numeric' }),
             p.overdue ? 'neg' : ''),
        tile(t('goal_per_month_short'),
             p.done ? '—' : formatMoney(p.perMonth, g.currency, { decimals: 0 }),
             p.done ? '' : 'pos'),
      ]),

      g.accountId
        ? el('div.card.card--flat', {}, [
            el('p.tiny.muted-3', { text: t('goal_linked', { a: D.accountById(g.accountId)?.name || '—' }) }),
          ])
        : el('button.btn.btn--primary.btn--block', {
            text: '+  ' + t('goal_put'),
            onclick: () => savingForm({ t, book, goal: g, onDone: () => { render(); onDone?.(); } }),
          }),

      !g.accountId && history.length > 0 && el('div.card', {}, [
        el('div.card__head', {}, [el('div.card__title', { text: t('goal_history') })]),
        el('div.list', {}, history.slice(0, 12).map(sv => el('div.row', {}, [
          el('div.row__main', {}, [
            el('div.row__title', { text: sv.note || t('goal_put') }),
            el('div.row__sub', { text: relativeDay(sv.date, lang, t) }),
          ]),
          el('div.amount.num.pos', { style: { fontSize: '15px' },
            text: '+' + formatMoney(sv.amount, g.currency, { decimals: 0 }) }),
          el('button.icon-btn', {
            style: { width: '32px', height: '32px' },
            html: icons.trash, 'aria-label': t('delete'),
            onclick: () => confirmSheet({
              title: t('delete_confirm'), text: t('goal_delete_saving'),
              confirmLabel: t('delete'), cancelLabel: t('cancel'),
              onConfirm: () => { D.removeSaving(sv.id); render(); onDone?.(); },
            }),
          }),
        ]))),
      ]),

      el('button.btn.btn--ghost.btn--block', {
        text: t('edit'),
        onclick: () => goalForm({ t, lang, book, goal: g, onDone: () => { render(); onDone?.(); } }),
      }),
    );
  }
  render();

  s = sheet({ title: goal.name, body: [body] });
}

function tile(label, value, cls = '') {
  return el('div.card.card--flat', { style: { padding: '12px' } }, [
    el('div.tiny.muted-3', { text: label }),
    el('div.amount.num' + (cls ? '.' + cls : ''), { style: { fontSize: '16px', marginTop: '3px' }, text: value }),
  ]);
}

/* ─────────── Список целей ─────────── */

export function goalsSheet({ t, lang, book, onDone }) {
  let s;
  const body = el('div.stack');

  function render() {
    const goals = D.goalsOf(book);
    const done = D.goalsOf(book, { withDone: true }).filter(g => g.archived);

    body.replaceChildren(
      goals.length
        ? el('div.card', {}, goals.map(g => goalRow(t, lang, g,
            (goal) => goalSheet({ t, lang, book, goal, onDone: () => { render(); onDone?.(); } }))))
        : emptyState('🎯', t('goal_none'), t('goal_none_hint')),

      el('button.btn.btn--primary.btn--block', {
        text: '+  ' + t('goal_new'),
        onclick: () => goalForm({ t, lang, book, onDone: () => { render(); onDone?.(); } }),
      }),

      done.length > 0 && el('div.card.card--flat', {}, [
        el('div.card__title', { style: { marginBottom: '8px' }, text: t('goal_closed') }),
        el('div.list', {}, done.map(g => el('button.row', {
          onclick: () => goalSheet({ t, lang, book, goal: g, onDone: () => { render(); onDone?.(); } }),
        }, [
          el('div.avatar', { text: g.icon }),
          el('div.row__main', {}, [el('div.row__title', { text: g.name })]),
          el('span.muted-3', { html: icons.chevR }),
        ]))),
      ]),
    );
  }
  render();

  s = sheet({ title: t('goal_title'), body: [body] });
}
