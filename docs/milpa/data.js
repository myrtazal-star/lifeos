/* Модель данных Milpa и все расчёты.
   Суммы везде — целые центы. Знак не хранится: направление задаёт поле kind. */

import { createStore, uid } from './shared/js/store.js';
import { stamp, tombstone, alive } from './shared/js/sync.js';
import { toISODate, addDays, addMonths, startOfMonth, endOfMonth, daysBetween } from './shared/js/format.js';

export const BOOKS = ['personal', 'empresa'];
export const ACCOUNT_TYPES = ['cash', 'bank', 'card', 'savings'];

/* Категории по умолчанию. name — ключ перевода не делаем: пользователь
   их переименовывает, поэтому храним готовый текст на языке первого запуска. */
const DEFAULT_CATEGORIES = {
  personal: {
    expense: [
      ['🛒', 'Продукты', '--c1'], ['🍽️', 'Кафе и рестораны', '--c7'],
      ['🚗', 'Транспорт', '--c2'], ['🏠', 'Жильё и аренда', '--c3'],
      ['💡', 'Коммунальные', '--c4'], ['📱', 'Связь и интернет', '--c6'],
      ['💊', 'Здоровье', '--c5'], ['🏋️', 'Спорт', '--c1'],
      ['📚', 'Образование', '--c3'], ['👕', 'Одежда', '--c5'],
      ['🎬', 'Развлечения', '--c7'], ['🎁', 'Подарки', '--c5'],
      ['✈️', 'Путешествия', '--c6'], ['🧾', 'Налоги и сборы', '--c8'],
      ['▫️', 'Прочее', '--c8'],
    ],
    income: [
      ['💼', 'Зарплата', '--c1'], ['🤝', 'Комиссия со сделки', '--c2'],
      ['🔑', 'Аренда', '--c6'], ['📈', 'Проценты и дивиденды', '--c3'],
      ['↩️', 'Возврат', '--c8'], ['▫️', 'Прочее', '--c8'],
    ],
  },
  empresa: {
    expense: [
      ['🏢', 'Аренда офиса', '--c3'], ['👥', 'Зарплаты', '--c2'],
      ['🤝', 'Комиссии агентам', '--c5'], ['📣', 'Маркетинг', '--c7'],
      ['📢', 'Реклама и листинги', '--c7'], ['💻', 'Подписки и софт', '--c6'],
      ['⚖️', 'Юрист и нотариус', '--c8'], ['🧾', 'Налоги', '--c8'],
      ['🚗', 'Транспорт', '--c2'], ['🍽️', 'Представительские', '--c4'],
      ['▫️', 'Прочее', '--c8'],
    ],
    income: [
      ['🏘️', 'Комиссия с продажи', '--c1'], ['🔑', 'Комиссия с аренды', '--c6'],
      ['💬', 'Консультации', '--c3'], ['📄', 'Управление объектом', '--c2'],
      ['▫️', 'Прочее', '--c8'],
    ],
  },
};

/* Ключи начальных записей заданы жёстко, а не случайно: на двух устройствах
   набор по умолчанию должен получиться одинаковым, иначе после первой
   синхронизации счета и категории задвоятся. */
function buildDefaultCategories() {
  const out = [];
  for (const book of BOOKS) {
    for (const kind of ['expense', 'income']) {
      DEFAULT_CATEGORIES[book][kind].forEach(([icon, name, color], i) => {
        out.push({ id: `c-${book}-${kind}-${i}`, book, kind, icon, name, color });
      });
    }
  }
  return out;
}

/* Названия кошельков по умолчанию. Это единственное место, где они заданы:
   в версии по подписке сюда попадёт то, что человек введёт при регистрации.
   Пользователь в любой момент переименовывает их в настройках. */
const DEFAULT_BOOK_NAMES = { personal: 'Kira Kellar', empresa: 'KOSHTUR' };

