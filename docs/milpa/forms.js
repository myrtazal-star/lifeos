/* Формы Milpa: операция, счёт, категория, регулярный платёж. */

import { el, sheet, confirmSheet, toast, haptic, field, input, textarea, select, segmented, icons, pickFile }
  from './shared/js/ui.js';
import { parseMoney, formatMoney, toISODate, CURRENCIES } from './shared/js/format.js';
import * as D from './data.js';
import { hasKey, prepareImage, readReceipt, aiMessage } from './ai.js';

const KINDS = ['expense', 'income', 'transfer'];

/* ─────────── Операция ─────────── */

export function txForm({ t, lang, book, tx = null, onDone }) {
  const editing = !!tx;
  const accounts = D.accountsOf(book, { withArchived: editing });

  if (!accounts.length) {
    const intro = sheet({
      title: t('no_accounts'),
      body: [el('p.muted', { text: t('no_accounts_hint') })],
      actions: [el('button.btn.btn--primary', {
        text: t('add_account'),
        onclick: () => { intro.close(); accountForm({ t, book, onDone }); },
      })],
    });
    return;
  }

  // рабочая копия — форма не трогает хранилище, пока не нажали «Сохранить»
  const draft = {
    kind: tx?.kind ?? 'expense',
    amount: tx ? String(tx.amount / 100) : '',
    amountTo: tx?.amountTo != null ? String(tx.amountTo / 100) : '',
    account: tx?.account ?? accounts[0].id,
    toAccount: tx?.toAccount ?? (accounts[1]?.id ?? accounts[0].id),
    category: tx?.category ?? null,
    date: tx?.date ?? toISODate(),
    party: tx?.party ?? '',
    note: tx?.note ?? '',
  };

  const body = el('div.stack');
  let s;

  const curOf = id => D.accountById(id)?.currency || D.S().settings.base;

  function render() {
    const cur = curOf(draft.account);
    const toCur = curOf(draft.toAccount);
    const crossCurrency = draft.kind === 'transfer' && cur !== toCur;

    const amountInput = input({
      class: 'input--amount', inputmode: 'decimal', value: draft.amount,
      placeholder: '0', 'aria-label': t('amount'),
      oninput: e => { draft.amount = e.target.value; },
    });

    const accountOptions = accounts.map(a => ({
      value: a.id,
      label: `${a.name} · ${CURRENCIES[a.currency]?.symbol || a.currency}`,
    }));

    const parts = [
      !editing && scanButton(),

      segmented(KINDS.map(k => ({ value: k, label: t('tx_' + k) })), draft.kind,
        v => { draft.kind = v; if (v !== 'transfer') draft.category = defaultCategory(v); render(); },
        { accent: true }),

      el('div.card.card--flat', {}, [
        amountInput,
        el('div.small.muted', {
          style: { textAlign: 'center', marginTop: '2px' },
          text: CURRENCIES[cur]?.code || cur,
        }),
      ]),

      field(draft.kind === 'income' ? t('tx_account_in') : t('tx_account'),
        select(accountOptions, {
          value: draft.account,
          onchange: e => { draft.account = e.target.value; render(); },
        })),
    ];

    if (draft.kind === 'transfer') {
      parts.push(field(t('tx_to_account'), select(accountOptions, {
        value: draft.toAccount,
        onchange: e => { draft.toAccount = e.target.value; render(); },
      })));

      if (crossCurrency) {
        parts.push(field(`${t('tx_received')} · ${toCur}`, input({
          inputmode: 'decimal', value: draft.amountTo, placeholder: '0',
          oninput: e => { draft.amountTo = e.target.value; },
        })));
      }
    } else {
      parts.push(categoryPicker(t, book, draft, render));
    }

    parts.push(
      field(t('date'), input({
        type: 'date', value: draft.date,
        onchange: e => { draft.date = e.target.value || toISODate(); },
      })),
      field(t('tx_party'), input({
        value: draft.party, placeholder: t('tx_party_ph'), enterkeyhint: 'done',
        oninput: e => { draft.party = e.target.value; },
      })),
      field(t('note'), textarea({
        value: draft.note, placeholder: t('tx_note_ph'), rows: 2,
        oninput: e => { draft.note = e.target.value; },
      })),
    );

    if (editing) {
      parts.push(el('button.btn.btn--danger.btn--block', {
        text: t('delete'),
        onclick: () => confirmSheet({
          title: t('delete_confirm'), text: '',
          confirmLabel: t('delete'), cancelLabel: t('cancel'),
          onConfirm: () => { D.removeTx(tx.id); s.close(); toast(t('deleted')); onDone?.(); },
        }),
      }));
    }
    body.replaceChildren(...parts);
  }

  /* ─────── Заполнение по снимку чека ─────── */

  let scanning = false;

  function scanButton() {
    if (scanning) {
      return el('div.card.card--flat.hstack', { style: { justifyContent: 'center', gap: '10px' } }, [
        el('span', { text: '⏳' }),
        el('span.small.muted', { text: t('ai_reading') }),
      ]);
    }
    return el('button.btn.btn--block', {
      style: { background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'transparent' },
      text: '📷 ' + t('ai_scan'),
      onclick: scan,
    });
  }

  async function scan() {
    if (!hasKey()) { toast(t('ai_no_key'), { error: true, ms: 5000 }); return; }

    const file = await pickFile('image/*');
    if (!file) return;

    scanning = true; render();
    try {
      const image = await prepareImage(new Blob([file.buffer], { type: file.type || 'image/jpeg' }));
      const result = await readReceipt({
        base64: image.base64,
        mediaType: image.mediaType,
        categories: D.categoriesOf(book).map(c => c.name),
        today: toISODate(),
        bookName: D.bookName(book, t),
      });
      applyScan(result);
    } catch (e) {
      toast(aiMessage(t, e), { error: true, ms: 6000 });
    } finally {
      scanning = false; render();
    }
  }

  /** Результат распознавания только ЗАПОЛНЯЕТ форму — записывает человек. */
  function applyScan(r) {
    if (!r.readable) {
      toast(r.problem || t('ai_unreadable'), { error: true, ms: 6000 });
      return;
    }

    if (r.kindKnown) draft.kind = r.kind;
    draft.amount = String(r.amountCents / 100);
    if (r.date) draft.date = r.date;
    if (r.note) draft.note = r.note;
    if (r.merchant) draft.party = r.merchant;

    // валюту задаёт счёт: если она другая — пробуем подобрать подходящий счёт
    if (r.currency) {
      const current = D.accountById(draft.account)?.currency;
      if (current !== r.currency) {
        const match = accounts.find(a => a.currency === r.currency);
        if (match) draft.account = match.id;
        else toast(t('ai_currency_mismatch', { c: r.currency }), { error: true, ms: 5000 });
      }
    }

    if (r.category) {
      const found = D.categoriesOf(book, draft.kind)
        .find(c => c.name.toLowerCase() === r.category.toLowerCase());
      if (found) draft.category = found.id;
    }

    haptic(15);
    toast(r.confidence === 'high' ? t('ai_filled') : t('ai_filled_check'),
          { ms: r.confidence === 'high' ? 2500 : 5000 });
  }

  function defaultCategory(kind) {
    const list = D.categoriesOf(book, kind);
    return list[0]?.id ?? null;
  }
  if (!draft.category && draft.kind !== 'transfer') draft.category = defaultCategory(draft.kind);

  function save() {
    const cents = parseMoney(draft.amount);
    if (cents <= 0) { toast(t('amount_required'), { error: true }); return; }
    if (draft.kind === 'transfer' && draft.account === draft.toAccount) {
      toast(t('same_account'), { error: true }); return;
    }

    const cur = curOf(draft.account);
    const toCur = curOf(draft.toAccount);
    let amountTo = null;
    if (draft.kind === 'transfer') {
      /* Нужна валюта счёта-получателя, а не основная валюта учёта:
         toBase() здесь давал 5 000 долларов вместо 5 000 песо. */
      amountTo = cur === toCur ? cents
        : (parseMoney(draft.amountTo) || D.convertBetween(cents, cur, toCur));
    }

    const payload = {
      book, kind: draft.kind, date: draft.date,
      amount: cents, amountTo, currency: cur,
      account: draft.account,
      toAccount: draft.kind === 'transfer' ? draft.toAccount : null,
      category: draft.kind === 'transfer' ? null : draft.category,
      party: draft.party.trim(), note: draft.note.trim(),
    };

    if (editing) D.updateTx(tx.id, payload);
    else D.addTx(payload);

    haptic(18);
    s.close();
    toast(t('saved'));
    onDone?.();
  }

  render();
  s = sheet({
    title: editing ? t('edit_tx') : t('new_tx'),
    body: [body],
    actions: [
      el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => s.close() }),
      el('button.btn.btn--primary', { text: t('save'), onclick: save }),
    ],
  });
}

