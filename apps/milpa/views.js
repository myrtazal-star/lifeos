/* Экраны Milpa. Каждая функция возвращает массив узлов для области .screen */

import { el, icons, sheet, confirmSheet, toast, segmented, emptyState,
         downloadFile, pickFile, field, input, select, haptic } from './shared/js/ui.js';
import { formatMoney, toISODate, addMonths, startOfMonth, endOfMonth,
         relativeDay, formatMonth, formatDate, CURRENCIES, parseMoney } from './shared/js/format.js';
import { LANGS } from './shared/js/i18n.js';
import { canPromptInstall, promptInstall, isIOS, isStandalone, forceUpdate } from './shared/js/pwa.js';
import { BUILD, BUILT_AT } from './version.js';
import * as D from './data.js';
import { txForm, accountForm, categoryForm, recurringForm } from './forms.js';
import { nominaSheet } from './nomina-view.js';
import { importSheet } from './import-view.js';
import { getKey, setKey, hasKey, testKey, aiMessage } from './ai.js';
import { cloudCard } from './shared/js/cloud-ui.js';
import { runner } from './sync.js';
import { goalRow, goalSheet, goalsSheet, goalForm } from './goals.js';
import { debtRow, debtSheet, debtsSheet } from './debts.js';

/* Состояние экранов (не сохраняется — это положение «прокрутки», а не данные) */
export const ui = {
  month: startOfMonth(toISODate()),
  txFilter: 'all',
  txQuery: '',
  reportPeriod: 'month',
  reportKind: 'expense',
};

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ─────────── Общие кусочки ─────────── */

function bookSwitcher(t, rerender) {
  const s = D.S().settings;
  return segmented(
    D.BOOKS.map(b => ({ value: b, label: D.bookName(b, t) })),
    s.book,
    v => { D.store.update(st => { st.settings.book = v; }); rerender(); },
  );
}

function monthNav(t, lang, rerender) {
  return el('div.hstack', { style: { justifyContent: 'space-between' } }, [
    el('button.icon-btn', { html: icons.chevL, 'aria-label': 'Предыдущий месяц',
      onclick: () => { ui.month = addMonths(ui.month, -1); haptic(); rerender(); } }),
    el('div', { style: { fontWeight: '650', fontSize: '15px' },
      text: formatMonth(ui.month, lang) }),
    el('button.icon-btn', { html: icons.chevR, 'aria-label': 'Следующий месяц',
      onclick: () => { ui.month = addMonths(ui.month, 1); haptic(); rerender(); } }),
  ]);
}

/** Доходы, расходы и разница по месяцам за год — то, что обычно
    и называют финансовым отчётом. */
function monthTable(t, lang, book, base) {
  const series = D.monthlySeries(book, 12, ui.month).filter(m => m.count > 0);
  if (!series.length) return el('div');

  const totals = series.reduce((a, m) => ({
    income: a.income + m.income, expense: a.expense + m.expense, net: a.net + m.net,
  }), { income: 0, expense: 0, net: 0 });

  const money = v => formatMoney(v, base, { compact: true, decimals: 0 });

  const line = (label, m, strong = false) => el('div.hstack', {
    style: {
      padding: '8px 0', gap: '6px',
      borderTop: strong ? '1px solid var(--line)' : '1px solid var(--line-soft)',
      fontWeight: strong ? '650' : '500',
    },
  }, [
    el('span.small', { style: { flex: '1.1', minWidth: '0' }, text: label }),
    el('span.small.num.pos', { style: { flex: '1', textAlign: 'right' }, text: money(m.income) }),
    el('span.small.num.neg', { style: { flex: '1', textAlign: 'right' }, text: money(m.expense) }),
    el('span.small.num', { class: m.net >= 0 ? 'pos' : 'neg',
      style: { flex: '1', textAlign: 'right' }, text: money(m.net) }),
  ]);

  return el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('report_table') })]),
    el('div.hstack.tiny.muted-3', { style: { gap: '6px', paddingBottom: '2px' } }, [
      el('span', { style: { flex: '1.1' }, text: t('month') }),
      el('span', { style: { flex: '1', textAlign: 'right' }, text: t('month_income') }),
      el('span', { style: { flex: '1', textAlign: 'right' }, text: t('month_expense') }),
      el('span', { style: { flex: '1', textAlign: 'right' }, text: t('month_net') }),
    ]),
    ...series.map(m => line(formatDate(m.month + '-01', lang, { month: 'short', year: '2-digit' }), m)),
    line(t('total'), totals, true),
  ]);
}

function statTile(label, value, cls = '') {
  return el('div.card.card--flat', { style: { padding: '13px' } }, [
    el('div.tiny.muted-3', { text: label }),
    el('div.amount.num' + (cls ? '.' + cls : ''), { style: { fontSize: '17px', marginTop: '3px' }, text: value }),
  ]);
}