const seed = {
  v: 2,
  settings: {
    lang: null,
    theme: 'dark',
    base: 'MXN',
    fx: { USD: 17.5 },            // сколько MXN за 1 USD (обновляется из ленты)
    fxUpdated: null,
    fxSource: null,
    fxAuto: true,                 // false — курс задан вручную, не трогаем
    book: 'personal',
  },
  books: [
    { id: 'personal', icon: '🏠', name: DEFAULT_BOOK_NAMES.personal },
    { id: 'empresa', icon: '🏢', name: DEFAULT_BOOK_NAMES.empresa },
  ],
  accounts: [
    { id: 'a-cash', book: 'personal', name: 'Наличные', type: 'cash', currency: 'MXN', opening: 0, color: '--c1', archived: false },
    { id: 'a-card', book: 'personal', name: 'Карта', type: 'card', currency: 'MXN', opening: 0, color: '--c2', archived: false },
    { id: 'a-company', book: 'empresa', name: 'Счёт компании', type: 'bank', currency: 'MXN', opening: 0, color: '--c3', archived: false },
  ],
  categories: buildDefaultCategories(),
  tx: [],
  recurring: [],
  goals: [],          // цели накопления
  savings: [],        // отложенные суммы по целям
  debts: [],          // долги: кредитки, займы
  debtPayments: [],   // платежи по долгам
};

export const store = createStore({
  key: 'lifeos.milpa',
  // приложение называлось Kapital — данные, заведённые тогда, подхватываются
  legacyKey: 'lifeos.kapital',
  version: 3,
  seed,
  // отметку времени на настройках ставит само хранилище
  stampField: 'settings',
  migrate: (data, from) => {
    // v1 → v2: у кошельков появились названия, которые можно менять.
    // Данные, заведённые до этой версии, названий не имеют — дописываем.
    if (from < 2 && Array.isArray(data.books)) {
      for (const b of data.books) {
        if (!b.name) b.name = DEFAULT_BOOK_NAMES[b.id] || b.id;
      }
    }

    /* v2 → v3: операция запоминает курс на свою дату. Прежним валютным
       записям проставляем курс, действующий сейчас: настоящего курса на их
       дату мы не знаем, но так прошлые отчёты хотя бы перестанут меняться
       при каждом обновлении курса. */
    if (from < 3 && Array.isArray(data.tx)) {
      const base = data.settings?.base || 'MXN';
      const rate = Number(data.settings?.fx?.USD) || 0;
      if (rate > 0) {
        for (const t of data.tx) {
          if (t.fxRate == null && t.currency && t.currency !== base) t.fxRate = rate;
        }
      }
    }
    return data;
  },
});

export const S = () => store.state;

/* ─────────── Выборки ─────────── */

/** Название кошелька. Если пользователь его не задавал (данные старой версии
    или чужой язык), откатываемся на строку из словаря. */
export function bookName(id, t) {
  const b = S().books.find(x => x.id === id);
  if (b?.name) return b.name;
  return t ? t('book_' + id) : id;
}

export function setBookName(id, name) {
  store.update(s => {
    const b = s.books.find(x => x.id === id);
    // пустое поле не оставляем — возвращаем значение по умолчанию
    if (b) stamp(Object.assign(b, {
      name: String(name || '').trim() || DEFAULT_BOOK_NAMES[id] || id,
    }));
  });
}

/* Удалённые записи остаются в данных помеченными — иначе второе устройство,
   не знающее об удалении, вернёт их обратно. На экранах их не видно. */
export const liveTx = () => alive(S().tx);
export const liveAccounts = () => alive(S().accounts);
export const liveCategories = () => alive(S().categories);
export const liveRecurring = () => alive(S().recurring);
export const liveGoals = () => alive(S().goals);
export const liveDebts = () => alive(S().debts);
export const liveSavings = () => alive(S().savings);

export const accountsOf = (book, { withArchived = false } = {}) =>
  liveAccounts().filter(a => a.book === book && (withArchived || !a.archived));

