/* Проверка налоговых расчётов. Ожидаемые значения посчитаны вручную
   по опубликованной тарифе, а не взяты из самого кода. */

import { TAX_MX, isrMonthly, isrWithholding, resicoRate } from '../apps/kapital/tax-mx.js';
import { calcFromGross, calcFromNet, grossFromNet, imssBreakdown, compareRegimes, annualExtras }
  from '../apps/kapital/nomina.js';

let failed = 0;
const money = n => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function eq(label, actual, expected, tol = 0.02) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'ОШИБКА'} ${label}: ${money(actual)}${ok ? '' : ` (ждали ${money(expected)})`}`);
}
function ok(label, cond) {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'ОШИБКА'} ${label}`);
}

console.log('\n── ISR по тарифе (ст. 96 LISR, 2026) ──');
// 50 000: строка 35 362.84 → 5 665.16 + (50 000 − 35 362.84) × 23.52%
eq('ISR с 50 000', isrMonthly(50000), 5665.16 + (50000 - 35362.84) * 0.2352);
eq('ISR с 50 000 — вручную', isrMonthly(50000), 9107.82);
// 10 000: строка 7 168.52 → 420.95 + (10 000 − 7 168.52) × 10.88%
eq('ISR с 10 000', isrMonthly(10000), 729.02, 0.01);
// граница строки: ровно на límite inferior налог равен cuota fija
eq('ISR ровно на границе 35 362.84', isrMonthly(35362.84), 5665.16);
eq('ISR ровно на границе 106 410.51', isrMonthly(106410.51), 25659.23);
// верхняя строка
eq('ISR с 500 000', isrMonthly(500000), 133488.54 + (500000 - 425642) * 0.35);

console.log('\n── Субсидия занятости ──');
eq('удержание с 10 000 (субсидия применяется)', isrWithholding(10000), 729.02 - 535.65, 0.01);
eq('удержание с 50 000 (субсидия не положена)', isrWithholding(50000), 9107.82);
ok('удержание никогда не отрицательное', isrWithholding(3000) >= 0);

console.log('\n── Взносы IMSS ──');
const b = imssBreakdown(50000);
const sumE = Object.values(b.employee).reduce((s, v) => s + v, 0);
const sumP = Object.values(b.employer).reduce((s, v) => s + v, 0);
eq('сумма долей работника сходится', sumE, b.employeeTotal, 0.001);
eq('сумма долей работодателя сходится', sumP, b.employerTotal, 0.001);
ok('база не превышает потолок 25 UMA', b.sbc <= 25 * TAX_MX.uma.daily + 0.001);
ok('при 50 000 потолок ещё не достигнут', !b.capped);
eq('ставка cesantía работодателя — верхняя', b.ceavRate, TAX_MX.imss.ceavTop, 0);

const high = imssBreakdown(300000);
ok('при 300 000 база упирается в потолок', high.capped);
const higher = imssBreakdown(600000);
eq('выше потолка взносы работодателя не растут', higher.employerTotal, high.employerTotal, 0.01);
console.log(`       (потолок базы: ${money(25 * TAX_MX.uma.daily)} песо в день)`);

console.log('\n── Обратный счёт от суммы «на руки» ──');
for (const regime of ['nomina', 'asimilados', 'resico', 'dividendos']) {
  for (const target of [20000, 50000, 120000]) {
    const r = calcFromNet(target, regime);
    eq(`${regime.padEnd(11)} на руки ${money(target)}`, r.net, target, 0.5);
  }
}

console.log('\n── Логика режимов ──');
const n50 = calcFromGross(50000, 'nomina');
const a50 = calcFromGross(50000, 'asimilados');
ok('при равном брутто asimilados даёт больше на руки, чем nómina', a50.net > n50.net);
ok('nómina дороже для компании, чем asimilados', n50.companyCash > a50.companyCash);
ok('RESICO — самый дешёвый по налогам', calcFromGross(50000, 'resico').totalTaxes < a50.totalTaxes);
ok('RESICO помечен как закрытый для совладельца',
   calcFromGross(50000, 'resico').detail.blockedForShareholder === true);
ok('при nómina часть взносов возвращается Кире накоплениями', n50.toHerSavings > 0);
ok('у asimilados накоплений нет', (a50.toHerSavings || 0) === 0);
ok('песо на руки при nómina дороже, чем при asimilados', n50.costPerPeso > a50.costPerPeso);
ok('дивиденды не уменьшают налог на прибыль', calcFromGross(50000, 'dividendos').taxShield === 0);
ok('зарплата уменьшает налог на прибыль', n50.taxShield > 0);

console.log('\n── Монотонность ──');
let prev = -1, mono = true;
for (let g = 5000; g <= 400000; g += 5000) {
  const net = calcFromGross(g, 'nomina').net;
  if (net <= prev) mono = false;
  prev = net;
}
ok('больше брутто — всегда больше на руки', mono);

console.log('\n── Годовые обязательства ──');
const extras = annualExtras(50000, 'nomina');
eq('агинальдо — 15 дней оклада', extras.aguinaldo, 50000 / (365 / 12) * 15, 0.01);
ok('для asimilados годовых обязательств нет', annualExtras(50000, 'asimilados') === null);

console.log('\n── RESICO ──');
eq('ставка при 20 000', resicoRate(20000), 0.0100, 0);
eq('ставка при 50 000', resicoRate(50000), 0.0110, 0);
eq('ставка при 100 000', resicoRate(100000), 0.0200, 0);
ok('превышение годового потолка помечается',
   calcFromGross(300000, 'resico').detail.overCap === true);

console.log(failed ? `\n  ПРОВАЛЕНО ПРОВЕРОК: ${failed}\n` : '\n  Все проверки пройдены.\n');
process.exit(failed ? 1 : 0);