function txRow(t, lang, tx, rerender) {
  const base = D.S().settings.base;
  const acc = D.accountById(tx.account);
  const cat = D.categoryById(tx.category);
  const isTransfer = tx.kind === 'transfer';

  const sign = tx.kind === 'income' ? '+' : tx.kind === 'expense' ? '−' : '';
  const cls = tx.kind === 'income' ? 'pos' : tx.kind === 'expense' ? '' : 'muted';

  const sub = isTransfer
    ? `${acc?.name || '—'} → ${D.accountById(tx.toAccount)?.name || '—'}`
    : [cat?.name || t('uncategorized'), tx.party, acc?.name].filter(Boolean).join(' · ');

  // если валюта операции не основная — показываем справку в основной
  const altCur = tx.currency !== base
    ? formatMoney(D.toBase(tx.amount, tx.currency), base, { decimals: 0 })
    : null;

  return el('button.row', {
    onclick: () => txForm({ t, lang, book: tx.book, tx, onDone: rerender }),
  }, [
    el('div.avatar', {
      style: { background: isTransfer ? 'var(--surface-2)' : `color-mix(in srgb, var(${cat?.color || '--c8'}) 18%, transparent)` },
      html: isTransfer ? icons.swap : null,
      text: isTransfer ? null : (cat?.icon || '▫️'),
    }),
    el('div.row__main', {}, [
      el('div.row__title', { text: tx.note || cat?.name || (isTransfer ? t('tx_transfer') : t('uncategorized')) }),
      el('div.row__sub', { text: sub }),
    ]),
    el('div.row__end', {}, [
      el('div.amount.num', { class: cls, style: { fontSize: '15.5px' },
        text: sign + formatMoney(tx.amount, tx.currency, { decimals: 2 }).replace('−', '') }),
      altCur && el('div.tiny.muted-3.num', { text: '≈ ' + altCur }),
    ]),
  ]);
}

/** Список операций, сгруппированный по дням. */
function txList(t, lang, list, rerender, { limit } = {}) {
  const shown = limit ? list.slice(0, limit) : list;
  if (!shown.length) return emptyState('💸', t('no_tx'), t('no_tx_hint'));

  const groups = new Map();
  for (const tx of shown) {
    if (!groups.has(tx.date)) groups.set(tx.date, []);
    groups.get(tx.date).push(tx);
  }

  const out = [];
  for (const [date, items] of groups) {
    const dayTotal = items.reduce((s, tx) => {
      if (tx.kind === 'expense') return s - D.toBase(tx.amount, tx.currency);
      if (tx.kind === 'income') return s + D.toBase(tx.amount, tx.currency);
      return s;
    }, 0);

    out.push(el('div.hstack', { style: { padding: '10px 2px 2px' } }, [
      el('div.small', { style: { fontWeight: '650', color: 'var(--text-2)' },
        text: relativeDay(date, lang, t) }),
      el('div.spacer'),
      el('div.tiny.muted-3.num', {
        text: dayTotal ? formatMoney(dayTotal, D.S().settings.base, { sign: true, decimals: 0 }) : '',
      }),
    ]));
    out.push(el('div.card', {}, [el('div.list', {}, items.map(tx => txRow(t, lang, tx, rerender)))]));
  }
  return out;
}

/* ─────────── Диаграммы ─────────── */

/** Горизонтальные полосы — читаются на телефоне лучше круговых. */
function barList(rows, base, t, prev = null) {
  // prev — та же разбивка за прошлый период, для стрелок «больше/меньше»
  const before = prev ? new Map(prev.rows.map(r => [r.id, r.total])) : null;

  return el('div.stack', { style: { gap: '11px' } }, rows.map(r => {
    const color = `var(${r.cat?.color || '--c8'})`;
    const was = before?.get(r.id);
    const change = was && was > 0 ? Math.round(((r.total - was) / was) * 100) : null;
    const notable = change != null && Math.abs(change) >= 5;

    return el('div', {}, [
      el('div.hstack', { style: { marginBottom: '5px' } }, [
        el('span', { text: (r.cat?.icon || '▫️') + ' ' }),
        el('span.small', { style: { fontWeight: '570' }, text: r.cat?.name || t('uncategorized') }),
        el('div.spacer'),
        notable && el('span.tiny', {
          style: { color: change > 0 ? 'var(--neg)' : 'var(--pos)', marginRight: '6px' },
          text: (change > 0 ? '▲' : '▼') + Math.abs(change) + '%',
        }),
        el('span.small.num', { style: { fontWeight: '620' }, text: formatMoney(r.total, base, { decimals: 0 }) }),
      ]),
      el('div.bar', {}, [
        el('div.bar__fill', { style: { width: Math.max(2, r.share * 100) + '%', background: color } }),
      ]),
      el('div.tiny.muted-3', { style: { marginTop: '3px' },
        text: t('of_total', { p: Math.round(r.share * 100) }) + ' · ' + t('n_ops', { n: r.count }) }),
    ]);
  }));
}