export const accountById = (id) => {
  const a = S().accounts.find(x => x.id === id);
  return a && !a.deleted ? a : null;
};

export const categoriesOf = (book, kind) =>
  liveCategories().filter(c => c.book === book && (!kind || c.kind === kind));

export const categoryById = (id) => {
  const c = S().categories.find(x => x.id === id);
  return c && !c.deleted ? c : null;
};

/** Операции книги, свежие сверху. */
export function txOf(book, { from, to, accountId, categoryId, kind, query } = {}) {
  const q = query?.trim().toLowerCase();
  return liveTx()
    .filter(t => t.book === book)
    .filter(t => !from || t.date >= from)
    .filter(t => !to || t.date <= to)
    .filter(t => !accountId || t.account === accountId || t.toAccount === accountId)
    .filter(t => !categoryId || t.category === categoryId)
    .filter(t => !kind || t.kind === kind)
    .filter(t => !q || (t.note || '').toLowerCase().includes(q)
              || (t.party || '').toLowerCase().includes(q)
              || (categoryById(t.category)?.name || '').toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/* ─────────── Деньги ─────────── */

export const rates = () => ({ base: S().settings.base, rates: { ...S().settings.fx, MXN: 1 } });

/** Курс на сегодня: сколько песо за доллар. */
export const currentRate = () => Number(S().settings.fx?.USD) || 0;

/**
 * Пересчёт в основную валюту.
 *
 * rate — курс, действовавший в момент операции. Без него прошлогодняя
 * сделка пересчитывалась бы сегодняшним курсом, и отчёт за март,
 * открытый в сентябре, показывал бы другие числа, чем показывал в марте.
 */
export function toBase(cents, currency, rate) {
  const base = S().settings.base;
  if (currency === base) return cents;
  const usdMxn = Number(rate) > 0 ? Number(rate) : currentRate();
  if (!usdMxn) return cents;
  if (currency === 'USD' && base === 'MXN') return Math.round(cents * usdMxn);
  if (currency === 'MXN' && base === 'USD') return Math.round(cents / usdMxn);
  return cents;
}

/** Курс, по которому надо считать конкретную операцию. */
export const rateOf = (tx) => (Number(tx?.fxRate) > 0 ? Number(tx.fxRate) : null);

/** Остаток по счёту в валюте счёта. */
export function balanceOf(accountId) {
  const acc = accountById(accountId);
  if (!acc) return 0;
  let sum = acc.opening || 0;
  for (const t of liveTx()) {
    if (t.kind === 'income' && t.account === accountId) sum += t.amount;
    else if (t.kind === 'expense' && t.account === accountId) sum -= t.amount;
    else if (t.kind === 'transfer') {
      if (t.account === accountId) sum -= t.amount;
      // при переводе между валютами на счёт-получатель приходит своя сумма
      if (t.toAccount === accountId) sum += (t.amountTo ?? t.amount);
    }
  }
  return sum;
}

/** Суммарный остаток книги в основной валюте. */
export function totalOf(book) {
  return accountsOf(book).reduce((s, a) => s + toBase(balanceOf(a.id), a.currency), 0);
}

/** Доходы/расходы за период в основной валюте. Переводы не считаются
    ни доходом, ни расходом — это перекладывание из кармана в карман. */
export function periodStats(book, from, to) {
  let income = 0, expense = 0, count = 0;
  for (const t of liveTx()) {
    if (t.book !== book || t.date < from || t.date > to) continue;
    count++;
    const acc = accountById(t.account);
    const v = toBase(t.amount, t.currency || acc?.currency || S().settings.base, rateOf(t));
    if (t.kind === 'income') income += v;
    else if (t.kind === 'expense') expense += v;
  }
  return { income, expense, net: income - expense, count };
}

/** Разбивка по категориям за период, от большего к меньшему. */
export function byCategory(book, from, to, kind = 'expense') {
  const map = new Map();
  for (const t of liveTx()) {
    if (t.book !== book || t.kind !== kind || t.date < from || t.date > to) continue;
    const acc = accountById(t.account);
    const v = toBase(t.amount, t.currency || acc?.currency || S().settings.base, rateOf(t));
    const key = t.category || '__none';
    const cur = map.get(key) || { id: key, total: 0, count: 0 };
    cur.total += v; cur.count++;
    map.set(key, cur);
  }
  const total = [...map.values()].reduce((s, r) => s + r.total, 0);
  return {
    total,
    rows: [...map.values()]
      .map(r => ({ ...r, cat: categoryById(r.id), share: total ? r.total / total : 0 }))
      .sort((a, b) => b.total - a.total),
  };
}

/** Помесячная динамика за последние n месяцев. */
export function monthlySeries(book, months = 6, anchor = toISODate()) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = addMonths(anchor, -i);
    const from = startOfMonth(m), to = endOfMonth(m);
    out.push({ month: from.slice(0, 7), ...periodStats(book, from, to) });
  }
  return out;
}

