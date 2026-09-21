/* Расчёт выплат владельцу/сотруднику по четырём режимам Мексики.
   Все суммы — в песо. Округление до центов делается только на выводе.

   Режимы:
     nomina      — официальный сотрудник с IMSS
     asimilados  — приравнено к зарплате для ISR, без IMSS
     resico      — физлицо выставляет счёт, упрощённый режим
     dividendos  — распределение прибыли (не зарплата) */

import { TAX_MX, isrWithholding, isrMonthly, resicoRate } from './tax-mx.js';

export const REGIMES = ['nomina', 'asimilados', 'resico', 'dividendos'];

const DAYS = 365 / 12;   // 30.4167 — принятое усреднение месяца для IMSS

const defaults = () => ({
  days: DAYS,
  riesgo: TAX_MX.imss.riesgoDefault,
  isnRate: TAX_MX.isn.CDMX,
  isnOnAsimilados: true,      // осторожная посылка: платим; уточнить у бухгалтера
  corporateISR: TAX_MX.corporate.isr,
  companyProfitable: true,    // если компания в убытке, вычет не даёт экономии
});

/* ─────────── Взносы IMSS ─────────── */

export function imssBreakdown(gross, opts = {}) {
  const o = { ...defaults(), ...opts };
  const { uma, imss } = TAX_MX;

  const dailySalary = gross / o.days;
  const sbcUncapped = dailySalary * imss.integrationFactor;
  const sbcCap = imss.sbcCapUMA * uma.daily;
  const sbc = Math.min(sbcUncapped, sbcCap);
  const capped = sbcUncapped > sbcCap;

  const base = sbc * o.days;                                     // месячная база
  const umaMonth = uma.daily * o.days;
  const excedente = Math.max(0, sbc - 3 * uma.daily) * o.days;    // сверх 3 UMA

  const e = imss.employee;
  const employee = {
    eymExcedente: e.eymExcedente * excedente,
    eymDinero:    e.eymDinero * base,
    invalidez:    e.invalidez * base,
    cesantia:     e.cesantia * base,
  };

  const p = imss.employer;
  // ставка cesantía работодателя зависит от размера базы в UMA
  const ceavRate = (sbc / uma.daily) >= imss.ceavTopFromUMA ? imss.ceavTop : imss.ceavBottom;

  const employer = {
    eymCuotaFija: p.eymCuotaFija * umaMonth,
    eymExcedente: p.eymExcedente * excedente,
    eymDinero:    p.eymDinero * base,
    gastosMedicos:p.gastosMedicos * base,
    riesgo:       o.riesgo * base,
    invalidez:    p.invalidez * base,
    guarderias:   p.guarderias * base,
    retiro:       p.retiro * base,
    cesantia:     ceavRate * base,
    infonavit:    p.infonavit * base,
  };

  const sum = (obj) => Object.values(obj).reduce((s, v) => s + v, 0);
  return {
    sbc, sbcDaily: sbc, capped, base,
    employee, employer,
    employeeTotal: sum(employee),
    employerTotal: sum(employer),
    ceavRate,
  };
}

/* ─────────── Расчёт по режиму от суммы брутто ─────────── */