/** Столбики доход/расход по месяцам. */
function monthlyChart(series, base, lang) {
  const W = 320, H = 130, pad = 18;
  const max = Math.max(1, ...series.flatMap(m => [m.income, m.expense]));
  const step = (W - pad * 2) / series.length;
  const bw = Math.min(14, step / 3);

  const bars = [];
  series.forEach((m, i) => {
    const x = pad + step * i + step / 2;
    const hi = (m.income / max) * (H - 34);
    const he = (m.expense / max) * (H - 34);
    bars.push(
      `<rect x="${(x - bw - 1.5).toFixed(1)}" y="${(H - 22 - hi).toFixed(1)}" width="${bw}" height="${Math.max(1, hi).toFixed(1)}" rx="3" fill="${cssVar('--pos')}"/>`,
      `<rect x="${(x + 1.5).toFixed(1)}" y="${(H - 22 - he).toFixed(1)}" width="${bw}" height="${Math.max(1, he).toFixed(1)}" rx="3" fill="${cssVar('--neg')}"/>`,
      `<text x="${x.toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="9.5" fill="${cssVar('--text-3')}">${formatDate(m.month + '-01', lang, { month: 'short' })}</text>`,
    );
  });

  return el('div', {
    html: `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Доходы и расходы по месяцам">
      <line x1="${pad}" y1="${H - 22}" x2="${W - pad}" y2="${H - 22}" stroke="${cssVar('--line')}" stroke-width="1"/>
      ${bars.join('')}
    </svg>`,
  });
}

/* ─────────── Экран «Обзор» ─────────── */