function categoryPicker(t, book, draft, rerender) {
  const list = D.categoriesOf(book, draft.kind);
  const grid = el('div.chips');
  for (const c of list) {
    grid.append(el('button.chip', {
      type: 'button',
      'aria-pressed': String(c.id === draft.category),
      onclick: () => { draft.category = c.id; haptic(); rerender(); },
    }, [el('span', { text: c.icon }), el('span', { text: c.name })]));
  }
  // после автозаполнения выбранная категория может оказаться далеко справа —
  // подкручиваем список к ней, иначе кажется, что ничего не выбрано
  queueMicrotask(() => {
    const active = grid.querySelector('[aria-pressed="true"]');
    if (active && grid.scrollWidth > grid.clientWidth) {
      grid.scrollLeft = active.offsetLeft - grid.clientWidth / 2 + active.offsetWidth / 2;
    }
  });

  return el('div.field', {}, [el('span.label', { text: t('category') }), grid]);
}

/* ─────────── Счёт ─────────── */

export function accountForm({ t, book, account = null, onDone }) {
  const editing = !!account;
  const draft = {
    name: account?.name ?? '',
    type: account?.type ?? 'cash',
    currency: account?.currency ?? D.S().settings.base,
    opening: account ? String(account.opening / 100) : '0',
    color: account?.color ?? '--c1',
  };
  let s;

  const body = el('div.stack', {}, [
    field(t('account_name'), input({
      value: draft.name, placeholder: t('acc_cash'), enterkeyhint: 'done',
      oninput: e => { draft.name = e.target.value; },
    })),
    field(t('account_type'), select(
      D.ACCOUNT_TYPES.map(v => ({ value: v, label: t('acc_' + v) })),
      { value: draft.type, onchange: e => { draft.type = e.target.value; } })),
    field(t('account_currency'), select(
      ['MXN', 'USD'].map(v => ({ value: v, label: `${v} — ${CURRENCIES[v].name}` })),
      { value: draft.currency,
        // менять валюту счёта, по которому уже есть операции, нельзя:
        // суммы хранятся в валюте счёта и молча пересчитались бы все разом
        disabled: editing && D.txCountForAccount(account.id) > 0,
        onchange: e => { draft.currency = e.target.value; } })),
    editing && D.txCountForAccount(account.id) > 0 &&
      el('div.tiny.muted-3', { text: t('account_currency_locked') }),
    field(t('account_opening'), input({
      inputmode: 'decimal', value: draft.opening,
      oninput: e => { draft.opening = e.target.value; },
    })),
    colorPicker(draft, 'color'),
  ]);

  if (editing) {
    const n = D.txCountForAccount(account.id);
    body.append(
      el('button.btn.btn--ghost.btn--block', {
        text: account.archived ? t('unarchive') : t('archive'),
        onclick: () => { D.updateAccount(account.id, { archived: !account.archived }); s.close(); onDone?.(); },
      }),
      el('button.btn.btn--danger.btn--block', {
        text: t('delete'),
        onclick: () => confirmSheet({
          title: t('delete_confirm'),
          text: n ? t('account_delete_warn', { n }) : '',
          confirmLabel: t('delete'), cancelLabel: t('cancel'),
          onConfirm: () => { D.removeAccount(account.id); s.close(); toast(t('deleted')); onDone?.(); },
        }),
      }),
    );
  }

  function save() {
    const name = draft.name.trim();
    if (!name) { toast(t('required'), { error: true }); return; }
    const payload = {
      book, name, type: draft.type, currency: draft.currency,
      opening: parseMoney(draft.opening), color: draft.color,
    };
    if (editing) D.updateAccount(account.id, payload);
    else D.addAccount(payload);
    s.close(); toast(t('saved')); onDone?.();
  }

  s = sheet({
    title: editing ? account.name : t('add_account'),
    body: [body],
    actions: [
      el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => s.close() }),
      el('button.btn.btn--primary', { text: t('save'), onclick: save }),
    ],
  });
}