/* ─────────── Изменение данных ─────────── */

export function addTx(data) {
  const id = uid('t');
  store.update(s => {
    s.tx.push(stamp({
      id, createdAt: new Date().toISOString(),
      book: data.book, kind: data.kind, date: data.date,
      amount: data.amount, amountTo: data.amountTo ?? null,
      currency: data.currency,
      account: data.account, toAccount: data.toAccount ?? null,
      category: data.category ?? null,
      party: data.party || '', note: data.note || '',
      /* Данные счёта-фактуры. UUID делает повторную загрузку безошибочной,
         IVA и RFC нужны для налоговой отчётности и вычитаемости расхода. */
      /* Курс на момент записи. Дальше операция пересчитывается только по
         нему: иначе прошлые отчёты меняются при каждом изменении курса. */
      fxRate: data.fxRate ?? (data.currency !== S().settings.base ? currentRate() : null),
      uuid: data.uuid || null,
      rfc: data.rfc || null,
      iva: data.iva ?? null,
      cfdiType: data.cfdiType || null,
    }));
  });
  return id;
}

export function updateTx(id, patch) {
  store.update(s => {
    const t = s.tx.find(x => x.id === id);
    if (t) stamp(Object.assign(t, patch));
  });
}

export function removeTx(id) {
  store.update(s => {
    const t = s.tx.find(x => x.id === id);
    if (t) tombstone(t);
  });
}

export function addAccount(data) {
  const id = uid('a');
  store.update(s => s.accounts.push(stamp({ id, archived: false, ...data })));
  return id;
}

export function updateAccount(id, patch) {
  store.update(s => {
    const a = s.accounts.find(x => x.id === id);
    if (a) stamp(Object.assign(a, patch));
  });
}

export function removeAccount(id) {
  store.update(s => {
    const a = s.accounts.find(x => x.id === id);
    if (a) tombstone(a);
    // операции и платежи удалённого счёта тоже помечаем — поодиночке,
    // чтобы второе устройство узнало о каждом
    for (const t of s.tx) if (t.account === id || t.toAccount === id) tombstone(t);
    for (const r of s.recurring) if (r.account === id) tombstone(r);
  });
}

/** Номера уже загруженных счетов-фактур — для отсева повторов. */
export function knownCfdiUuids(book) {
  const out = new Set();
  for (const t of liveTx()) {
    if (t.book === book && t.uuid) out.add(String(t.uuid).toUpperCase());
  }
  return out;
}

/** Налоговый номер владельца кошелька: определяет, свой счёт или чужой. */
export function bookRfc(id) {
  return S().books.find(b => b.id === id)?.rfc || '';
}

export function setBookRfc(id, rfc) {
  store.update(s => {
    const b = s.books.find(x => x.id === id);
    if (b) stamp(Object.assign(b, { rfc: String(rfc || '').trim().toUpperCase() }));
  });
}