export function homeView(t, lang, rerender) {
  const s = D.S().settings;
  const book = s.book;
  const base = s.base;
  const from = ui.month, to = endOfMonth(ui.month);
  const stats = D.periodStats(book, from, to);
  const cats = D.byCategory(book, from, to, 'expense');
  const accounts = D.accountsOf(book);
  const due = D.dueRecurring(book);
  const today = toISODate();
  const todaySpent = D.periodStats(book, today, today).expense;

  const nodes = [bookSwitcher(t, rerender)];

  /* Главная карточка — остаток */
  const byCurrency = new Map();
  for (const a of accounts) {
    byCurrency.set(a.currency, (byCurrency.get(a.currency) || 0) + D.balanceOf(a.id));
  }
  const total = D.totalOf(book);

  const reserved = D.reservedTotal(book);
  const debtTotal = D.debtsTotal(book);

  nodes.push(el('div.card', {}, [
    el('div.card__title', { text: t('net_worth') }),
    el('div.amount.amount--xl.num' + (total < 0 ? '.neg' : ''), { text: formatMoney(total, base) }),
    byCurrency.size > 1 && el('div.hstack.small.muted', { style: { marginTop: '8px', flexWrap: 'wrap', gap: '12px' } },
      [...byCurrency].map(([cur, v]) => el('span.num', { text: `${cur}: ${formatMoney(v, cur, { decimals: 0 })}` }))),

    /* Отложенное на цели — не свободные деньги, и это должно быть видно
       рядом с остатком, а не в отдельном разделе. */
    reserved > 0 && el('div', { style: { marginTop: '12px', paddingTop: '12px',
      borderTop: '1px solid var(--line-soft)' } }, [
      el('div.hstack.small', {}, [
        el('span.muted', { text: t('reserved') }),
        el('div.spacer'),
        el('span.num.muted', { text: '−' + formatMoney(reserved, base, { decimals: 0 }) }),
      ]),
      el('div.hstack', { style: { marginTop: '6px' } }, [
        el('span.small', { style: { fontWeight: '620' }, text: t('free_money') }),
        el('div.spacer'),
        el('span.amount.num' + (total - reserved < 0 ? '.neg' : '.pos'),
           { style: { fontSize: '17px' }, text: formatMoney(total - reserved, base) }),
      ]),
    ]),

    /* Долги: без них «всего на счетах» показывает не ту картину */
    debtTotal > 0 && el('div', { style: { marginTop: '12px', paddingTop: '12px',
      borderTop: '1px solid var(--line-soft)' } }, [
      el('div.hstack.small', {}, [
        el('span.muted', { text: t('debt_total') }),
        el('div.spacer'),
        el('span.num.neg', { text: '−' + formatMoney(debtTotal, base, { decimals: 0 }) }),
      ]),
      el('div.hstack', { style: { marginTop: '6px' } }, [
        el('span.small', { style: { fontWeight: '620' }, text: t('net_worth_real') }),
        el('div.spacer'),
        el('span.amount.num' + (total - debtTotal < 0 ? '.neg' : ''),
           { style: { fontSize: '17px' }, text: formatMoney(total - debtTotal, base) }),
      ]),
    ]),
  ]));

  /* Месяц */
  nodes.push(monthNav(t, lang, rerender));
  nodes.push(el('div.grid.grid--3', {}, [
    statTile(t('month_income'), formatMoney(stats.income, base, { compact: true, decimals: 0 }), 'pos'),
    statTile(t('month_expense'), formatMoney(stats.expense, base, { compact: true, decimals: 0 }), 'neg'),
    statTile(t('month_net'), formatMoney(stats.net, base, { compact: true, sign: true, decimals: 0 }),
      stats.net >= 0 ? 'pos' : 'neg'),
  ]));

  if (todaySpent > 0) {
    nodes.push(el('div.card.card--flat.hstack', { style: { padding: '12px 14px' } }, [
      el('span.small.muted', { text: t('spent_today') }),
      el('div.spacer'),
      el('span.amount.num', { style: { fontSize: '16px' }, text: formatMoney(todaySpent, base, { decimals: 0 }) }),
    ]));
  }

  /* Регулярные платежи, которым настал срок */
  if (due.length) {
    nodes.push(el('div.card', { style: { borderColor: 'var(--warn)' } }, [
      el('div.card__head', {}, [
        el('div.card__title', { style: { color: 'var(--warn)' }, text: t('rec_due') }),
      ]),
      el('div.list', {}, due.map(r => el('div.row', {}, [
        el('div.avatar', { text: D.categoryById(r.category)?.icon || '🔁' }),
        el('div.row__main', {}, [
          el('div.row__title', { text: r.title }),
          el('div.row__sub', { text: formatDate(r.next, lang, { day: 'numeric', month: 'long' }) }),
        ]),
        el('div.hstack', { style: { gap: '6px' } }, [
          el('button.btn.btn--sm.btn--ghost', { text: t('rec_skip'),
            onclick: () => { D.skipRecurring(r.id); rerender(); } }),
          el('button.btn.btn--sm.btn--primary', { text: t('rec_post'),
            onclick: () => { D.postRecurring(r.id); haptic(18); toast(t('rec_posted')); rerender(); } }),
        ]),
      ]))),
    ]));
  }

  /* Куда уходят деньги */
  if (cats.rows.length) {
    nodes.push(el('div.card', {}, [
      el('div.card__head', {}, [el('div.card__title', { text: t('top_categories') })]),
      barList(cats.rows.slice(0, 5), base, t),
    ]));
  }

  /* Цели */
  const goals = D.goalsOf(book);
  if (goals.length) {
    nodes.push(el('div.card', {}, [
      el('div.card__head', {}, [
        el('div.card__title', { text: t('goal_title') }),
        el('button.btn.btn--sm.btn--ghost', { text: t('see_all'),
          onclick: () => goalsSheet({ t, lang, book, onDone: rerender }) }),
      ]),
      ...goals.slice(0, 3).map(g => goalRow(t, lang, g,
        (goal) => goalSheet({ t, lang, book, goal, onDone: rerender }))),
    ]));
  }

  /* Долги */
  const debts = D.debtsOf(book);
  if (debts.length) {
    nodes.push(el('div.card', {}, [
      el('div.card__head', {}, [
        el('div.card__title', { text: t('debt_title') }),
        el('button.btn.btn--sm.btn--ghost', { text: t('see_all'),
          onclick: () => debtsSheet({ t, lang, book, onDone: rerender }) }),
      ]),
      el('div.list', {}, debts.slice(0, 3).map(d => debtRow(t, lang, d,
        (debt) => debtSheet({ t, lang, book, debt, onDone: rerender })))),
    ]));
  }

  /* Счета */
  nodes.push(el('div.card', {}, [
    el('div.card__head', {}, [
      el('div.card__title', { text: t('accounts') }),
      el('button.btn.btn--sm.btn--ghost', { text: t('add'),
        onclick: () => accountForm({ t, book, onDone: rerender }) }),
    ]),
    accounts.length
      ? el('div.list', {}, accounts.map(a => {
          const bal = D.balanceOf(a.id);
          return el('button.row', { onclick: () => accountForm({ t, book, account: a, onDone: rerender }) }, [
            el('div.avatar', { style: { background: `color-mix(in srgb, var(${a.color}) 20%, transparent)` },
              html: icons.wallet }),
            el('div.row__main', {}, [
              el('div.row__title', { text: a.name }),
              el('div.row__sub', { text: `${t('acc_' + a.type)} · ${a.currency}` }),
            ]),
            el('div.row__end', {}, [
              el('div.amount.num' + (bal < 0 ? '.neg' : ''), { style: { fontSize: '15.5px' },
                text: formatMoney(bal, a.currency, { decimals: 2 }) }),
              a.currency !== base && el('div.tiny.muted-3.num', {
                text: '≈ ' + formatMoney(D.toBase(bal, a.currency), base, { decimals: 0 }) }),
            ]),
          ]);
        }))
      : emptyState('🏦', t('no_accounts'), t('no_accounts_hint'),
          el('button.btn.btn--primary', { text: t('add_account'),
            onclick: () => accountForm({ t, book, onDone: rerender }) })),
  ]));

  /* Последние операции */
  const recent = D.txOf(book).slice(0, 5);
  if (recent.length) {
    nodes.push(el('div.card', {}, [
      el('div.card__head', {}, [
        el('div.card__title', { text: t('recent') }),
        el('button.btn.btn--sm.btn--ghost', { text: t('see_all'),
          onclick: () => { location.hash = '#tx'; } }),
      ]),
      el('div.list', {}, recent.map(tx => txRow(t, lang, tx, rerender))),
    ]));
  }

  return nodes;
}

