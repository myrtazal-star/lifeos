/* Налоговые ставки Мексики на 2026 год.
   Один файл — одно место для ежегодного обновления. Раз в год бухгалтер
   сверяет цифры с публикацией в DOF и правит только здесь.

   Суммы в этом файле — в песо (как их публикуют), не в центах. */

export const TAX_MX = {
  year: 2026,
  checkedAt: '2026-09-21',

  sources: [
    ['Тарифа ISR, ст. 96 LISR, Anexo 8 RMF 2026 (DOF 28.12.2025)', 'https://sdv.com.mx/compendio/tarifas-tablas-isr/tarifas-2026/'],
    ['Взносы IMSS и INFONAVIT 2026', 'https://sdv.com.mx/recursos/tablas-imss-2026/'],
    ['Impuesto sobre nóminas CDMX — 4% с 01.01.2025', 'https://www.jadelrio.com/mx/es/blogs/incremento-al-impuesto-sobre-nomina-en-cdmx'],
    ['RESICO для физлиц 2026', 'https://facturama.mx/blog/tablas-resico/'],
  ],

  /* Unidad de Medida y Actualización — от неё считаются потолки IMSS */
  uma: { daily: 113.14 },

  /* Месячная тарифа ISR: налог = cuota + (доход − from) × rate */
  isrMonthly: [
    { from: 0.01,      fixed: 0.00,      rate: 0.0192 },
    { from: 844.60,    fixed: 16.22,     rate: 0.0640 },
    { from: 7168.52,   fixed: 420.95,    rate: 0.1088 },
    { from: 12598.03,  fixed: 1011.68,   rate: 0.1600 },
    { from: 14644.65,  fixed: 1339.14,   rate: 0.1792 },
    { from: 17533.65,  fixed: 1856.84,   rate: 0.2136 },
    { from: 35362.84,  fixed: 5665.16,   rate: 0.2352 },
    { from: 55736.69,  fixed: 10457.09,  rate: 0.3000 },
    { from: 106410.51, fixed: 25659.23,  rate: 0.3200 },
    { from: 141880.67, fixed: 37009.69,  rate: 0.3400 },
    { from: 425642.00, fixed: 133488.54, rate: 0.3500 },
  ],

  /* Subsidio para el empleo — с 2024 года фиксированная сумма, а не таблица.
     ВНИМАНИЕ: источники расходятся (535.65 при потолке 11 492.66 против
     406.83 при потолке 9 081). На зарплатах выше 11 500 песо субсидия равна
     нулю в обоих вариантах, поэтому на расчёт Киры это не влияет.
     Для низких зарплат — сверить с бухгалтером. */
  subsidio: { monthly: 535.65, incomeCap: 11492.66, needsCheck: true },

  imss: {
    /* Потолок базы взносов — 25 UMA в день (ст. 28 LSS).
       Выше этой зарплаты взносы перестают расти. */
    sbcCapUMA: 25,

    /* Фактор интеграции: оклад + агинальдо 15 дней + отпуск 12 дней
       + отпускная премия 25%. (365 + 15 + 3) / 365 */
    integrationFactor: 1.0493,

    /* Доля работника, в долях от базы (SBC) */
    employee: {
      eymExcedente: 0.00625,   // сверх 3 UMA
      eymDinero:    0.0025,
      invalidez:    0.00625,
      cesantia:     0.01125,
    },

    /* Доля работодателя */
    employer: {
      eymCuotaFija: 0.2040,    // от UMA, а не от зарплаты
      eymExcedente: 0.0110,    // сверх 3 UMA
      eymDinero:    0.0070,
      gastosMedicos:0.0105,
      invalidez:    0.0175,
      guarderias:   0.0100,
      retiro:       0.0200,
      infonavit:    0.0500,
    },

    /* Riesgo de trabajo — зависит от класса предприятия.
       Офис недвижимости — класс I, минимальная ставка. */
    riesgoDefault: 0.0054,

    /* Cesantía y vejez работодателя — растёт по годам до 11.875% к 2030.
       Ставка зависит от размера SBC в UMA; при SBC выше 4 UMA
       (примерно 13 800 песо в месяц) действует верхняя. */
    ceavTop: 0.0751,
    ceavBottom: 0.0315,
    ceavTopFromUMA: 4.01,
  },

  /* Налог на фонд оплаты труда, ставка штата */
  isn: { CDMX: 0.04, EdoMex: 0.03, Jalisco: 0.02, NuevoLeon: 0.03 },

  /* RESICO для физлиц: ставка к полной выручке месяца без IVA */
  resico: [
    { to: 25000,  rate: 0.0100 },
    { to: 50000,  rate: 0.0110 },
    { to: 83333,  rate: 0.0150 },
    { to: 208333, rate: 0.0200 },
    { to: 291666, rate: 0.0250 },
  ],
  resicoRetentionByCompany: 0.0125,
  resicoAnnualCap: 3500000,

  /* Обычные honorarios (не RESICO): удержания компании-плательщика */
  honorarios: { isrRetention: 0.10, ivaRetentionFraction: 2 / 3 },

  iva: 0.16,

  /* Компания */
  corporate: { isr: 0.30, dividendRetention: 0.10 },
};

/** ISR по месячной тарифе. Возвращает налог до вычета субсидии. */
export function isrMonthly(income) {
  if (income <= 0) return 0;
  const t = TAX_MX.isrMonthly;
  let row = t[0];
  for (const r of t) if (income >= r.from) row = r; else break;
  return row.fixed + (income - row.from) * row.rate;
}

/** Удержание ISR с зарплаты: тариф минус субсидия, не ниже нуля. */
export function isrWithholding(income) {
  const tax = isrMonthly(income);
  const s = TAX_MX.subsidio;
  const subsidy = income <= s.incomeCap ? s.monthly : 0;
  return Math.max(0, tax - subsidy);
}

/** Ставка RESICO для месячной выручки. */
export function resicoRate(monthlyIncome) {
  for (const r of TAX_MX.resico) if (monthlyIncome <= r.to) return r.rate;
  return TAX_MX.resico[TAX_MX.resico.length - 1].rate;
}