export function txCountForAccount(id) {
  return liveTx().filter(t => t.account === id || t.toAccount === id).length;
}

export function addCategory(data) {
  const id = uid('c');
  store.update(s => s.categories.push(stamp({ id, ...data })));
  return id;
}

export function updateCategory(id, patch) {
  store.update(s => {
    const c = s.categories.find(x => x.id === id);
    if (c) stamp(Object.assign(c, patch));
  });
}

export function removeCategory(id) {
  store.update(s => {
    const c = s.categories.find(x => x.id === id);
    if (c) tombstone(c);
    for (const t of s.tx) if (t.category === id) { t.category = null; stamp(t); }
    for (const r of s.recurring) if (r.category === id) { r.category = null; stamp(r); }
  });
}

export function txCountForCategory(id) {
  return liveTx().filter(t => t.category === id).length;
}

/* ─────────── Регулярные платежи ─────────── */

/** Следующая дата после указанной, по правилу повторения. */
export function nextDate(rec, after) {
  if (rec.freq === 'weekly') {
    let d = addDays(after, 1);
    // ищем ближайший нужный день недели (0 = вс)
    for (let i = 0; i < 7; i++) {
      const dow = new Date(d + 'T00:00:00').getDay();
      if (dow === (rec.dow ?? 1)) return d;
      d = addDays(d, 1);
    }
    return d;
  }
  // раз в месяц: то же число следующего месяца, с поправкой на короткие месяцы
  const nextMonth = addMonths(after.slice(0, 7) + '-01', 1);
  const lastDay = Number(endOfMonth(nextMonth).slice(8));
  const day = Math.min(rec.dom ?? 1, lastDay);
  return nextMonth.slice(0, 8) + String(day).padStart(2, '0');
}

export function addRecurring(data) {
  const id = uid('r');
  store.update(s => s.recurring.push(stamp({ id, active: true, ...data })));
  return id;
}

export function updateRecurring(id, patch) {
  store.update(s => {
    const r = s.recurring.find(x => x.id === id);
    if (r) stamp(Object.assign(r, patch));
  });
}

export function removeRecurring(id) {
  store.update(s => {
    const r = s.recurring.find(x => x.id === id);
    if (r) tombstone(r);
  });
}

/** Регулярные платежи, у которых срок наступил. */
export function dueRecurring(book, today = toISODate()) {
  return liveRecurring().filter(r => r.book === book && r.active && r.next <= today);
}

/** Записать регулярный платёж как обычную операцию и сдвинуть срок. */
export function postRecurring(id) {
  const r = liveRecurring().find(x => x.id === id);
  if (!r) return null;
  const txId = addTx({
    book: r.book, kind: r.kind, date: r.next,
    amount: r.amount, currency: r.currency,
    account: r.account, category: r.category,
    party: r.party || '', note: r.title,
  });
  updateRecurring(id, { next: nextDate(r, r.next), lastPosted: r.next });
  return txId;
}

export function skipRecurring(id) {
  const r = liveRecurring().find(x => x.id === id);
  if (r) updateRecurring(id, { next: nextDate(r, r.next) });
}

/* ─────────── Выгрузка в таблицу ─────────── */

export function toCSV(book) {
  const head = ['Дата', 'Тип', 'Сумма', 'Валюта', 'Счёт', 'Категория', 'Контрагент', 'Заметка'];
  const kindLabel = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' };
  const esc = v => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const rows = txOf(book).map(t => [
    t.date,
    kindLabel[t.kind] || t.kind,
    (t.amount / 100).toFixed(2),
    t.currency,
    accountById(t.account)?.name || '',
    t.kind === 'transfer' ? '→ ' + (accountById(t.toAccount)?.name || '') : (categoryById(t.category)?.name || ''),
    t.party || '',
    t.note || '',
  ].map(esc).join(';'));
  // BOM — чтобы Excel не ломал кириллицу
  return '﻿' + [head.join(';'), ...rows].join('\r\n');
}