/* ─────────── Экран «Операции» ─────────── */

export function txView(t, lang, rerender) {
  const book = D.S().settings.book;
  const from = ui.month, to = endOfMonth(ui.month);
  const kind = ui.txFilter === 'all' ? null : ui.txFilter;
  const list = D.txOf(book, { from, to, kind, query: ui.txQuery });
  const stats = D.periodStats(book, from, to);
  const base = D.S().settings.base;

  const search = input({
    type: 'search', placeholder: t('search'), value: ui.txQuery,
    oninput: e => {
      ui.txQuery = e.target.value;
      // перерисовываем только список, чтобы не терять фокус в поле поиска
      const host = document.getElementById('tx-list');
      if (host) host.replaceChildren(...[].concat(
        txList(t, lang, D.txOf(book, { from, to, kind, query: ui.txQuery }), rerender)));
    },
  });

  return [
    bookSwitcher(t, rerender),
    monthNav(t, lang, rerender),
    el('div.grid.grid--3', {}, [
      statTile(t('month_income'), formatMoney(stats.income, base, { compact: true, decimals: 0 }), 'pos'),
      statTile(t('month_expense'), formatMoney(stats.expense, base, { compact: true, decimals: 0 }), 'neg'),
      statTile(t('month_net'), formatMoney(stats.net, base, { compact: true, sign: true, decimals: 0 }),
        stats.net >= 0 ? 'pos' : 'neg'),
    ]),
    search,
    segmented([
      { value: 'all', label: t('all') },
      { value: 'expense', label: t('tx_expense') },
      { value: 'income', label: t('tx_income') },
      { value: 'transfer', label: t('tx_transfer') },
    ], ui.txFilter, v => { ui.txFilter = v; rerender(); }),
    el('div#tx-list.stack', { style: { gap: '0' } }, [].concat(txList(t, lang, list, rerender))),
  ];
}

/* ─────────── Экран «Отчёты» ─────────── */

function periodRange(kind, anchor) {
  if (kind === 'month') return [startOfMonth(anchor), endOfMonth(anchor)];
  if (kind === 'quarter') {
    const m = Number(anchor.slice(5, 7));
    const qStart = anchor.slice(0, 4) + '-' + String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0') + '-01';
    return [qStart, endOfMonth(addMonths(qStart, 2))];
  }
  if (kind === 'year') return [anchor.slice(0, 4) + '-01-01', anchor.slice(0, 4) + '-12-31'];
  return ['1970-01-01', '2999-12-31'];
}

/** Тот же период, но предыдущий — для сравнения. */
function previousRange(kind, anchor) {
  const back = kind === 'year' ? -12 : kind === 'quarter' ? -3 : -1;
  return periodRange(kind, addMonths(anchor, back));
}

