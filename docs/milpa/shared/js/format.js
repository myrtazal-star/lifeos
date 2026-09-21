/* Форматирование денег и дат. Вся математика по деньгам — в целых центах,
   чтобы не накапливалась ошибка вещественных чисел (0.1 + 0.2 ≠ 0.3). */

export const CURRENCIES = {
  MXN: { code: 'MXN', symbol: '$',   name: 'Песо',    locale: 'es-MX', minor: 100 },
  USD: { code: 'USD', symbol: 'US$', name: 'Доллар',  locale: 'en-US', minor: 100 },
  EUR: { code: 'EUR', symbol: '€',   name: 'Евро',    locale: 'de-DE', minor: 100 },
  RUB: { code: 'RUB', symbol: '₽',   name: 'Рубль',   locale: 'ru-RU', minor: 100 },
};

/** Строка из поля ввода → целое число центов. '1 234,56' → 123456 */
export function parseMoney(raw) {
  if (typeof raw === 'number') return Math.round(raw * 100);
  let s = String(raw ?? '').trim();
  if (!s) return 0;
  s = s.replace(/[\s  ']/g, '');           // пробелы-разделители тысяч
  s = s.replace(/[^\d.,\-+]/g, '');                   // символы валют и мусор

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // оба разделителя: последний — десятичный, остальные — тысячные
    const decSep = lastComma > lastDot ? ',' : '.';
    const thouSep = decSep === ',' ? '.' : ',';
    s = s.split(thouSep).join('');
    s = s.replace(decSep, '.');
  } else if (lastComma > -1) {
    // одна запятая: десятичная, если после неё 1–2 цифры, иначе разделитель тысяч
    s = (s.length - lastComma - 1) <= 2 ? s.replace(',', '.') : s.split(',').join('');
  } else if (lastDot > -1 && (s.length - lastDot - 1) > 2) {
    s = s.split('.').join('');
  }

  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Центы → строка. 123456, 'MXN' → '$1,234.56' */
export function formatMoney(cents, currency = 'MXN', { compact = false, sign = false, decimals } = {}) {
  const cur = CURRENCIES[currency] || CURRENCIES.MXN;
  const value = (cents || 0) / 100;
  const showDecimals = decimals ?? (Math.abs(value) >= 10000 && compact ? 0 : 2);

  const opts = {
    style: 'currency', currency: cur.code,
    minimumFractionDigits: showDecimals,
    maximumFractionDigits: showDecimals,
  };
  if (compact && Math.abs(value) >= 100000) {
    opts.notation = 'compact';
    opts.maximumFractionDigits = 1;
    opts.minimumFractionDigits = 0;
  }

  let out;
  try { out = new Intl.NumberFormat(cur.locale, opts).format(Math.abs(value)); }
  catch { out = cur.symbol + Math.abs(value).toFixed(showDecimals); }

  // USD и MXN оба рисуются как «$» — различаем явно, иначе путаница в итогах
  if (cur.code === 'USD') out = out.replace(/^\$/, 'US$');

  const neg = value < 0;
  if (neg) return '−' + out;
  if (sign && value > 0) return '+' + out;
  return out;
}

/** Короткая запись без символа валюты — для осей графиков. */
export function formatCompact(cents) {
  const v = Math.abs(cents || 0) / 100;
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.0', '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace('.0', '') + 'k';
  return String(Math.round(v));
}

/** Пересчёт между валютами по курсу к базовой. rates — сколько базовой за 1 единицу. */
export function convert(cents, from, to, rates) {
  if (from === to) return cents;
  const rFrom = from === rates.base ? 1 : rates.rates?.[from];
  const rTo = to === rates.base ? 1 : rates.rates?.[to];
  if (!rFrom || !rTo) return cents;              // курса нет — показываем как есть
  return Math.round((cents * rFrom) / rTo);
}

/* ─────────── Даты ─────────── */

/** Локальная дата в виде 'YYYY-MM-DD'. Namеренно без UTC: иначе поздний вечер
    в Мехико уезжает на следующий день. */
export function toISODate(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function fromISODate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(iso, n) {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function startOfMonth(iso) { return iso.slice(0, 7) + '-01'; }

export function endOfMonth(iso) {
  const d = fromISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function addMonths(iso, n) {
  const d = fromISODate(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // 31 января + 1 месяц = 28/29 февраля, а не 3 марта
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return toISODate(d);
}

/** Понедельник недели, содержащей дату (weekStart: 1 = пн, 0 = вс). */
export function startOfWeek(iso, weekStart = 1) {
  const d = fromISODate(iso);
  const shift = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - shift);
  return toISODate(d);
}

export function daysBetween(a, b) {
  return Math.round((fromISODate(b) - fromISODate(a)) / 86400000);
}

const LOCALE_BY_LANG = { ru: 'ru-RU', es: 'es-MX', en: 'en-GB' };

export function formatDate(iso, lang = 'ru', opts = { day: 'numeric', month: 'short' }) {
  try { return new Intl.DateTimeFormat(LOCALE_BY_LANG[lang] || 'ru-RU', opts).format(fromISODate(iso)); }
  catch { return iso; }
}

export function formatMonth(iso, lang = 'ru') {
  return formatDate(iso, lang, { month: 'long', year: 'numeric' });
}

export function weekdayNames(lang = 'ru', weekStart = 1, width = 'short') {
  const fmt = new Intl.DateTimeFormat(LOCALE_BY_LANG[lang] || 'ru-RU', { weekday: width });
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(2024, 0, 7 + ((weekStart + i) % 7));   // 7 янв 2024 — воскресенье
    out.push(fmt.format(d).replace('.', ''));
  }
  return out;
}

/** «Сегодня», «Вчера» или дата. */
export function relativeDay(iso, lang = 'ru', t) {
  const today = toISODate();
  if (iso === today) return t ? t('today') : 'Сегодня';
  if (iso === addDays(today, -1)) return t ? t('yesterday') : 'Вчера';
  if (iso === addDays(today, 1)) return t ? t('tomorrow') : 'Завтра';
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return formatDate(iso, lang, sameYear
    ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}