/* ─────────── Цели накопления ───────────

   Откладывание — это не расход: деньги остаются вашими, просто помечены
   под конкретную задачу. Поэтому суммы по целям хранятся отдельно и не
   трогают остатки на счетах.

   Цель можно привязать к счёту — тогда накопленным считается его остаток,
   и отмечать вручную ничего не надо. Без привязки цель складывается из
   того, что вы откладывали. */

export const GOAL_ICONS = ['🎯','🏖️','🏠','🚗','🎓','💍','🚀','🛟','💻','🎸','👶','🏥','✈️','📦'];

export function goalsOf(book, { withDone = false } = {}) {
  return liveGoals()
    .filter(g => g.book === book && (withDone || !g.archived))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export const goalById = (id) => {
  const g = S().goals.find(x => x.id === id);
  return g && !g.deleted ? g : null;
};

export const savingsOf = (goalId) =>
  liveSavings().filter(s => s.goalId === goalId)
    .sort((a, b) => b.date.localeCompare(a.date));

/** Сколько уже отложено на цель, в валюте цели. */
export function savedFor(goal) {
  if (!goal) return 0;
  if (goal.accountId) {
    const acc = accountById(goal.accountId);
    if (!acc) return 0;
    const balance = balanceOf(goal.accountId);
    return acc.currency === goal.currency ? balance : convertBetween(balance, acc.currency, goal.currency);
  }
  return savingsOf(goal.id).reduce((sum, s) => sum + s.amount, 0);
}

/** Пересчёт между двумя валютами через курс из настроек. */
export function convertBetween(cents, from, to) {
  if (from === to) return cents;
  const usdMxn = Number(S().settings.fx?.USD) || 0;
  if (!usdMxn) return cents;
  if (from === 'USD' && to === 'MXN') return Math.round(cents * usdMxn);
  if (from === 'MXN' && to === 'USD') return Math.round(cents / usdMxn);
  return cents;
}

/** Всё о продвижении к цели: сколько осталось, успеваем ли, сколько в месяц. */
export function goalProgress(goal, today = toISODate()) {
  const saved = savedFor(goal);
  const target = goal.target || 0;
  const remaining = Math.max(0, target - saved);
  const ratio = target > 0 ? Math.min(1, saved / target) : 0;
  const done = target > 0 && saved >= target;

  let monthsLeft = null, perMonth = null, overdue = false;
  if (goal.deadline) {
    const days = daysBetween(today, goal.deadline);
    overdue = days < 0 && !done;
    // меньше месяца до срока всё равно считаем как один месяц
    monthsLeft = Math.max(0, days) / 30.44;
    perMonth = monthsLeft > 0 ? Math.ceil(remaining / Math.max(1, monthsLeft)) : remaining;
  }

  return { saved, target, remaining, ratio, done, monthsLeft, perMonth, overdue };
}

/** Сколько всего отложено по книге, в основной валюте.
    На эту сумму уменьшается «свободно» на главном экране. */
export function reservedTotal(book) {
  return goalsOf(book).reduce((sum, g) => sum + toBase(savedFor(g), g.currency), 0);
}

/* ─────────── Изменение ─────────── */

export function addGoal(data) {
  const id = uid('g');
  store.update(s => s.goals.push(stamp({
    id, archived: false, order: s.goals.length,
    createdDate: toISODate(),
    ...data,
  })));
  return id;
}

export function updateGoal(id, patch) {
  store.update(s => {
    const g = s.goals.find(x => x.id === id);
    if (g) stamp(Object.assign(g, patch));
  });
}

export function removeGoal(id) {
  store.update(s => {
    const g = s.goals.find(x => x.id === id);
    if (g) tombstone(g);
    // отложенные суммы помечаем поодиночке, чтобы о каждой
    // узнало второе устройство
    for (const sv of s.savings) if (sv.goalId === id) tombstone(sv);
  });
}

/** Отложить на цель. Остатки на счетах при этом не меняются. */
export function addSaving({ book, goalId, date, amount, note }) {
  const id = uid('s');
  store.update(s => s.savings.push(stamp({
    id, book, goalId, date, amount, note: note || '',
    createdAt: new Date().toISOString(),
  })));
  return id;
}

export function removeSaving(id) {
  store.update(s => {
    const sv = s.savings.find(x => x.id === id);
    if (sv) tombstone(sv);
  });
}


/* ─────────── Долги ───────────

   Остаток долга хранится как подтверждённый: вы сверяете его с выпиской,
   а платежи его уменьшают. Проценты набегают на стороне банка, поэтому
   раз в месяц остаток стоит сверять заново — приложение об этом напомнит.

   Стратегия погашения считается в debt-math.js. */

export const DEBT_ICONS = ['💳','🏦','🚗','🏠','👤','📄'];

export function debtsOf(book, { withClosed = false } = {}) {
  return liveDebts()
    .filter(d => d.book === book && (withClosed || !d.archived))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export const debtById = (id) => {
  const d = S().debts.find(x => x.id === id);
  return d && !d.deleted ? d : null;
};

export const debtPaymentsOf = (debtId) =>
  alive(S().debtPayments).filter(p => p.debtId === debtId)
    .sort((a, b) => b.date.localeCompare(a.date));

/** Сумма всех долгов книги в основной валюте. */
export function debtsTotal(book) {
  return debtsOf(book).reduce((sum, d) => sum + toBase(d.balance || 0, d.currency), 0);
}

/** Сколько дней прошло с последней сверки остатка с выпиской. */
export function daysSinceConfirmed(debt, today = toISODate()) {
  if (!debt?.confirmedAt) return null;
  return daysBetween(debt.confirmedAt, today);
}

export function addDebt(data) {
  const id = uid('d');
  store.update(s => s.debts.push(stamp({
    id, archived: false, order: s.debts.length,
    confirmedAt: toISODate(),
    createdDate: toISODate(),
    ...data,
  })));
  return id;
}

export function updateDebt(id, patch) {
  store.update(s => {
    const d = s.debts.find(x => x.id === id);
    if (d) stamp(Object.assign(d, patch));
  });
}

export function removeDebt(id) {
  store.update(s => {
    const d = s.debts.find(x => x.id === id);
    if (d) tombstone(d);
    for (const p of s.debtPayments) if (p.debtId === id) tombstone(p);
  });
}

/** Записать платёж: уменьшает остаток долга. */
export function addDebtPayment({ book, debtId, date, amount, note, accountId }) {
  const id = uid('dp');
  store.update(s => {
    const d = s.debts.find(x => x.id === debtId);
    /* Запоминаем, на сколько остаток реально уменьшился. Раньше излишек
       переплаты молча проглатывался, а при удалении платежа возвращалась
       полная сумма — и долг оказывался больше, чем был до платежа. */
    const before = d ? (d.balance || 0) : 0;
    const applied = d ? Math.min(amount, before) : 0;

    s.debtPayments.push(stamp({
      id, book, debtId, date, amount, applied, accountId: accountId || null,
      note: note || '', createdAt: new Date().toISOString(),
    }));
    if (d) stamp(Object.assign(d, { balance: before - applied }));
  });
  return id;
}

export function removeDebtPayment(id) {
  store.update(s => {
    const p = s.debtPayments.find(x => x.id === id);
    if (!p) return;
    tombstone(p);
    // возвращаем ровно то, что было вычтено, а не всю сумму платежа
    const d = s.debts.find(x => x.id === p.debtId);
    const back = p.applied != null ? p.applied : p.amount;
    if (d) stamp(Object.assign(d, { balance: (d.balance || 0) + back }));
  });
}

/** Сверка остатка с выпиской — то, что приводит цифру в соответствие с банком. */
export function confirmDebtBalance(id, balance) {
  updateDebt(id, { balance: Math.max(0, balance), confirmedAt: toISODate() });
}
