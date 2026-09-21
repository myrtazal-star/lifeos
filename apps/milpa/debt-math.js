/* Расчёт погашения долга.

   Только чистые функции, без обращения к хранилищу и странице —
   поэтому всё проверяется обычными тестами. Суммы в центах.

   Проценты в Мексике облагаются IVA, поэтому реальная цена долга выше
   объявленной ставки. Это учитывается отдельным множителем. */

export const IVA = 0.16;

/** Месячная ставка с учётом IVA на проценты. apr — годовая в процентах. */
export function monthlyRate(apr, withIva = true) {
  const base = (Number(apr) || 0) / 100 / 12;
  return withIva ? base * (1 + IVA) : base;
}

/** Сколько процентов набежит за месяц на текущий остаток. */
export function monthlyInterest(balance, apr, withIva = true) {
  return Math.round(balance * monthlyRate(apr, withIva));
}

/**
 * Сколько месяцев гасить долг при платеже payment в месяц.
 * Возвращает null, если платёж не перекрывает проценты — долг не гасится никогда.
 */
export function monthsToPayOff(balance, apr, payment, withIva = true) {
  if (balance <= 0) return 0;
  if (!(payment > 0)) return null;        // без платежа долг не гасится
  const i = monthlyRate(apr, withIva);
  if (i <= 0) return Math.ceil(balance / payment);

  const interest = balance * i;
  if (payment <= interest) return null;       // платёж уходит в проценты целиком

  // обычная формула аннуитета
  const n = -Math.log(1 - (balance * i) / payment) / Math.log(1 + i);
  return Math.ceil(n);
}

/** Полная картина по одному варианту платежа. */
export function payoffPlan(balance, apr, payment, withIva = true) {
  const months = monthsToPayOff(balance, apr, payment, withIva);
  const interestNow = monthlyInterest(balance, apr, withIva);

  if (months === null) {
    return { payment, months: null, neverEnds: true, interestNow,
             totalPaid: null, totalInterest: null,
             growth: payment - interestNow };   // отрицательное: долг растёт
  }

  // последний платёж обычно меньше остальных — считаем по остатку
  const i = monthlyRate(apr, withIva);
  let left = balance, paid = 0;
  // предохранитель: цикл не должен зависеть только от арифметики,
  // иначе неудачные входные данные вешают вкладку намертво
  const guard = Math.min(months, 1200);
  for (let m = 0; m < guard && left > 0; m++) {
    const add = left * i;
    const step = Math.min(payment, left + add);
    paid += step;
    left = left + add - step;
  }

  return {
    payment, months, neverEnds: false, interestNow,
    totalPaid: Math.round(paid),
    totalInterest: Math.round(paid - balance),
  };
}

/** Какой платёж нужен, чтобы закрыть долг ровно за months месяцев. */
export function paymentForMonths(balance, apr, months, withIva = true) {
  if (months <= 0 || balance <= 0) return 0;
  const i = monthlyRate(apr, withIva);
  if (i <= 0) return Math.ceil(balance / months);
  return Math.ceil((balance * i) / (1 - Math.pow(1 + i, -months)));
}

/**
 * Готовые варианты для сравнения: минимальный платёж, кратные ему
 * и сроки «за год» / «за два года».
 */
export function strategies(balance, apr, minPayment, withIva = true) {
  const out = [];
  const seen = new Set();
  const add = (key, payment, label) => {
    const p = Math.round(payment);
    if (p <= 0 || seen.has(p)) return;
    seen.add(p);
    out.push({ key, label, ...payoffPlan(balance, apr, p, withIva) });
  };

  if (minPayment > 0) {
    add('min', minPayment, 'min');
    add('min2', minPayment * 2, 'min2');
    add('min3', minPayment * 3, 'min3');
  }
  add('y2', paymentForMonths(balance, apr, 24, withIva), 'y2');
  add('y1', paymentForMonths(balance, apr, 12, withIva), 'y1');
  add('m6', paymentForMonths(balance, apr, 6, withIva), 'm6');

  return out.sort((a, b) => a.payment - b.payment);
}

/** Во сколько обходится каждый месяц промедления. */
export function costOfWaiting(balance, apr, withIva = true) {
  return { perMonth: monthlyInterest(balance, apr, withIva),
           perDay: Math.round(monthlyInterest(balance, apr, withIva) / 30.44) };
}
