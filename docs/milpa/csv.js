/* Разбор банковских выписок. Только чистые функции, без обращения к странице —
   поэтому всё, что здесь есть, проверяется тестами в обычном Node.

   Банки выгружают по-разному: где-то одна колонка суммы со знаком,
   где-то отдельные «списание» и «поступление»; даты бывают 15/09/2026,
   2026-09-15 и 15/SEP/2026; кодировка нередко не UTF-8. */

/* ─────────── Кодировка ─────────── */

/** Байты файла → текст. Выписки из мексиканских банков часто в Windows-1252. */
export function decodeBytes(buffer) {
  const bytes = new Uint8Array(buffer);

  // метка порядка байтов — файл точно UTF-8
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // U+FFFD появляется там, где байты не складываются в UTF-8
  const broken = (utf8.match(/�/g) || []).length;
  if (broken === 0) return utf8;

  try { return new TextDecoder('windows-1252').decode(bytes); }
  catch { return utf8; }
}

/* ─────────── Разделитель и строки ─────────── */

const CANDIDATES = [';', ',', '\t', '|'];

/** Какой символ разделяет колонки: тот, что даёт одинаковое число полей в строках. */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 20);
  if (!lines.length) return ',';

  let best = ',', bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map(l => splitLine(l, d).length);
    const max = Math.max(...counts);
    if (max < 2) continue;
    // ровные строки — признак верного разделителя
    const same = counts.filter(c => c === max).length / counts.length;
    const score = same * 10 + Math.min(max, 12);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** Разбор одной строки с учётом кавычек и удвоенных кавычек внутри поля. */
function splitLine(line, delimiter) {
  const out = [];
  let field = '', inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field); field = '';
    } else field += ch;
  }
  out.push(field);
  return out.map(f => f.trim());
}

/** Текст → таблица. Учитывает переносы строк внутри кавычек. */
export function parseTable(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let line = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { inQuotes = !inQuotes; line += ch; continue; }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (line.trim()) rows.push(splitLine(line, d));
      line = '';
      continue;
    }
    line += ch;
  }
  if (line.trim()) rows.push(splitLine(line, d));

  return { rows, delimiter: d };
}

/** Банки часто пишут шапку с реквизитами до самой таблицы.
    Ищем строку, после которой идут одинаковые по длине строки с датами. */
export function findHeaderRow(rows) {
  const widths = rows.map(r => r.length);
  const mode = widths.sort((a, b) =>
    widths.filter(w => w === b).length - widths.filter(w => w === a).length)[0];

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    if (rows[i].length !== mode) continue;
    const next = rows[i + 1];
    if (!next || next.length !== mode) continue;
    // в следующей строке должна быть дата, а в самой строке — нет
    if (looksLikeDate(next.join(' ')) && !looksLikeDate(rows[i].join(' '))) return i;
  }
  // шапки нет — считаем, что данные с первой строки
  return rows.length && looksLikeDate(rows[0].join(' ')) ? -1 : 0;
}

function looksLikeDate(s) {
  return /\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-][A-Za-zÁ-úñÑ]{3}[\/.\-]\d{2,4}/.test(s);
}

/* ─────────── Даты ─────────── */

const MONTHS = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12,
};

/** Строка с датой → 'YYYY-MM-DD'. null, если не разобралась. */
export function parseDate(raw, { dayFirst = true } = {}) {
  const s = String(raw || '').trim();
  if (!s) return null;

  // 2026-09-15
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  // 15/SEP/2026 или 15-sep-26
  m = s.match(/(\d{1,2})[\/.\-]([A-Za-zÁ-úñÑ]{3,})[\/.\-](\d{2,4})/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return iso(year(+m[3]), mon, +m[1]);
  }

  // 15/09/2026 или 09/15/2026
  m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    let d = +m[1], mo = +m[2];
    // если первое число больше 12 — это точно день, порядок ясен без догадок
    if (d > 12) { /* день первым */ }
    else if (mo > 12) { [d, mo] = [mo, d]; }
    else if (!dayFirst) { [d, mo] = [mo, d]; }
    return iso(year(+m[3]), mo, d);
  }

  return null;
}

const year = (y) => (y < 100 ? 2000 + y : y);
const iso = (y, m, d) => {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const p = n => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
};

/* ─────────── Суммы ─────────── */

/** Строка суммы → целые центы со знаком. '(1,234.56)' и '1.234,56' понимаются. */
export function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;

  // бухгалтерская запись отрицательного числа
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s) || /-$/.test(s)) negative = true;

  s = s.replace(/[\s  '$€₱]/g, '').replace(/MXN|USD|MN|DLS/gi, '');
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    const dec = lastComma > lastDot ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma > -1) {
    s = (s.length - lastComma - 1) <= 2 ? s.replace(',', '.') : s.split(',').join('');
  } else if (lastDot > -1 && (s.length - lastDot - 1) > 2) {
    s = s.split('.').join('');
  }

  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(Math.abs(n) * 100);
  return negative ? -cents : cents;
}

