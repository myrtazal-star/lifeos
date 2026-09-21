/* Проверка разбора банковских выписок на нескольких реальных видах формата. */

import { decodeBytes, detectDelimiter, parseTable, findHeaderRow, parseDate,
         parseAmount, guessMapping, buildTransactions, fingerprint }
  from '../apps/milpa/csv.js';

let failed = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'ОШИБКА'} ${label}${cond ? '' : '  ' + extra}`);
};
const eq = (label, a, b) => ok(label, a === b, `получили ${JSON.stringify(a)}, ждали ${JSON.stringify(b)}`);

console.log('\n── Даты ──');
eq('15/09/2026', parseDate('15/09/2026'), '2026-09-15');
eq('2026-09-15', parseDate('2026-09-15'), '2026-09-15');
eq('15/SEP/2026', parseDate('15/SEP/2026'), '2026-09-15');
eq('15-sep-26', parseDate('15-sep-26'), '2026-09-15');
eq('01.03.2026', parseDate('01.03.2026'), '2026-03-01');
eq('день больше 12 — порядок ясен', parseDate('25/03/2026'), '2026-03-25');
eq('месяц больше 12 — меняем местами', parseDate('03/25/2026'), '2026-03-25');
eq('американский порядок по просьбе', parseDate('03/04/2026', { dayFirst: false }), '2026-03-04');
eq('мусор', parseDate('n/a'), null);
eq('пусто', parseDate(''), null);

console.log('\n── Суммы ──');
eq('1,234.56', parseAmount('1,234.56'), 123456);
eq('1.234,56 (европейский)', parseAmount('1.234,56'), 123456);
eq('со знаком минус', parseAmount('-500.00'), -50000);
eq('минус в конце', parseAmount('500.00-'), -50000);
eq('в скобках — отрицательное', parseAmount('(1,234.56)'), -123456);
eq('с валютой', parseAmount('$ 1,234.56 MXN'), 123456);
eq('без копеек', parseAmount('2,500'), 250000);
eq('пусто', parseAmount(''), null);
eq('текст', parseAmount('SALDO'), null);

console.log('\n── Разделитель ──');
eq('точка с запятой', detectDelimiter('a;b;c\n1;2;3\n4;5;6'), ';');
eq('запятая', detectDelimiter('a,b,c\n1,2,3\n4,5,6'), ',');
eq('табуляция', detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');

console.log('\n── Выписка в духе BBVA: шапка,CARGO/ABONO, точка с запятой ──');
const bbva = [
  'BBVA MEXICO',
  'CUENTA;0123456789',
  'PERIODO;01/09/2026 AL 30/09/2026',
  '',
  'FECHA;DESCRIPCIÓN;CARGO;ABONO;SALDO',
  '15/09/2026;PAGO OXXO SUC 2213;450.50;;12,345.67',
  '16/09/2026;TRASPASO RECIBIDO COMISION;;25,000.00;37,345.67',
  '17/09/2026;RENTA OFICINA POLANCO;18,000.00;;19,345.67',
].join('\n');

const t1 = parseTable(bbva);
eq('разделитель определён', t1.delimiter, ';');
const h1 = findHeaderRow(t1.rows);
// пустые строки при разборе отбрасываются, поэтому шапка — четвёртая по счёту,
// но третья по индексу
eq('строка шапки найдена', h1, 3);
const map1 = guessMapping(t1.rows[h1], t1.rows.slice(h1 + 1));
eq('колонка даты', map1.date, 0);
eq('колонка описания', map1.desc, 1);
eq('колонка списаний', map1.debit, 2);
eq('колонка поступлений', map1.credit, 3);
eq('колонка остатка', map1.balance, 4);

const b1 = buildTransactions(t1.rows.slice(h1 + 1), map1);
eq('операций разобрано', b1.transactions.length, 3);
eq('первая — расход', b1.transactions[0].kind, 'expense');
eq('сумма первой', b1.transactions[0].amount, 45050);
eq('вторая — доход', b1.transactions[1].kind, 'income');
eq('сумма второй', b1.transactions[1].amount, 2500000);
eq('описание сохранено', b1.transactions[2].note, 'RENTA OFICINA POLANCO');
ok('остаток не принят за сумму', b1.transactions[0].amount !== 1234567);

console.log('\n── Одна колонка суммы со знаком, запятая, ISO-даты ──');
const single = [
  'Date,Description,Amount',
  '2026-09-15,"Uber, viaje aeropuerto",-350.00',
  '2026-09-16,Deposito cliente,15000.00',
].join('\n');
const t2 = parseTable(single);
const h2 = findHeaderRow(t2.rows);
const map2 = guessMapping(t2.rows[h2], t2.rows.slice(h2 + 1));
const b2 = buildTransactions(t2.rows.slice(h2 + 1), map2);
eq('операций', b2.transactions.length, 2);
eq('запятая внутри кавычек не разорвала поле', b2.transactions[0].note, 'Uber, viaje aeropuerto');
eq('минус — расход', b2.transactions[0].kind, 'expense');
eq('плюс — доход', b2.transactions[1].kind, 'income');

console.log('\n── Без шапки, табуляция, формат 15/SEP/2026 ──');
const noHeader = [
  '15/SEP/2026\tPAGO CFE LUZ\t-1,250.00',
  '16/SEP/2026\tCOMISION VENTA\t45,000.00',
].join('\n');
const t3 = parseTable(noHeader);
const h3 = findHeaderRow(t3.rows);
eq('шапки нет', h3, -1);
const rows3 = t3.rows.slice(h3 + 1);
const map3 = guessMapping(rows3[0].map((_, i) => 'col' + i), rows3);
eq('дата найдена по содержимому', map3.date, 0);
eq('сумма найдена по содержимому', map3.amount, 2);
const b3 = buildTransactions(rows3, map3);
eq('операций', b3.transactions.length, 2);
eq('расход', b3.transactions[0].kind, 'expense');
eq('сумма', b3.transactions[0].amount, 125000);

console.log('\n── Кодировка Windows-1252 ──');
const latin = new Uint8Array([
  0x46, 0x45, 0x43, 0x48, 0x41, 0x3b, 0x44, 0x45, 0x53, 0x43, 0x52, 0x49,
  0x50, 0x43, 0x49, 0xd3, 0x4e, 0x0a,                    // FECHA;DESCRIPCIÓN
  0x31, 0x35, 0x2f, 0x30, 0x39, 0x2f, 0x32, 0x36, 0x3b,  // 15/09/26;
  0x43, 0x41, 0x46, 0xc9,                                 // CAFÉ
]);
const decoded = decodeBytes(latin.buffer);
ok('Ó распознана', decoded.includes('DESCRIPCIÓN'), decoded);
ok('É распознана', decoded.includes('CAFÉ'), decoded);
const utf8 = new TextEncoder().encode('FECHA;DESCRIPCIÓN\n15/09/26;CAFÉ');
ok('UTF-8 не испорчен', decodeBytes(utf8.buffer).includes('DESCRIPCIÓN'));

console.log('\n── Защита от повторной загрузки ──');
const a = { date: '2026-09-15', kind: 'expense', amount: 45050, note: 'PAGO OXXO SUC 2213' };
const b = { date: '2026-09-15', kind: 'expense', amount: 45050, note: 'pago oxxo   suc 2213' };
const c = { date: '2026-09-15', kind: 'expense', amount: 45051, note: 'PAGO OXXO SUC 2213' };
eq('одна и та же операция даёт один отпечаток', fingerprint(a), fingerprint(b));
ok('разная сумма — разный отпечаток', fingerprint(a) !== fingerprint(c));

console.log('\n── Строки без даты или суммы пропускаются ──');
const dirty = [
  'FECHA;CONCEPTO;IMPORTE',
  '15/09/2026;COMPRA;-100.00',
  'TOTAL;;−100.00',
  ';SIN FECHA;-50.00',
].join('\n');
const t4 = parseTable(dirty);
const h4 = findHeaderRow(t4.rows);
const map4 = guessMapping(t4.rows[h4], t4.rows.slice(h4 + 1));
const b4 = buildTransactions(t4.rows.slice(h4 + 1), map4);
eq('принята только настоящая операция', b4.transactions.length, 1);
eq('остальные отложены', b4.skipped.length, 2);

console.log(failed ? `\n  ПРОВАЛЕНО: ${failed}\n` : '\n  Все проверки пройдены.\n');
process.exit(failed ? 1 : 0);
