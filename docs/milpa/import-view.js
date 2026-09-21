/* Загрузка банковской выписки: файл → разметка колонок → проверка → запись.
   Формат у каждого банка свой, поэтому ничего не угадывается молча:
   предположение показывается, пользователь его подтверждает или правит. */

import { el, sheet, toast, haptic, field, select, segmented, pickFile, icons }
  from './shared/js/ui.js';
import { formatMoney, relativeDay } from './shared/js/format.js';
import { decodeBytes, parseTable, findHeaderRow, guessMapping,
         buildTransactions, fingerprint } from './csv.js';
import { looksLikeZip, listZip, pickStatement, supported as zipSupported } from './zip.js';
import { hasKey, readStatement, pdfToBase64, aiMessage, PDF_MAX_BYTES } from './ai.js';
import { collectCfdi, guessOwnRfc, looksLikeCfdi } from './cfdi.js';
import * as D from './data.js';

const st = {
  mode: 'table',     // table — разбор таблицы, pdf — список из выписки
  fileName: null,
  rows: [],
  headerRow: 0,
  mapping: null,
  dayFirst: true,
  accountId: null,
  busy: false,
  aiRows: [],        // [{ tx, include, duplicate }]
  aiInfo: null,
  cfdiSkipped: 0,
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
    // Без фильтра по типу: на iPhone он прячет часть файлов, в том числе
    // архивы, скачанные из банка.
    const file = await pickFile();
    if (!file) return;

    const bytes = new Uint8Array(file.buffer);
    if (isPdf(bytes) || /\.pdf$/i.test(file.name || '')) {
      await readPdf(file);
      return;
    }

    const unpacked = await unwrap(file);
    if (!unpacked) return;

    const text = decodeBytes(unpacked.buffer);
    const { rows } = parseTable(text);
    if (!rows.length) { toast(t('imp_empty'), { error: true }); return; }

    st.mode = 'table';
    st.fileName = unpacked.name;
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

  /** Архив распаковываем, неподходящие форматы объясняем словами. */
  async function unwrap(file) {
    const bytes = new Uint8Array(file.buffer);
    const name = file.name || '';


    if (!looksLikeZip(bytes)) {
      if (/\.xls$/i.test(name)) { toast(t('imp_excel'), { error: true, ms: 8000 }); return null; }
      return { buffer: file.buffer, name };
    }

    if (!zipSupported()) { toast(t('imp_zip_old'), { error: true, ms: 8000 }); return null; }

    let entries;
    try { entries = listZip(file.buffer); }
    catch { toast(t('imp_zip_bad'), { error: true, ms: 6000 }); return null; }

    // файлы Excel устроены как архив — отличаем их по содержимому
    if (entries.some(e => e.name === '[Content_Types].xml' || e.name.startsWith('xl/'))) {
      toast(t('imp_excel'), { error: true, ms: 8000 });
      return null;
    }

    /* Архив с портала SAT: внутри десятки XML со счетами-фактурами.
       Это не выписка, и разбирать его надо иначе — точно, а не угадыванием. */
    const xmls = entries.filter(e => /\.xml$/i.test(e.name));
    if (xmls.length) {
      await readCfdiPack(xmls, name);
      return null;
    }

    const tables = entries.filter(e => /\.(csv|txt)$/i.test(e.name));
    if (!tables.length) {
      const inside = entries.map(e => e.name).slice(0, 4).join(', ') || '—';
      toast(t('imp_zip_empty', { files: inside }), { error: true, ms: 9000 });
      return null;
    }

    const chosen = tables.length === 1 ? tables[0] : await askWhich(tables);
    if (!chosen) return null;

    try {
      const buffer = await chosen.read();
      return { buffer, name: `${name} → ${chosen.name}` };
    } catch {
      toast(t('imp_zip_bad'), { error: true, ms: 6000 });
      return null;
    }
  }

  const isPdf = (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

  /** Если в архиве несколько таблиц — спрашиваем, какая нужна. */
  function askWhich(entries) {
    return new Promise(resolve => {
      let picked = null;
      const inner = sheet({
        title: t('imp_which_file'),
        body: [
          el('p.tiny.muted-3', { text: t('imp_which_hint') }),
          el('div.list', {}, entries.map(e => el('button.row', {
            onclick: () => { picked = e; inner.close(); },
          }, [
            el('div.avatar', { text: '📄' }),
            el('div.row__main', {}, [
              el('div.row__title', { text: e.name }),
              el('div.row__sub', { text: `${Math.max(1, Math.round(e.size / 1024))} КБ` }),
            ]),
          ]))),
        ],
        onClose: () => resolve(picked),
      });
    });
  }

  /* ─────── Счета-фактуры из архива SAT ─────── */

  async function readCfdiPack(entries, archiveName) {
    st.mode = 'pdf';          // тот же экран проверки списком
    st.fileName = archiveName;
    st.busy = true;
    st.aiRows = [];
    st.aiInfo = null;
    render();

    try {
      const files = [];
      for (const e of entries) {
        const buffer = await e.read();
        files.push({ name: e.name, xml: decodeBytes(buffer) });
      }

      const mine = files.filter(f => looksLikeCfdi(f.xml));
      if (!mine.length) {
        st.mode = 'table';
        toast(t('cfdi_none'), { error: true, ms: 7000 });
        return;
      }

      /* Налоговый номер определяет, какой счёт доход, а какой расход.
         Если он не задан, берём самый частый в пачке: собственный RFC
         стоит в каждом документе, чужие — по одному разу. */
      let rfc = D.bookRfc(book);
      if (!rfc) {
        const guess = guessOwnRfc(mine);
        if (guess.length) { rfc = guess[0].rfc; D.setBookRfc(book, rfc); }
      }

      const { rows, skipped } = collectCfdi(mine, rfc);
      const known = D.knownCfdiUuids(book);

      st.cfdiSkipped = skipped.length;
      st.aiRows = rows.map(doc => {
        const duplicate = !!doc.uuid && known.has(doc.uuid);
        return {
          tx: {
            date: doc.date, kind: doc.kind, amount: doc.total,
            merchant: doc.counterparty.name || doc.counterparty.rfc,
            note: doc.note || doc.counterparty.name,
            category: '', confidence: 'high',
            uuid: doc.uuid, rfc: doc.counterparty.rfc,
            iva: doc.iva, cfdiType: doc.type,
            currency: doc.currency,
          },
          include: !duplicate,
          duplicate,
        };
      });
      st.aiInfo = {
        period: t('cfdi_from_sat', { rfc }),
        account: '',
        currency: rows[0]?.currency || null,
        cfdi: true,
      };

      if (!st.aiRows.length) {
        st.mode = 'table';
        toast(t('cfdi_none'), { error: true, ms: 7000 });
      }
    } catch (e) {
      st.mode = 'table';
      toast(t('imp_zip_bad'), { error: true, ms: 6000 });
    } finally {
      st.busy = false;
      render();
    }
  }

  /* ─────── Выписка в PDF ─────── */

  async function readPdf(file) {
    if (!hasKey()) { toast(t('imp_pdf_no_key'), { error: true, ms: 7000 }); return; }
    if (file.buffer.byteLength > PDF_MAX_BYTES) {
      toast(t('imp_pdf_big'), { error: true, ms: 7000 });
      return;
    }

    st.mode = 'pdf';
    st.fileName = file.name;
    st.busy = true;
    st.aiRows = [];
    st.aiInfo = null;
    render();

    try {
      const result = await readStatement({
        base64: pdfToBase64(file.buffer),
        categories: D.categoriesOf(book).map(c => c.name),
        bookName: D.bookName(book, t),
      });

      if (!result.readable || !result.transactions.length) {
        st.mode = 'table';
        toast(result.problem || t('imp_pdf_nothing'), { error: true, ms: 8000 });
        return;
      }

      const existing = existingFingerprints();
      const seen = new Set();
      st.aiRows = result.transactions.map(tx => {
        const fp = fingerprint(tx);
        const duplicate = existing.has(fp) || seen.has(fp);
        seen.add(fp);
        // повторы по умолчанию не записываем, остальное — записываем
        return { tx, include: !duplicate, duplicate };
      });
      st.aiInfo = result;

      // валюту задаёт счёт: подберём подходящий, если он есть
      if (result.currency) {
        const current = D.accountById(st.accountId)?.currency;
        if (current !== result.currency) {
          const match = accounts.find(a => a.currency === result.currency);
          if (match) st.accountId = match.id;
        }
      }
    } catch (e) {
      st.mode = 'table';
      toast(aiMessage(t, e), { error: true, ms: 8000 });
    } finally {
      st.busy = false;
      render();
    }
  }

  function existingFingerprints() {
    return new Set(
      D.S().tx
        .filter(x => x.account === st.accountId && !x.deleted)
        .map(x => fingerprint({ date: x.date, kind: x.kind, amount: x.amount, note: x.note }))
    );
  }

  function renderPdf() {
    if (st.busy) {
      body.replaceChildren(
        el('div.empty', {}, [
          el('div.empty__icon', { text: '📄' }),
          el('div.empty__title', { text: t('imp_pdf_reading') }),
          el('div.empty__text', { text: t('imp_pdf_wait') }),
        ]),
      );
      return;
    }

    const chosen = st.aiRows.filter(r => r.include);
    const account = D.accountById(st.accountId);
    const dupes = st.aiRows.filter(r => r.duplicate).length;

    const header = el('div.card.card--flat', {}, [
      el('div.hstack', {}, [
        el('div.small', { style: { fontWeight: '600' }, text: st.fileName }),
        el('div.spacer'),
        el('button.btn.btn--sm.btn--ghost', { text: t('imp_other_file'), onclick: choose }),
      ]),
      st.aiInfo?.period && el('div.tiny.muted-3', { style: { marginTop: '4px' },
        text: st.aiInfo.period + (st.aiInfo.account ? ' · ' + st.aiInfo.account : '') }),
      st.aiInfo?.cfdi && st.cfdiSkipped > 0 && el('div.tiny.muted-3', { style: { marginTop: '3px' },
        text: t('cfdi_skipped', { n: st.cfdiSkipped }) }),
    ]);

    const rows = st.aiRows.map((row, i) => {
      const { tx, include, duplicate } = row;
      return el('button.row', {
        style: { opacity: include ? '1' : '.45' },
        onclick: () => { row.include = !row.include; render(); },
      }, [
        el('div', {
          style: {
            width: '26px', height: '26px', flex: '0 0 auto', borderRadius: '8px',
            display: 'grid', placeItems: 'center',
            background: include ? 'var(--accent)' : 'transparent',
            border: include ? 'none' : '2px solid var(--line)',
            color: include ? 'var(--accent-ink)' : 'transparent',
          },
          html: icons.check,
        }),
        el('div.row__main', {}, [
          el('div.row__title', { text: tx.note || tx.merchant || '—' }),
          el('div.row__sub', {
            // контрагента показываем отдельно: в счёте-фактуре «кто» важнее
            // описания товара, а в заголовок помещается только одно
            text: [relativeDay(tx.date, lang, t),
                   tx.merchant && tx.merchant !== tx.note ? tx.merchant : null,
                   duplicate ? t('imp_already') : null]
              .filter(Boolean).join(' · '),
          }),
        ]),
        // пометку о плохом чтении держим у суммы: в подписи её обрезает
        tx.confidence === 'low' && el('span', {
          title: t('imp_unsure'),
          style: { color: 'var(--warn)', flex: '0 0 auto', fontSize: '14px' },
          text: '⚠',
        }),
        el('div.amount.num', {
          class: tx.kind === 'income' ? 'pos' : '',
          style: { fontSize: '15px' },
          text: (tx.kind === 'income' ? '+' : '−') +
                formatMoney(tx.amount, account.currency, { decimals: 2 }).replace('−', ''),
        }),
      ]);
    });

    body.replaceChildren(
      header,

      field(t('imp_account'), select(
        accounts.map(a => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
        { value: st.accountId, onchange: e => {
            st.accountId = e.target.value;
            // при смене счёта повторы считаются заново
            const existing = existingFingerprints();
            for (const r of st.aiRows) {
              r.duplicate = existing.has(fingerprint(r.tx));
              r.include = !r.duplicate;
            }
            render();
          } })),

      el('div.grid.grid--3', {}, [
        tile(t('imp_found'), String(st.aiRows.length)),
        tile(t('imp_chosen'), String(chosen.length), 'pos'),
        tile(t('imp_dupes'), String(dupes)),
      ]),

      el('div.hstack', { style: { gap: '8px' } }, [
        el('button.btn.btn--sm.btn--ghost', {
          text: t('imp_all'),
          onclick: () => { st.aiRows.forEach(r => { r.include = true; }); render(); },
        }),
        el('button.btn.btn--sm.btn--ghost', {
          text: t('imp_none'),
          onclick: () => { st.aiRows.forEach(r => { r.include = false; }); render(); },
        }),
      ]),

      el('p.tiny.muted-3', { text: t('imp_pdf_check') }),

      el('div.card', {}, [el('div.list', {}, rows)]),

      el('button.btn.btn--primary.btn--block', {
        text: chosen.length ? t('imp_do', { n: chosen.length }) : t('imp_nothing_to_add'),
        disabled: !chosen.length,
        onclick: () => runImport(chosen.map(r => r.tx)),
      }),
    );
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
        // без проверки удаления повторный импорт считал бы дубликатом то,
        // что пользователь сознательно удалил
        .filter(x => x.account === st.accountId && !x.deleted)
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
    if (st.mode === 'pdf') { renderPdf(); return; }

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
        party: tx.merchant || '', note: tx.note,
        // из счёта-фактуры переносим то, что нужно для налогов
        uuid: tx.uuid, rfc: tx.rfc, iva: tx.iva, cfdiType: tx.cfdiType,
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
    st.rows = []; st.fileName = null; st.mode = 'table'; st.aiRows = [];
    s.close();
    toast(t('imp_done', { n: fresh.length }));
    onDone?.();
  }

  render();
  s = sheet({
    title: t('imp_title'), body: [body],
    onClose: () => { st.rows = []; st.fileName = null; st.mode = 'table'; st.aiRows = []; },
  });
}

function tile(label, value, cls = '') {
  return el('div.card.card--flat', { style: { padding: '12px' } }, [
    el('div.tiny.muted-3', { text: label }),
    el('div.amount.num' + (cls ? '.' + cls : ''), { style: { fontSize: '19px', marginTop: '2px' }, text: value }),
  ]);
}
