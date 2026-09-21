/* Долги: учёт остатка, платежи и стратегия погашения. */

import { el, sheet, confirmSheet, toast, haptic, field, input, select, emptyState, icons }
  from './shared/js/ui.js';
import { formatMoney, parseMoney, toISODate, relativeDay, formatDate, CURRENCIES }
  from './shared/js/format.js';
import { payoffPlan, paymentForMonths, strategies, costOfWaiting, monthlyInterest }
  from './debt-math.js';
import * as D from './data.js';

/* ─────────── Форма долга ─────────── */

export function debtForm({ t, lang, book, debt = null, onDone }) {
  const editing = !!debt;
  const draft = {
    name: debt?.name ?? '',
    icon: debt?.icon ?? '💳',
    balance: debt ? String(debt.balance / 100) : '',
    currency: debt?.currency ?? D.S().settings.base,
    apr: debt?.apr != null ? String(debt.apr) : '',
    minPayment: debt?.minPayment ? String(debt.minPayment / 100) : '',
    dueDay: debt?.dueDay ?? 1,
    withIva: debt?.withIva !== false,
  };
  let s;
  const body = el('div.stack');

  function render() {
    const iconRow = el('div.chips');
    for (const ic of D.DEBT_ICONS) {
      iconRow.append(el('button.chip', {
        type: 'button', 'aria-pressed': String(ic === draft.icon),
        onclick: () => { draft.icon = ic; render(); },
      }, [el('span', { text: ic })]));
    }

    const parts = [
      field(t('debt_name'), input({
        value: draft.name, placeholder: t('debt_name_ph'), enterkeyhint: 'done',
        oninput: e => { draft.name = e.target.value; },
      })),
      el('div.field', {}, [el('span.label', { text: t('cat_icon') }), iconRow]),

      field(t('debt_balance'), input({
        class: 'input--amount', inputmode: 'decimal', value: draft.balance, placeholder: '0',
        oninput: e => { draft.balance = e.target.value; },
      })),
      el('div.tiny.muted-3', { text: t('debt_balance_hint') }),

      field(t('account_currency'), select(
        ['MXN', 'USD'].map(v => ({ value: v, label: `${v} — ${CURRENCIES[v].name}` })),
        { value: draft.currency, onchange: e => { draft.currency = e.target.value; } })),

      field(t('debt_apr'), input({
        inputmode: 'decimal', value: draft.apr, placeholder: '48.51',
        oninput: e => { draft.apr = e.target.value; },
      })),
      el('div.tiny.muted-3', { text: t('debt_apr_hint') }),

      el('div.switch-row', {}, [
        el('span.small', { text: t('debt_iva') }),
        el('label.switch', {}, [
          el('input', { type: 'checkbox', checked: draft.withIva,
            onchange: e => { draft.withIva = e.target.checked; } }),
          el('span'),
        ]),
      ]),
      el('div.tiny.muted-3', { text: t('debt_iva_hint') }),

      field(t('debt_min'), input({
        inputmode: 'decimal', value: draft.minPayment, placeholder: '3750',
        oninput: e => { draft.minPayment = e.target.value; },
      })),

      field(t('debt_due_day'), select(
        Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
        { value: String(draft.dueDay), onchange: e => { draft.dueDay = Number(e.target.value); } })),
    ];

    if (editing) {
      parts.push(
        el('button.btn.btn--ghost.btn--block', {
          text: debt.archived ? t('debt_reopen') : t('debt_close'),
          onclick: () => { D.updateDebt(debt.id, { archived: !debt.archived }); s.close(); onDone?.(); },
        }),
        el('button.btn.btn--danger.btn--block', {
          text: t('delete'),
          onclick: () => confirmSheet({
            title: t('delete_confirm'),
            text: t('debt_delete_warn', { n: D.debtPaymentsOf(debt.id).length }),
            confirmLabel: t('delete'), cancelLabel: t('cancel'),
            onConfirm: () => { D.removeDebt(debt.id); s.close(); toast(t('deleted')); onDone?.(); },
          }),
        }),
      );
    }

    body.replaceChildren(...parts.filter(Boolean));
  }
  render();

  function save() {
    const name = draft.name.trim();
    const balance = parseMoney(draft.balance);
    const apr = Number(String(draft.apr).replace(',', '.')) || 0;
    if (!name) { toast(t('required'), { error: true }); return; }
    if (balance <= 0) { toast(t('debt_need_balance'), { error: true }); return; }

    const payload = {
      book, name, icon: draft.icon, balance, currency: draft.currency,
      apr, withIva: draft.withIva,
      minPayment: parseMoney(draft.minPayment),
      dueDay: draft.dueDay,
      confirmedAt: toISODate(),
    };
    if (editing) D.updateDebt(debt.id, payload);
    else D.addDebt(payload);
    s.close(); toast(t('saved')); onDone?.();
  }

  s = sheet({
    title: editing ? debt.name : t('debt_new'),
    body: [body],
    actions: [
      el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => s.close() }),
      el('button.btn.btn--primary', { text: t('save'), onclick: save }),
    ],
  });
}