/* ─────────── Категория ─────────── */

const ICON_CHOICES = ['🛒','🍽️','🚗','🏠','💡','📱','💊','🏋️','📚','👕','🎬','🎁','✈️','🧾','💼','🤝','🔑','📈','🏢','👥','📣','💻','⚖️','🏘️','💬','📄','🐶','👶','▫️'];

export function categoryForm({ t, book, category = null, kind = 'expense', onDone }) {
  const editing = !!category;
  const draft = {
    name: category?.name ?? '',
    kind: category?.kind ?? kind,
    icon: category?.icon ?? '▫️',
    color: category?.color ?? '--c8',
  };
  let s;
  const body = el('div.stack');

  function render() {
    const iconGrid = el('div.chips');
    for (const ic of ICON_CHOICES) {
      iconGrid.append(el('button.chip', {
        type: 'button', 'aria-pressed': String(ic === draft.icon),
        onclick: () => { draft.icon = ic; render(); },
      }, [el('span', { text: ic })]));
    }

    body.replaceChildren(
      segmented([
        { value: 'expense', label: t('tx_expense') },
        { value: 'income', label: t('tx_income') },
      ], draft.kind, v => { draft.kind = v; render(); }),
      field(t('name'), input({
        value: draft.name, enterkeyhint: 'done',
        oninput: e => { draft.name = e.target.value; },
      })),
      el('div.field', {}, [el('span.label', { text: t('cat_icon') }), iconGrid]),
      colorPicker(draft, 'color', render),
      ...(editing ? [el('button.btn.btn--danger.btn--block', {
        text: t('delete'),
        onclick: () => {
          const n = D.txCountForCategory(category.id);
          confirmSheet({
            title: t('delete_confirm'),
            text: n ? t('cat_in_use', { n }) : '',
            confirmLabel: t('delete'), cancelLabel: t('cancel'),
            onConfirm: () => { D.removeCategory(category.id); s.close(); toast(t('deleted')); onDone?.(); },
          });
        },
      })] : []),
    );
  }
  render();

  function save() {
    const name = draft.name.trim();
    if (!name) { toast(t('required'), { error: true }); return; }
    const payload = { book, name, kind: draft.kind, icon: draft.icon, color: draft.color };
    if (editing) D.updateCategory(category.id, payload);
    else D.addCategory(payload);
    s.close(); toast(t('saved')); onDone?.();
  }

  s = sheet({
    title: editing ? t('edit') : t('add_category'),
    body: [body],
    actions: [
      el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => s.close() }),
      el('button.btn.btn--primary', { text: t('save'), onclick: save }),
    ],
  });
}