export function calcFromGross(gross, regime, opts = {}) {
  const o = { ...defaults(), ...opts };
  gross = Math.max(0, gross);

  if (regime === 'nomina') {
    const imss = imssBreakdown(gross, o);
    const isr = isrWithholding(gross);
    const isn = o.isnRate * gross;
    const net = gross - isr - imss.employeeTotal;
    const companyCash = gross + imss.employerTotal + isn;

    /* Часть взносов — не налог, а накопления самой Киры:
       retiro и cesantía уходят на её Afore, INFONAVIT — на её жилищный субсчёт. */
    const toHerSavings = imss.employer.retiro + imss.employer.cesantia + imss.employer.infonavit;

    return finish({
      regime, gross, net, companyCash,
      deductible: companyCash,
      lines: {
        isr, imssEmployee: imss.employeeTotal,
        imssEmployer: imss.employerTotal, isn,
      },
      detail: { imss, toHerSavings },
      benefits: true,
      toHerSavings,
    }, o);
  }

  if (regime === 'asimilados') {
    const isr = isrWithholding(gross);
    const isn = o.isnOnAsimilados ? o.isnRate * gross : 0;
    const net = gross - isr;
    const companyCash = gross + isn;
    return finish({
      regime, gross, net, companyCash,
      deductible: companyCash,
      lines: { isr, imssEmployee: 0, imssEmployer: 0, isn },
      benefits: false,
    }, o);
  }

  if (regime === 'resico') {
    // IVA проходит насквозь: компания ставит к зачёту, Кира перечисляет в SAT
    const rate = resicoRate(gross);
    const isr = rate * gross;
    const net = gross - isr;
    return finish({
      regime, gross, net, companyCash: gross,
      deductible: gross,
      lines: { isr, imssEmployee: 0, imssEmployer: 0, isn: 0 },
      detail: {
        resicoRate: rate,
        ivaCharged: gross * TAX_MX.iva,
        isrRetainedByCompany: gross * TAX_MX.resicoRetentionByCompany,
        annualCap: TAX_MX.resicoAnnualCap,
        overCap: gross * 12 > TAX_MX.resicoAnnualCap,
        /* Совладелец или связанное лицо компании в RESICO быть не может
           (ст. 113-E LISR). Для собственника Koshtur этот режим закрыт. */
        blockedForShareholder: true,
      },
      benefits: false,
    }, o);
  }

  if (regime === 'dividendos') {
    // Здесь gross — это прибыль ДО налога на прибыль, которую отдаём
    const corpTax = o.corporateISR * gross;
    const distributable = gross - corpTax;
    const retention = TAX_MX.corporate.dividendRetention * distributable;
    const net = distributable - retention;
    return finish({
      regime, gross, net, companyCash: gross,
      deductible: 0,                       // дивиденды не уменьшают налог на прибыль
      lines: { isr: corpTax + retention, imssEmployee: 0, imssEmployer: 0, isn: 0 },
      detail: { corpTax, retention, distributable },
      benefits: false,
    }, o);
  }

  throw new Error('неизвестный режим: ' + regime);
}

/** Добавляет экономическую стоимость с учётом вычета по налогу на прибыль. */
function finish(r, o) {
  const shield = o.companyProfitable ? r.deductible * o.corporateISR : 0;
  const trueCost = r.companyCash - shield;
  const savings = r.toHerSavings || 0;
  return {
    ...r,
    taxShield: shield,
    trueCost,
    toHerSavings: savings,
    // во сколько обходится каждый песо, дошедший до Киры (меньше — лучше)
    costPerPeso: r.net > 0 ? trueCost / r.net : 0,
    // то же, но с зачётом накоплений, которые остаются её деньгами
    costPerPesoWithSavings: (r.net + savings) > 0 ? trueCost / (r.net + savings) : 0,
    // безвозвратно ушло государству
    totalTaxes: r.companyCash - r.net - savings,
  };
}

/* ─────────── Обратный счёт: от суммы «на руки» ─────────── */

/** Подбирает брутто так, чтобы на руки вышла заданная сумма.
    Половинное деление: функция «брутто → на руки» монотонна,
    но кусочно-линейна, поэтому формулой не решается. */
export function grossFromNet(net, regime, opts = {}) {
  if (net <= 0) return 0;
  let lo = net, hi = net * 5 + 10000;

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (calcFromGross(mid, regime, opts).net < net) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function calcFromNet(net, regime, opts = {}) {
  const gross = grossFromNet(net, regime, opts);
  return calcFromGross(gross, regime, opts);
}

/** Сравнение всех режимов при одной и той же сумме на руки. */
export function compareRegimes(net, opts = {}) {
  return REGIMES.map(regime => calcFromNet(net, regime, opts))
    .sort((a, b) => a.trueCost - b.trueCost);
}

/* ─────────── Годовые обязательства сверх месячной зарплаты ─────────── */

/** Агинальдо, отпускные и премия — обязательны при режиме nomina. */
export function annualExtras(monthlyGross, regime) {
  if (regime !== 'nomina') return null;
  const daily = monthlyGross / DAYS;
  const aguinaldo = daily * 15;            // минимум по закону — 15 дней
  const vacationDays = 12;                 // первый год работы
  const primaVacacional = daily * vacationDays * 0.25;
  return {
    aguinaldo, primaVacacional,
    total: aguinaldo + primaVacacional,
    note: 'Минимум по закону за первый год. Отпуск растёт с выслугой.',
  };
}
