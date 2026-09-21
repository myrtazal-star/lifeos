/* Загрузка банковской выписки: файл → разметка колонок → проверка → запись.
   Формат у каждого банка свой, поэтому ничего не угадывается молча:
   предположение показывается, пользователь его подтверждает или правит. */

import { el, sheet, toast, haptic, field, select, segmented, pickFile }
  from './shared/js/ui.js';
import { formatMoney, relativeDay } from './shared/js/format.js';
import { decodeBytes, parseTable, findHeaderRow, guessMapping,
         buildTransactions, fingerprint } from './csv.js';
import * as D from './data.js';

const st = {
  fileName: null,
  rows: [],
  headerRow: 0,
  mapping: null,
  dayFirst: true,
  accountId: null,
};

export function importSheet({ t, lang, book, onDone }) {
  let s;
  const body = el('div.stack');

  const accounts = D.accountsOf(book);
  if (!accounts.length) { toast(t('no_accounts'), { error: true }); return; }
  if (!st.accountId || !accounts.some(a => a.id === st.accountId)) {
    st.accountId = accounts[0].id;
  }

  async function choose() {
    const file = await pickFile('.csv,.txt,text/csv,text/plain');
    if (!file) return;

    const text = decodeBytes(file.buffer);
    const { rows } = parseTable(text);
    if (!rows.length) { toast(t('imp_empty'), { error: true }); return; }

    st.fileName = file.name;
    st.rows = rows;
    st.headerRow = findHeaderRow(rows);

    // если для этого счёта уже загружали — берём прошлую разметку
    const saved = D.S().settings.importProfiles?.[st.accountId];
    const dataRows = rows.slice(st.headerRow + 1);
    const headers = st.headerRow >= 0 ? rows[st.headerRow]
                                      : rows[0].map((_, i) => t('imp_col', { n: i + 1 }));
    st.mapping = saved?.mapping ?? guessMapping(headers, dataRows);
    st.dayFirst = saved?.dayFirst ?? true;

    render();
  }

  function headers() {
    if (!st.rows.length) return [];
    return st.headerRow >= 0
      ? st.rows[st.headerRow]
      : st.rows[0].map((_, i) => t('imp_col', { n: i + 1 }));
  }

  function dataRows() { return st.rows.slice(st.headerRow + 1); }

  /** Разбор с текущей разметкой + отделение повторов от новых. */
  function analyse() {
    const { transactions, skipped } = buildTransactions(dataRows(), st.mapping, { dayFirst: st.dayFirst });

    const existing = new Set(
      D.S().tx
        .filter(x => x.account === st.accountId)
        .map(x => fingerprint({ date: x.date, kind: x.kind, amount: x.amount, note: x.note }))
    );

    const seenInFile = new Set();
    const fresh = [], duplicates = [];
    for (const tx of transactions) {
      const fp = fingerprint(tx);
      if (existing.has(fp) || seenInFile.has(fp)) duplicates.push(tx);
      else { seenInFile.add(fp); fresh.push(tx); }
    }
    return { fresh, duplicates, skipped };
  }

  function colSelect(key) {
    const opts = [{ value: '-1', label: '— ' + t('none') + ' —' },
      ...headers().map((h, i) => ({ value: String(i), label: h || t('imp_col', { n: i + 1 }) }))];
    return select(opts, {
      value: String(st.mapping[key] ?? -1),
      onchange: e => { st.mapping[key] = Number(e.target.value); render(); },
    });
  }

  function render() {
    if (!st.rows.length) {
      body.replaceChildren(
        el('p.muted.small', { text: t('imp_intro') }),
        el('button.btn.btn--primary.btn--block', { text: t('imp_choose'), onclick: choose }),
        el('p.tiny.muted-3', { text: t('imp_where') }),
      );
      return;
    }

    const { fresh, duplicates, skipped } = analyse();
    const account = D.accountById(st.accountId);
    const hasSplitColumns = st.mapping.debit > -1 || st.mapping.credit > -1;

    const parts = [
      el('div.card.card--flat', {}, [
        el('div.hstack', {}, [
          el('div.small', { style: { fontWeight: '600' }, text: st.fileName }),
          el('div.spacer'),
          el('button.btn.btn--sm.btn--ghost', { text: t('imp_other_file'), onclick: choose }),
        ]),
        el('div.tiny.muted-3', { style: { marginTop: '4px' },
          text: t('imp_rows', { n: dataRows().length }) }),
      ]),

      field(t('imp_account'), select(
        accounts.map(a => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
        { value: st.accountId, onchange: e => { st.accountId = e.target.value; render(); } })),

      el('div.section-title', { text: t('imp_columns') }),
      field(t('date'), colSelect('date')),
      field(t('imp_desc'), colSelect('desc')),

      el('div.field', {}, [
        el('span.label', { text: t('imp_amount_mode') }),
        segmented([
          { value: 'single', label: t('imp_one_column') },
          { value: 'split', label: t('imp_two_columns') },
        ], hasSplitColumns ? 'split' : 'single', v => {
          if (v === 'single') { st.mapping.debit = -1; st.mapping.credit = -1; }
          else { st.mapping.amount = -1; }
          render();
        }),
      ]),
    ];

    if (hasSplitColumns) {
      parts.push(field(t('imp_debit'), colSelect('debit')));
      parts.push(field(t('imp_credit'), colSelect('credit')));
    } else {
      parts.push(field(t('imp_amount_col'), colSelect('amount')));
    }

    parts.push(
      el('div.field', {}, [
        el('span.label', { text: t('imp_date_order') }),
        segmented([
          { value: 'dmy', label: '31/12/2026' },
          { value: 'mdy', label: '12/31/2026' },
        ], st.dayFirst ? 'dmy' : 'mdy', v => { st.dayFirst = v === 'dmy'; render(); }),
      ]),

      /* Итог разбора */
      el('div.grid.grid--3', {}, [
        tile(t('imp_new'), String(fresh.length), 'pos'),
        tile(t('imp_dupes'), String(duplicates.length)),
        tile(t('imp_skipped'), String(skipped.length), skipped.length ? 'neg' : ''),
      ]),
    );

    if (!fresh.length && !duplicates.length) {
      parts.push(el('div.card', { style: { borderColor: 'var(--warn)' } }, [
        el('p.small', { style: { color: 'var(--warn)' }, text: '⚠️ ' + t('imp_nothing_parsed') }),
      ]));
    }

    /* Что именно будет записано */
    if (fresh.length) {
      parts.push(el('div.section-title', { text: t('imp_preview') }));
      parts.push(el('div.card', {}, [
        el('div.list', {}, fresh.slice(0, 6).map(tx => el('div.row', {}, [
          el('div.row__main', {}, [
            el('div.row__title', { text: tx.note || '—' }),
            el('div.row__sub', { text: relativeDay(tx.date, lang, t) }),
          ]),
          el('div.amount.num', {
            class: tx.kind === 'income' ? 'pos' : '',
            style: { fontSize: '15px' },
            text: (tx.kind === 'income' ? '+' : '−') +
                  formatMoney(tx.amount, account.currency, { decimals: 2 }).replace('−', ''),
          }),
        ]))),
        fresh.length > 6 && el('div.tiny.muted-3', { style: { paddingTop: '8px' },
          text: t('imp_and_more', { n: fresh.length - 6 }) }),
      ]));
    }

    if (skipped.length) {
      parts.push(el('div.card.card--flat', {}, [
        el('div.tiny.muted-3', { text: t('imp_skipped_hint') }),
        ...skipped.slice(0, 3).map(sk => el('div.tiny.muted-3', {
          style: { marginTop: '4px', fontFamily: 'var(--mono)', opacity: '.7' },
          text: sk.row.join(' | ').slice(0, 70),
        })),
      ]));
    }

    parts.push(el('button.btn.btn--primary.btn--block', {
      text: fresh.length ? t('imp_do', { n: fresh.length }) : t('imp_nothing_to_add'),
      disabled: !fresh.length,
      onclick: () => runImport(fresh),
    }));

    body.replaceChildren(...parts.filter(Boolean));
  }

  function runImport(fresh) {
    const account = D.accountById(st.accountId);
    for (const tx of fresh) {
      D.addTx({
        book, kind: tx.kind, date: tx.date,
        amount: tx.amount, currency: account.currency,
        account: st.accountId, category: null,
        party: '', note: tx.note,
      });
    }

    // запоминаем разметку — в следующий раз тот же банк загрузится сразу
    D.store.update(state => {
      if (!state.settings.importProfiles) state.settings.importProfiles = {};
      state.settings.importProfiles[st.accountId] = {
        mapping: st.mapping, dayFirst: st.dayFirst,
      };
    });

    haptic(20);
    st.rows = []; st.fileName = null;
    s.close();
    toast(t('imp_done', { n: fresh.length }));
    onDone?.();
  }

  render();
  s = sheet({ title: t('imp_title'), body: [body], onClose: () => { st.rows = []; st.fileName = null; } });
}

function tile(label, value, cls = '') {
  return el('div.card.card--flat', { style: { padding: '12px' } }, [
    el('div.tiny.muted-3', { text: label }),
    el('div.amount.num' + (cls ? '.' + cls : ''), { style: { fontSize: '19px', marginTop: '2px' }, text: value }),
  ]);
}