function colorPicker(draft, key, rerender) {
  const wrap = el('div.chips');
  const colors = ['--c1','--c2','--c3','--c4','--c5','--c6','--c7','--c8'];
  const paint = () => {
    wrap.replaceChildren(...colors.map(c => el('button.chip', {
      type: 'button', 'aria-pressed': String(c === draft[key]),
      style: { background: `var(${c})`, borderColor: 'transparent',
               width: '38px', minWidth: '38px', padding: '0',
               opacity: c === draft[key] ? '1' : '.45' },
      'aria-label': c,
      onclick: () => { draft[key] = c; paint(); rerender?.(); },
    })));
  };
  paint();
  return el('div.field', {}, [el('span.label', { text: 'Цвет' }), wrap]);
}

/* ─────────── Регулярный платёж ─────────── */

export function recurringForm({ t, book, rec = null, onDone }) {
  const editing = !!rec;
  const accounts = D.accountsOf(book);
  if (!accounts.length) { toast(t('no_accounts'), { error: true }); return; }

  const draft = {
    title: rec?.title ?? '',
    kind: rec?.kind ?? 'expense',
    amount: rec ? String(rec.amount / 100) : '',
    account: rec?.account ?? accounts[0].id,
    category: rec?.category ?? D.categoriesOf(book, rec?.kind ?? 'expense')[0]?.id ?? null,
    freq: rec?.freq ?? 'monthly',
    dom: rec?.dom ?? new Date().getDate(),
    dow: rec?.dow ?? 1,
    next: rec?.next ?? toISODate(),
    active: rec?.active ?? true,
  };
  let s;
  const body = el('div.stack');

  function render() {
    const parts = [
      segmented([
        { value: 'expense', label: t('tx_expense') },
        { value: 'income', label: t('tx_income') },
      ], draft.kind, v => {
        draft.kind = v;
        draft.category = D.categoriesOf(book, v)[0]?.id ?? null;
        render();
      }, { accent: true }),

      field(t('name'), input({
        value: draft.title, placeholder: 'Аренда офиса', enterkeyhint: 'done',
        oninput: e => { draft.title = e.target.value; },
      })),
      field(t('amount'), input({
        inputmode: 'decimal', value: draft.amount,
        oninput: e => { draft.amount = e.target.value; },
      })),
      field(t('tx_account'), select(
        accounts.map(a => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
        { value: draft.account, onchange: e => { draft.account = e.target.value; } })),
      field(t('category'), select(
        D.categoriesOf(book, draft.kind).map(c => ({ value: c.id, label: `${c.icon} ${c.name}` })),
        { value: draft.category, onchange: e => { draft.category = e.target.value; } })),
      segmented([
        { value: 'monthly', label: t('rec_monthly') },
        { value: 'weekly', label: t('rec_weekly') },
      ], draft.freq, v => { draft.freq = v; render(); }),
    ];

    if (draft.freq === 'monthly') {
      parts.push(field(t('rec_day'), select(
        Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
        { value: String(draft.dom), onchange: e => { draft.dom = Number(e.target.value); } })));
    } else {
      const days = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
      parts.push(field(t('rec_weekday'), select(
        days.map((d, i) => ({ value: String(i), label: d })),
        { value: String(draft.dow), onchange: e => { draft.dow = Number(e.target.value); } })));
    }

    parts.push(field(t('rec_next'), input({
      type: 'date', value: draft.next,
      onchange: e => { draft.next = e.target.value || toISODate(); },
    })));

    if (editing) {
      parts.push(el('button.btn.btn--danger.btn--block', {
        text: t('delete'),
        onclick: () => confirmSheet({
          title: t('delete_confirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'),
          onConfirm: () => { D.removeRecurring(rec.id); s.close(); toast(t('deleted')); onDone?.(); },
        }),
      }));
    }
    body.replaceChildren(...parts);
  }
  render();

  function save() {
    const title = draft.title.trim();
    const cents = parseMoney(draft.amount);
    if (!title) { toast(t('required'), { error: true }); return; }
    if (cents <= 0) { toast(t('amount_required'), { error: true }); return; }

    const payload = {
      book, title, kind: draft.kind, amount: cents,
      currency: D.accountById(draft.account)?.currency || D.S().settings.base,
      account: draft.account, category: draft.category,
      freq: draft.freq, dom: draft.dom, dow: draft.dow,
      next: draft.next, active: draft.active,
    };
    if (editing) D.updateRecurring(rec.id, payload);
    else D.addRecurring(payload);
    s.close(); toast(t('saved')); onDone?.();
  }

  s = sheet({
    title: editing ? rec.title : t('add_recurring'),
    body: [body],
    actions: [
      el('button.btn.btn--ghost', { text: t('cancel'), onclick: () => s.close() }),
      el('button.btn.btn--primary', { text: t('save'), onclick: save }),
    ],
  });
}