export function reportsView(t, lang, rerender) {
  const book = D.S().settings.book;
  const base = D.S().settings.base;
  const [from, to] = periodRange(ui.reportPeriod, ui.month);
  const stats = D.periodStats(book, from, to);
  const cats = D.byCategory(book, from, to, ui.reportKind);
  const series = D.monthlySeries(book, 6, ui.month);

  const monthsCount = Math.max(1, series.filter(m => m.count > 0).length);
  const avgExpense = series.reduce((s, m) => s + m.expense, 0) / monthsCount;

  const nodes = [
    bookSwitcher(t, rerender),
    segmented([
      { value: 'month', label: t('period_month') },
      { value: 'quarter', label: t('period_quarter') },
      { value: 'year', label: t('period_year') },
      { value: 'all', label: t('period_all') },
    ], ui.reportPeriod, v => { ui.reportPeriod = v; rerender(); }),
  ];

  if (ui.reportPeriod !== 'all') nodes.push(monthNav(t, lang, rerender));

  if (!stats.count) {
    nodes.push(emptyState('📊', t('no_data_period'), ''));
    return nodes;
  }

  /* Прибыль/убыток */
  nodes.push(el('div.card', {}, [
    el('div.card__title', { text: book === 'empresa' ? t('report_pl') : t('report_cashflow') }),
    el('div.amount.amount--xl.num' + (stats.net >= 0 ? '.pos' : '.neg'),
      { text: formatMoney(stats.net, base, { sign: true }) }),
    el('div.small.muted', { style: { marginTop: '4px' },
      text: stats.net >= 0 ? t('profit') : t('loss') }),
    el('div.grid.grid--2', { style: { marginTop: '14px' } }, [
      statTile(t('month_income'), formatMoney(stats.income, base, { decimals: 0 }), 'pos'),
      statTile(t('month_expense'), formatMoney(stats.expense, base, { decimals: 0 }), 'neg'),
    ]),
  ]));

  /* Не разнесённое по категориям: без этого отчёт по категориям
     показывает не все деньги, а причина остаётся невидимой. */
  const noCat = cats.rows.find(r => r.id === '__none');
  if (noCat && ui.reportKind === 'expense') {
    nodes.push(el('div.card', { style: { borderColor: 'var(--warn)' } }, [
      el('div.hstack', {}, [
        el('div', { style: { flex: '1', minWidth: '0' } }, [
          el('div.small', { style: { fontWeight: '620', color: 'var(--warn)' }, text: t('unaccounted') }),
          el('div.tiny.muted-3', { style: { marginTop: '3px' },
            text: t('unaccounted_hint', { n: noCat.count }) }),
        ]),
        el('div.amount.num', { style: { fontSize: '16px' },
          text: formatMoney(noCat.total, base, { decimals: 0 }) }),
      ]),
      el('button.btn.btn--sm.btn--ghost.btn--block', {
        style: { marginTop: '10px' },
        text: t('unaccounted_fix'),
        onclick: () => { ui.txFilter = 'expense'; ui.txQuery = ''; location.hash = '#tx'; },
      }),
    ]));
  }

  /* Помесячная динамика */
  nodes.push(el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('report_by_month') })]),
    monthlyChart(series, base, lang),
    el('div.hstack.tiny.muted-3', { style: { justifyContent: 'center', gap: '16px', marginTop: '2px' } }, [
      el('span', { text: '■ ' + t('month_income'), style: { color: 'var(--pos)' } }),
      el('span', { text: '■ ' + t('month_expense'), style: { color: 'var(--neg)' } }),
    ]),
    el('div.hstack.small.muted', { style: { marginTop: '10px' } }, [
      el('span', { text: t('avg_month') }),
      el('div.spacer'),
      el('span.num', { style: { fontWeight: '620' }, text: formatMoney(Math.round(avgExpense), base, { decimals: 0 }) }),
    ]),
  ]));

  nodes.push(monthTable(t, lang, book, base));

  /* По категориям */
  nodes.push(el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('report_by_category') })]),
    segmented([
      { value: 'expense', label: t('tx_expense') },
      { value: 'income', label: t('tx_income') },
    ], ui.reportKind, v => { ui.reportKind = v; rerender(); }),
    el('div', { style: { height: '12px' } }),
    cats.rows.length
      ? barList(cats.rows, base, t, D.byCategory(book, ...previousRange(ui.reportPeriod, ui.month), ui.reportKind))
      : el('p.muted.small', { text: t('nothing_yet') }),
    cats.rows.length && el('p.tiny.muted-3', { style: { marginTop: '10px' }, text: t('vs_prev') }),
  ]));

  /* Крупнейшие расходы */
  const biggest = D.txOf(book, { from, to, kind: 'expense' })
    .sort((a, b) => D.toBase(b.amount, b.currency) - D.toBase(a.amount, a.currency))
    .slice(0, 5);
  if (biggest.length) {
    nodes.push(el('div.card', {}, [
      el('div.card__head', {}, [el('div.card__title', { text: t('biggest') })]),
      el('div.list', {}, biggest.map(tx => txRow(t, lang, tx, rerender))),
    ]));
  }

  return nodes;
}

/* ─────────── Экран «Ещё» (настройки) ─────────── */