/* ─────────── Платёж по долгу ─────────── */

export function debtPaymentForm({ t, book, debt, onDone }) {
  const draft = {
    amount: debt.minPayment ? String(debt.minPayment / 100) : '',
    date: toISODate(), note: '', asExpense: true,
  };
  let s;

  const amountInput = input({
    class: 'input--amount', inputmode: 'decimal', value: draft.amount, placeholder: '0',
    oninput: e => { draft.amount = e.target.value; },
  });

  function save() {
    const cents = parseMoney(draft.amount);
    if (cents <= 0) { toast(t('amount_required'), { error: true }); return; }

    D.addDebtPayment({ book, debtId: debt.id, date: draft.date, amount: cents, note: draft.note.trim() });

    // платёж по карте — это реальный уход денег со счёта, если попросили записать
    if (draft.asExpense) {
      const acc = D.accountsOf(book).find(a => a.currency === debt.currency) || D.accountsOf(book)[0];
      if (acc) {
        D.addTx({
          book, kind: 'expense', date: draft.date,
          amount: cents, currency: acc.currency, account: acc.id,
          category: null, party: debt.name, note: t('debt_payment_note', { d: debt.name }),
        });
      }
    }

    haptic(18);
    s.close(); toast(t('debt_paid')); onDone?.();
  }

  s = sheet({
    title: `${debt.icon} ${debt.name}`,
    body: [
      el('div.card.card--flat', {}, [
        amountInput,
        el('div.small.muted', { style: { textAlign: 'center', marginTop: '2px' }, text: debt.currency }),
      ]),
      field(t('date'), input({
        type: 'date', value: draft.date,
        onchange: e => { draft.date = e.target.value || toISODate(); },
      })),
      el('div.switch-row', {}, [
        el('span.small', { text: t('debt_as_expense') }),
        el('label.switch', {}, [
          el('input', { type: 'checkbox', checked: draft.asExpense,
            onchange: e => { draft.asExpense = e.target.checked; } }),
          el('span'),
        ]),
      ]),
      el('p.tiny.muted-3', { text: t('debt_as_expense_hint') }),
    ],
    actions: [
      el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => s.close() }),
      el('button.btn.btn--primary', { text: t('debt_pay'), onclick: save }),
    ],
  });
}

/* ─────────── Строка долга в списке ─────────── */

export function debtRow(t, lang, debt, onOpen) {
  const growth = monthlyInterest(debt.balance, debt.apr, debt.withIva !== false);
  const drowning = debt.minPayment > 0 && debt.minPayment <= growth;

  return el('button.row', { onclick: () => onOpen(debt) }, [
    el('div.avatar', { style: { background: 'var(--neg-bg)' }, text: debt.icon }),
    el('div.row__main', {}, [
      el('div.row__title', { text: debt.name }),
      el('div.row__sub', {
        style: drowning ? { color: 'var(--neg)' } : {},
        text: drowning
          ? t('debt_growing', { v: formatMoney(growth, debt.currency, { decimals: 0 }) })
          : t('debt_interest_month', { v: formatMoney(growth, debt.currency, { decimals: 0 }) }),
      }),
    ]),
    el('div.amount.num.neg', { style: { fontSize: '15.5px' },
      text: formatMoney(debt.balance, debt.currency, { decimals: 0 }) }),
  ]);
}

/* ─────────── Экран долга со стратегией ─────────── */