/* ─────────── Угадывание колонок ─────────── */

const HINTS = {
  date:   ['fecha', 'date', 'дата', 'f. operacion', 'fecha operacion', 'fecha de operacion'],
  desc:   ['descripcion', 'concepto', 'description', 'detalle', 'referencia', 'beneficiario', 'описание'],
  amount: ['importe', 'monto', 'amount', 'cantidad', 'сумма'],
  debit:  ['cargo', 'cargos', 'retiro', 'retiros', 'debito', 'débito', 'debit', 'egreso'],
  credit: ['abono', 'abonos', 'deposito', 'depósito', 'credito', 'crédito', 'credit', 'ingreso'],
  balance:['saldo', 'balance'],
};

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Предположить, какая колонка за что отвечает. Пользователь потом поправит. */
export function guessMapping(headers, sampleRows) {
  const h = headers.map(norm);
  const pick = (key, exclude = []) => {
    for (const hint of HINTS[key]) {
      const i = h.findIndex((x, idx) => !exclude.includes(idx) && x.includes(hint));
      if (i > -1) return i;
    }
    return -1;
  };

  const date = pick('date');
  const balance = pick('balance');
  const debit = pick('debit', [balance]);
  const credit = pick('credit', [balance, debit]);
  let amount = pick('amount', [balance, debit, credit]);
  const desc = pick('desc', [balance]);

  // Шапки может не быть вовсе — тогда смотрим на сами значения
  const byContent = () => {
    const cols = headers.length;
    const stats = Array.from({ length: cols }, () => ({ dates: 0, nums: 0, text: 0 }));
    for (const row of sampleRows.slice(0, 15)) {
      row.forEach((v, i) => {
        if (!stats[i]) return;
        if (parseDate(v)) stats[i].dates++;
        else if (parseAmount(v) !== null && /\d/.test(v)) stats[i].nums++;
        else if (String(v).trim().length > 3) stats[i].text++;
      });
    }
    return stats;
  };

  if (date === -1 || (amount === -1 && debit === -1 && credit === -1)) {
    const stats = byContent();
    const bestDate = date > -1 ? date : stats.findIndex(s => s.dates >= 2);
    const numCols = stats.map((s, i) => ({ i, n: s.nums }))
      .filter(x => x.n >= 2 && x.i !== bestDate)
      .sort((a, b) => b.n - a.n);
    const bestText = stats.map((s, i) => ({ i, n: s.text }))
      .filter(x => x.i !== bestDate).sort((a, b) => b.n - a.n)[0];

    return {
      date: bestDate,
      desc: desc > -1 ? desc : (bestText ? bestText.i : -1),
      // последняя числовая колонка обычно остаток, поэтому берём первую
      amount: amount > -1 ? amount : (numCols[0] ? numCols[0].i : -1),
      debit: debit > -1 ? debit : -1,
      credit: credit > -1 ? credit : -1,
      balance: balance > -1 ? balance : (numCols.length > 1 ? numCols.at(-1).i : -1),
    };
  }

  return { date, desc, amount, debit, credit, balance };
}

/* ─────────── Сбор операций ─────────── */

/** Строки таблицы + разметка колонок → список операций.
    kind определяется знаком: минус — расход, плюс — доход. */
export function buildTransactions(rows, mapping, { dayFirst = true } = {}) {
  const out = [];
  const skipped = [];

  for (const row of rows) {
    const date = parseDate(row[mapping.date], { dayFirst });
    if (!date) { skipped.push({ row, reason: 'дата' }); continue; }

    let cents = null;
    if (mapping.debit > -1 || mapping.credit > -1) {
      const debit = mapping.debit > -1 ? parseAmount(row[mapping.debit]) : null;
      const credit = mapping.credit > -1 ? parseAmount(row[mapping.credit]) : null;
      if (debit) cents = -Math.abs(debit);
      else if (credit) cents = Math.abs(credit);
    } else if (mapping.amount > -1) {
      cents = parseAmount(row[mapping.amount]);
    }

    if (cents === null || cents === 0) { skipped.push({ row, reason: 'сумма' }); continue; }

    out.push({
      date,
      amount: Math.abs(cents),
      kind: cents < 0 ? 'expense' : 'income',
      note: mapping.desc > -1 ? String(row[mapping.desc] || '').trim() : '',
      raw: row,
    });
  }

  return { transactions: out, skipped };
}

/** Отпечаток операции — чтобы одна и та же не попала дважды
    при пересекающихся периодах выгрузки. */
export function fingerprint(tx) {
  const note = String(tx.note || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 40);
  return `${tx.date}|${tx.kind}|${tx.amount}|${note}`;
}
