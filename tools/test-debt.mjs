/* Проверка расчёта погашения долга.
   Главный тест — сверка с таблицей, которую BBVA печатает в самой
   выписке: если наша формула даёт те же сроки и переплату, значит
   модель описывает реальный договор, а не выдумана. */

import { monthlyRate, monthlyInterest, monthsToPayOff, payoffPlan,
         paymentForMonths, strategies, costOfWaiting, IVA } from '../apps/milpa/debt-math.js';

let failed = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'ОШИБКА'} ${label}${cond ? '' : '  ' + extra}`);
};
const near = (label, a, b, tol) =>
  ok(label, Math.abs(a - b) <= tol, `получили ${Math.round(a)}, ждали около ${Math.round(b)}`);

const peso = c => (c / 100).toLocaleString('es-MX', { maximumFractionDigits: 0 });

console.log('\n── Ставка и проценты за месяц ──');
{
  // 48.51% годовых, IVA на проценты 16%
  const r = monthlyRate(48.51, true);
  near('месячная ставка с IVA', r, 0.4851 / 12 * 1.16, 1e-9);
  ok('без IVA ставка ниже', monthlyRate(48.51, false) < r);

  const i = monthlyInterest(27400000, 48.51, true);
  console.log(`   на долг 274 000 набегает ${peso(i)} песо в месяц`);
  near('проценты за месяц', i, 27400000 * 0.4851 / 12 * 1.16, 100);
}

console.log('\n── Сверка с таблицей BBVA из выписки ──');
{
  /* В выписке за июль: остаток по обычным покупкам $49,909.89,
     минимальный платёж $3,750 → BBVA обещает 19 месяцев и $20,952.74
     переплаты. Подбираем ставку из этого же документа. */
  const balance = 4990989, payment = 375000;
  const plan = payoffPlan(balance, 39.66, payment, true);
  console.log(`   наш расчёт: ${plan.months} мес., переплата ${peso(plan.totalInterest)}`);
  console.log(`   у BBVA:     19 мес., переплата 20,953`);
  ok('срок совпадает с банковским', Math.abs(plan.months - 19) <= 1, `${plan.months} мес.`);
  near('переплата совпадает', plan.totalInterest, 2095274, 150000);
}

console.log('\n── Платёж не покрывает проценты ──');
{
  // 274 000 под 48.51% — минимальный платёж 3 750
  const plan = payoffPlan(27400000, 48.51, 375000, true);
  ok('долг не гасится никогда', plan.neverEnds === true);
  ok('срок не определён', plan.months === null);
  ok('показано, что долг растёт', plan.growth < 0);
  console.log(`   при платеже 3 750 долг растёт на ${peso(-plan.growth)} песо в месяц`);
}

console.log('\n── Обратный расчёт: платёж под срок ──');
{
  for (const months of [6, 12, 24, 36]) {
    const p = paymentForMonths(27400000, 48.51, months, true);
    const back = monthsToPayOff(27400000, 48.51, p, true);
    ok(`за ${months} мес. нужен платёж ${peso(p)} — и он действительно даёт ${months} мес.`,
       back === months, `получилось ${back}`);
  }
}

console.log('\n── Здравый смысл ──');
{
  const a = payoffPlan(10000000, 40, 500000, true);
  const b = payoffPlan(10000000, 40, 1000000, true);
  ok('больше платёж — меньше срок', b.months < a.months);
  ok('больше платёж — меньше переплата', b.totalInterest < a.totalInterest);
  ok('заплачено больше, чем взято', a.totalPaid > 10000000);
  ok('переплата = заплачено минус долг', Math.abs(a.totalInterest - (a.totalPaid - 10000000)) <= 1);

  const zero = payoffPlan(12000000, 0, 100000, true);
  ok('без процентов срок = долг делить на платёж', zero.months === 120);
  ok('без процентов переплаты нет', Math.abs(zero.totalInterest) <= 1);

  ok('нулевой долг гасится за ноль месяцев', monthsToPayOff(0, 40, 100000) === 0);
}

console.log('\n── Набор вариантов ──');
{
  const list = strategies(27400000, 48.51, 375000, true);
  console.log('   платёж → срок → переплата');
  for (const s of list) {
    console.log(`   ${peso(s.payment).padStart(8)} → ${s.neverEnds ? 'никогда' : s.months + ' мес.'}`
      + (s.neverEnds ? '' : ` → ${peso(s.totalInterest)}`));
  }
  ok('варианты идут по возрастанию платежа',
     list.every((s, i) => i === 0 || s.payment >= list[i - 1].payment));
  ok('минимальный платёж помечен как безнадёжный', list[0].neverEnds === true);
  ok('есть варианты, которые гасят долг', list.some(s => !s.neverEnds));
  ok('повторов по сумме нет', new Set(list.map(s => s.payment)).size === list.length);
}

console.log('\n── Цена промедления ──');
{
  const c = costOfWaiting(27400000, 48.51, true);
  console.log(`   каждый месяц ожидания стоит ${peso(c.perMonth)} песо, каждый день — ${peso(c.perDay)}`);
  ok('в месяц больше, чем в день', c.perMonth > c.perDay);
  near('день это месяц делить на 30', c.perDay, c.perMonth / 30.44, 200);
}

console.log(failed ? `\n  ПРОВАЛЕНО: ${failed}\n` : '\n  Все проверки пройдены.\n');
process.exit(failed ? 1 : 0);