export function settingsView(t, lang, rerender, i18n) {
  const s = D.S().settings;
  const book = s.book;

  const nodes = [bookSwitcher(t, rerender)];

  /* Общий доступ с другого устройства */
  nodes.push(cloudCard({ t, runner, rerender }));

  /* Установка на телефон */
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

  /* Справочники */
  nodes.push(el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('data') })]),
    el('div.list', {}, [
      navRow('👛', t('books_title'), () => booksSheet(t, rerender)),
      navRow('🎯', t('goal_title'), () => goalsSheet({ t, lang, book, onDone: rerender })),
      navRow('💳', t('debt_title'), () => debtsSheet({ t, lang, book, onDone: rerender })),
      navRow('🏦', t('accounts'), () => accountsSheet(t, book, rerender)),
      navRow('📥', t('imp_menu'), () => importSheet({ t, lang, book, onDone: rerender })),
      navRow('🏷️', t('categories'), () => categoriesSheet(t, book, rerender)),
      navRow('🔁', t('recurring'), () => recurringSheet(t, lang, book, rerender)),
      book === 'empresa' && navRow('🧾', t('nom_menu'), () => nominaSheet({ t, lang, onDone: rerender })),
    ]),
  ]));

  /* ИИ-помощник */
  nodes.push(aiCard(t, rerender));

  /* Деньги */
  nodes.push(el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('fx') })]),
    field(t('base_currency'), select(
      ['MXN', 'USD'].map(v => ({ value: v, label: `${v} — ${CURRENCIES[v].name}` })),
      { value: s.base, onchange: e => { D.store.update(st => { st.settings.base = e.target.value; }); rerender(); } })),
    el('div.tiny.muted-3', { style: { margin: '4px 0 12px' }, text: t('base_hint') }),
    field(t('fx_rate'), input({
      inputmode: 'decimal', value: String(s.fx.USD ?? ''),
      onchange: e => {
        // курс держим с точностью до сотых долей сентаво — деньги здесь не при чём
        const v = Number(String(e.target.value).replace(',', '.').replace(/[^\d.]/g, ''));
        if (v > 0) D.store.update(st => {
          st.settings.fx.USD = v;
          st.settings.fxUpdated = toISODate();
          st.settings.fxSource = null;
          st.settings.fxAuto = false;      // свой курс важнее автоматического
        });
        rerender();
      },
    })),
    el('div.tiny.muted-3', { style: { marginTop: '4px' }, text: t('fx_hint') }),

    el('div.switch-row', { style: { marginTop: '10px' } }, [
      el('span.small', { text: t('fx_auto') }),
      el('label.switch', {}, [
        el('input', {
          type: 'checkbox', checked: s.fxAuto !== false,
          onchange: e => {
            D.store.update(st => { st.settings.fxAuto = e.target.checked; });
            rerender();
          },
        }),
        el('span'),
      ]),
    ]),
    el('div.tiny.muted-3', { text: t('fx_auto_hint') }),
    s.fxSource && el('div.tiny.muted-3', { style: { marginTop: '4px' },
      text: `${s.fxSource}${s.fxUpdated ? ' · ' + s.fxUpdated : ''}` }),
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
  ]));

  /* Копии */
  nodes.push(el('div.card', {}, [
    el('div.card__head', {}, [el('div.card__title', { text: t('backup') })]),
    el('p.tiny.muted-3', { style: { marginBottom: '12px' }, text: t('backup_hint') }),
    el('div.stack', { style: { gap: '9px' } }, [
      el('button.btn.btn--ghost.btn--block', { text: t('export'), onclick: () => {
        downloadFile(`milpa-${toISODate()}.json`, D.store.export());
        toast(t('export_done'));
      } }),
      el('button.btn.btn--ghost.btn--block', { text: t('export_csv'), onclick: () => {
        downloadFile(`milpa-${book}-${toISODate()}.csv`, D.toCSV(book), 'text/csv');
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

  nodes.push(versionCard(t));

  return nodes;
}

/* В списке могут быть false (пункты только для одной книги) — их отсеивает mount */
/** Настройка распознавания чеков. Ключ хранится отдельно от остальных
    данных и намеренно не попадает в резервные копии. */
function aiCard(t, rerender) {
  const keyInput = input({
    type: 'password',
    value: getKey(),
    placeholder: 'sk-ant-...',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    oninput: e => setKey(e.target.value),
  });

  const status = el('div.tiny.muted-3', { style: { marginTop: '8px' } });

  return el('div.card', { style: hasKey() ? {} : { borderColor: 'var(--line)' } }, [
    el('div.card__head', {}, [el('div.card__title', { text: t('ai_title') })]),
    el('p.small.muted', { style: { marginBottom: '12px' }, text: t('ai_what') }),

    field(t('ai_key'), keyInput),

    el('div.hstack', { style: { gap: '8px', marginTop: '10px' } }, [
      el('button.btn.btn--sm.btn--ghost', {
        text: t('ai_test'),
        onclick: async (e) => {
          const btn = e.target;
          btn.disabled = true;
          status.textContent = t('ai_testing');
          const res = await testKey(keyInput.value);
          btn.disabled = false;
          if (res.ok) {
            status.textContent = '✅ ' + t('ai_key_ok');
            status.style.color = 'var(--pos)';
            toast(t('saved'));
          } else {
            status.textContent = '⚠️ ' + aiMessage(t, { code: res.code, message: res.detail });
            status.style.color = 'var(--neg)';
          }
        },
      }),
      hasKey() && el('button.btn.btn--sm.btn--ghost', {
        text: t('ai_forget'),
        onclick: () => { setKey(''); toast(t('deleted')); rerender(); },
      }),
    ]),
    status,

    el('p.tiny.muted-3', { style: { marginTop: '14px', lineHeight: '1.5' }, text: t('ai_cost') }),
    el('p.tiny.muted-3', { style: { marginTop: '6px', lineHeight: '1.5' }, text: t('ai_privacy') }),
    el('p.tiny.muted-3', { style: { marginTop: '6px', lineHeight: '1.5' }, text: t('ai_where_key') }),
  ]);
}


/** Версия и принудительное обновление: без этого «у меня ничего не
    изменилось» невозможно ни проверить, ни починить. */
function versionCard(t) {
  const when = BUILT_AT
    ? new Date(BUILT_AT).toLocaleString([], { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : t('ver_dev');

  return el('div.card.card--flat', {}, [
    el('div.hstack', {}, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div.tiny.muted-3', { text: t('ver_title') }),
        el('div.small', { style: { fontWeight: '600', marginTop: '2px' }, text: when }),
      ]),
      el('button.btn.btn--sm.btn--ghost', {
        text: t('ver_update'),
        onclick: async (e) => { e.target.disabled = true; e.target.textContent = t('ver_checking'); await forceUpdate(); },
      }),
    ]),
    el('p.tiny.muted-3', { style: { marginTop: '8px' }, text: t('ver_hint') }),
  ]);
}

function navRow(emoji, title, onclick) {
  return el('button.row', { onclick }, [
    el('div.avatar', { text: emoji }),
    el('div.row__main', {}, [el('div.row__title', { text: title })]),
    el('span.muted-3', { html: icons.chevR }),
  ]);
}

/* ─────────── Списки-справочники ─────────── */

function accountsSheet(t, book, rerender) {
  let s;
  const render = () => {
    const list = D.accountsOf(book, { withArchived: true });
    return [
      el('div.list', {}, list.map(a => el('button.row', {
        onclick: () => accountForm({ t, book, account: a, onDone: () => { s.close(); rerender(); } }),
      }, [
        el('div.avatar', { style: { background: `color-mix(in srgb, var(${a.color}) 20%, transparent)`,
          opacity: a.archived ? '.45' : '1' }, html: icons.wallet }),
        el('div.row__main', {}, [
          el('div.row__title', { text: a.name + (a.archived ? ` · ${t('account_archived')}` : '') }),
          el('div.row__sub', { text: `${t('acc_' + a.type)} · ${a.currency}` }),
        ]),
        el('div.amount.num.small', { text: formatMoney(D.balanceOf(a.id), a.currency, { decimals: 0 }) }),
      ]))),
      el('button.btn.btn--primary.btn--block', { text: t('add_account'),
        onclick: () => accountForm({ t, book, onDone: () => { s.close(); rerender(); } }) }),
    ];
  };
  s = sheet({ title: t('accounts'), body: render() });
}

/** Переименование двух кошельков — личного и по компании. */
function booksSheet(t, rerender) {
  const fields = D.BOOKS.map(id => {
    const node = input({
      value: D.bookName(id, t),
      enterkeyhint: 'done',
      onchange: e => {
        D.setBookName(id, e.target.value);
        // пустое поле хранилище заменяет значением по умолчанию — покажем его
        e.target.value = D.bookName(id, t);
        rerender();
      },
    });
    return el('label.field', {}, [
      el('span.label', { text: `${D.S().books.find(b => b.id === id)?.icon || ''} ${t('book_' + id)}` }),
      node,
    ]);
  });

  sheet({
    title: t('books_title'),
    body: [
      el('p.tiny.muted-3', { text: t('books_hint') }),
      ...fields,
    ],
  });
}

function categoriesSheet(t, book, rerender) {
  let s;
  const body = el('div.stack');
  let kind = 'expense';

  function paint() {
    const list = D.categoriesOf(book, kind);
    body.replaceChildren(
      segmented([
        { value: 'expense', label: t('tx_expense') },
        { value: 'income', label: t('tx_income') },
      ], kind, v => { kind = v; paint(); }),
      el('div.list', {}, list.map(c => el('button.row', {
        onclick: () => categoryForm({ t, book, category: c, onDone: () => { paint(); rerender(); } }),
      }, [
        el('div.avatar', { style: { background: `color-mix(in srgb, var(${c.color}) 20%, transparent)` },
          text: c.icon }),
        el('div.row__main', {}, [
          el('div.row__title', { text: c.name }),
          el('div.row__sub', { text: t('n_ops', { n: D.txCountForCategory(c.id) }) }),
        ]),
        el('span.muted-3', { html: icons.chevR }),
      ]))),
      el('button.btn.btn--primary.btn--block', { text: t('add_category'),
        onclick: () => categoryForm({ t, book, kind, onDone: () => { paint(); rerender(); } }) }),
    );
  }
  paint();
  s = sheet({ title: t('categories'), body: [body] });
}

function recurringSheet(t, lang, book, rerender) {
  let s;
  const body = el('div.stack');

  function paint() {
    const list = D.S().recurring.filter(r => r.book === book);
    body.replaceChildren(
      list.length
        ? el('div.list', {}, list.map(r => el('button.row', {
            onclick: () => recurringForm({ t, book, rec: r, onDone: () => { paint(); rerender(); } }),
          }, [
            el('div.avatar', { text: D.categoryById(r.category)?.icon || '🔁' }),
            el('div.row__main', {}, [
              el('div.row__title', { text: r.title }),
              el('div.row__sub', { text: `${t('rec_next')}: ${formatDate(r.next, lang, { day: 'numeric', month: 'long' })}` }),
            ]),
            el('div.amount.num.small' + (r.kind === 'income' ? '.pos' : ''), {
              text: (r.kind === 'income' ? '+' : '−') + formatMoney(r.amount, r.currency, { decimals: 0 }).replace('−', '') }),
          ])))
        : emptyState('🔁', t('rec_none'), t('rec_none_hint')),
      el('button.btn.btn--primary.btn--block', { text: t('add_recurring'),
        onclick: () => recurringForm({ t, book, onDone: () => { paint(); rerender(); } }) }),
    );
  }
  paint();
  s = sheet({ title: t('recurring'), body: [body] });
}