export function debtSheet({ t, lang, book, debt, onDone }) {
  let s;
  const body = el('div.stack');
  // что сейчас введено в поле «сколько платить»
  let custom = null;

  function render() {
    const d = D.debtById(debt.id);
    if (!d) { s.close(); onDone?.(); return; }

    const withIva = d.withIva !== false;
    const cost = costOfWaiting(d.balance, d.apr, withIva);
    const list = strategies(d.balance, d.apr, d.minPayment, withIva);
    const since = D.daysSinceConfirmed(d);
    const pay = custom ?? (list.find(x => !x.neverEnds)?.payment || 0);
    const plan = payoffPlan(d.balance, d.apr, pay, withIva);

    const money = (v) => formatMoney(v, d.currency, { decimals: 0 });

    body.replaceChildren(
      /* Остаток */
      el('div.card', { style: { textAlign: 'center', borderColor: 'var(--neg)' } }, [
        el('div', { style: { fontSize: '32px' }, text: d.icon }),
        el('div.amount.amount--xl.num.neg', { text: formatMoney(d.balance, d.currency) }),
        el('div.tiny.muted-3', { style: { marginTop: '4px' },
          text: t('debt_confirmed', {
            d: formatDate(d.confirmedAt || toISODate(), lang, { day: 'numeric', month: 'long' }),
          }) }),
        since != null && since > 35 && el('div.tiny', { style: { marginTop: '6px', color: 'var(--warn)' },
          text: t('debt_stale', { n: since }) }),
      ]),

      /* Цена промедления — главное число, которое надо осознать */
      el('div.card', { style: { background: 'var(--neg-bg)', borderColor: 'transparent' } }, [
        el('div.card__title', { style: { color: 'var(--neg)' }, text: t('debt_cost_title') }),
        el('div.amount.amount--lg.num.neg', { style: { marginTop: '4px' }, text: money(cost.perMonth) }),
        el('div.small.muted', { text: t('debt_cost_month') }),
        el('div.tiny.muted-3', { style: { marginTop: '6px' },
          text: t('debt_cost_day', { v: money(cost.perDay) }) }),
        d.minPayment > 0 && d.minPayment <= cost.perMonth && el('div.small', {
          style: { marginTop: '10px', color: 'var(--neg)', fontWeight: '600' },
          text: t('debt_min_trap', { v: money(d.minPayment) }),
        }),
      ]),

      /* Сколько платить — живой расчёт */
      el('div.card', {}, [
        el('div.card__head', {}, [el('div.card__title', { text: t('debt_how_much') })]),
        input({
          class: 'input--amount', inputmode: 'decimal', value: String(Math.round(pay / 100)),
          oninput: e => {
            const v = parseMoney(e.target.value);
            custom = v;
            paintPlan();
          },
        }),
        el('div.small.muted', { style: { textAlign: 'center' }, text: t('debt_per_month_label') }),
        planBox(),
      ]),

      /* Варианты */
      el('div.card', {}, [
        el('div.card__head', {}, [el('div.card__title', { text: t('debt_options') })]),
        el('div.hstack.tiny.muted-3', { style: { gap: '6px', paddingBottom: '4px' } }, [
          el('span', { style: { flex: '1' }, text: t('debt_col_pay') }),
          el('span', { style: { flex: '1', textAlign: 'right' }, text: t('debt_col_months') }),
          el('span', { style: { flex: '1.1', textAlign: 'right' }, text: t('debt_col_over') }),
        ]),
        ...list.map(x => el('button.hstack', {
          style: { gap: '6px', padding: '9px 0', borderTop: '1px solid var(--line-soft)',
                   width: '100%', textAlign: 'left' },
          onclick: () => { custom = x.payment; render(); },
        }, [
          el('span.small.num', { style: { flex: '1', fontWeight: '600' }, text: money(x.payment) }),
          el('span.small', { class: x.neverEnds ? 'neg' : '',
            style: { flex: '1', textAlign: 'right' },
            text: x.neverEnds ? t('debt_never') : t('debt_months', { n: x.months }) }),
          el('span.small.num', { style: { flex: '1.1', textAlign: 'right' },
            text: x.neverEnds ? '—' : money(x.totalInterest) }),
        ])),
        el('p.tiny.muted-3', { style: { marginTop: '10px' }, text: t('debt_options_hint') }),
      ]),

      el('button.btn.btn--primary.btn--block', {
        text: '+  ' + t('debt_pay'),
        onclick: () => debtPaymentForm({ t, book, debt: d, onDone: () => { render(); onDone?.(); } }),
      }),

      el('button.btn.btn--ghost.btn--block', {
        text: t('debt_confirm_btn'),
        onclick: () => confirmBalance(d),
      }),

      history(d),

      el('button.btn.btn--ghost.btn--block', {
        text: t('edit'),
        onclick: () => debtForm({ t, lang, book, debt: d, onDone: () => { render(); onDone?.(); } }),
      }),
    );

    function planBox() {
      const box = el('div', { style: { marginTop: '10px' } });
      paint(box, plan);
      planBoxRef = box;
      return box;
    }
  }

  let planBoxRef = null;

  function paintPlan() {
    const d = D.debtById(debt.id);
    if (!d || !planBoxRef) return;
    paint(planBoxRef, payoffPlan(d.balance, d.apr, custom, d.withIva !== false));
  }

  function paint(box, plan) {
    const d = D.debtById(debt.id);
    const money = (v) => formatMoney(v, d.currency, { decimals: 0 });

    if (plan.neverEnds) {
      box.replaceChildren(el('div', { style: { textAlign: 'center' } }, [
        el('div.small', { style: { color: 'var(--neg)', fontWeight: '620' }, text: t('debt_never_long') }),
        el('div.tiny.muted-3', { style: { marginTop: '4px' },
          text: t('debt_never_hint', { v: money(-plan.growth) }) }),
      ]));
      return;
    }

    box.replaceChildren(el('div.grid.grid--2', {}, [
      el('div.card.card--flat', { style: { padding: '12px', textAlign: 'center' } }, [
        el('div.tiny.muted-3', { text: t('debt_free_in') }),
        el('div.amount.num.pos', { style: { fontSize: '19px' }, text: t('debt_months', { n: plan.months }) }),
      ]),
      el('div.card.card--flat', { style: { padding: '12px', textAlign: 'center' } }, [
        el('div.tiny.muted-3', { text: t('debt_overpay') }),
        el('div.amount.num.neg', { style: { fontSize: '19px' }, text: money(plan.totalInterest) }),
      ]),
    ]));
  }

  function confirmBalance(d) {
    const node = input({ class: 'input--amount', inputmode: 'decimal',
      value: String(Math.round(d.balance / 100)) });
    const inner = sheet({
      title: t('debt_confirm_btn'),
      body: [node, el('p.tiny.muted-3', { text: t('debt_confirm_hint') })],
      actions: [
        el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => inner.close() }),
        el('button.btn.btn--primary', { text: t('save'), onclick: () => {
          D.confirmDebtBalance(d.id, parseMoney(node.value));
          inner.close(); toast(t('saved')); render(); onDone?.();
        } }),
      ],
    });
  }

  function history(d) {
    const list = D.debtPaymentsOf(d.id);
    if (!list.length) return el('div');
    return el('div.card', {}, [
      el('div.card__head', {}, [el('div.card__title', { text: t('debt_history') })]),
      el('div.list', {}, list.slice(0, 12).map(p => el('div.row', {}, [
        el('div.row__main', {}, [
          el('div.row__title', { text: relativeDay(p.date, lang, t) }),
          p.note && el('div.row__sub', { text: p.note }),
        ]),
        el('div.amount.num.pos', { style: { fontSize: '15px' },
          text: '−' + formatMoney(p.amount, d.currency, { decimals: 0 }) }),
        el('button.icon-btn', {
          style: { width: '32px', height: '32px' }, html: icons.trash, 'aria-label': t('delete'),
          onclick: () => { D.removeDebtPayment(p.id); render(); onDone?.(); },
        }),
      ]))),
    ]);
  }

  render();
  s = sheet({ title: debt.name, body: [body] });
}

/* ─────────── Список долгов ─────────── */

export function debtsSheet({ t, lang, book, onDone }) {
  let s;
  const body = el('div.stack');

  function render() {
    const debts = D.debtsOf(book);
    const total = D.debtsTotal(book);

    body.replaceChildren(
      debts.length ? el('div.card', { style: { textAlign: 'center' } }, [
        el('div.card__title', { text: t('debt_total') }),
        el('div.amount.amount--xl.num.neg', { text: formatMoney(total, D.S().settings.base) }),
      ]) : null,

      debts.length
        ? el('div.card', {}, [el('div.list', {}, debts.map(d => debtRow(t, lang, d,
            (debt) => debtSheet({ t, lang, book, debt, onDone: () => { render(); onDone?.(); } }))))])
        : emptyState('💳', t('debt_none'), t('debt_none_hint')),

      el('button.btn.btn--primary.btn--block', {
        text: '+  ' + t('debt_new'),
        onclick: () => debtForm({ t, lang, book, onDone: () => { render(); onDone?.(); } }),
      }),
    );
  }
  render();

  s = sheet({ title: t('debt_title'), body: [body] });
}
