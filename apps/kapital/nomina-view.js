/* Экран «Зарплата и налоги»: расчёт от суммы на руки и сравнение режимов. */

import { el, sheet, toast, segmented, field, input, select, haptic }
  from './shared/js/ui.js';
import { formatMoney, parseMoney, toISODate } from './shared/js/format.js';
import { TAX_MX } from './tax-mx.js';
import { calcFromNet, calcFromGross, compareRegimes, annualExtras, REGIMES } from './nomina.js';
import * as D from './data.js';

/* Движок считает в песо, приложение хранит центы */
const toCents = (pesos) => Math.round(pesos * 100);
const mx = (pesos, opts) => formatMoney(toCents(pesos), 'MXN', { decimals: 0, ...opts });

const state = {
  net: 50000,
  regime: 'nomina',
  from: 'net',        // считаем от «на руки» или от брутто
  isnState: 'CDMX',
};

export function nominaSheet({ t, lang, onDone }) {
  let s;
  const body = el('div.stack');

  function render() {
    const opts = { isnRate: TAX_MX.isn[state.isnState] };
    const r = state.from === 'net'
      ? calcFromNet(state.net, state.regime, opts)
      : calcFromGross(state.net, state.regime, opts);
    const all = compareRegimes(state.from === 'net' ? state.net : r.net, opts);
    const extras = annualExtras(r.gross, state.regime);

    /* replaceChildren, в отличие от el(), не отсеивает false —
       поэтому скрытые блоки пришлось бы печатать текстом. Фильтруем сами. */
    const parts = [
      segmented([
        { value: 'net', label: t('nom_from_net') },
        { value: 'gross', label: t('nom_from_gross') },
      ], state.from, v => { state.from = v; render(); }),

      el('div.card.card--flat', {}, [
        input({
          class: 'input--amount', inputmode: 'decimal', value: String(state.net),
          'aria-label': t('amount'),
          oninput: e => { state.net = parseMoney(e.target.value) / 100; },
          onchange: () => render(),
        }),
        el('div.small.muted', { style: { textAlign: 'center', marginTop: '2px' },
          text: state.from === 'net' ? t('nom_net_hint') : t('nom_gross_hint') }),
      ]),

      segmented(REGIMES.map(x => ({ value: x, label: t('nom_' + x) })), state.regime,
        v => { state.regime = v; haptic(); render(); }, { accent: true }),

      state.regime === 'resico' && r.detail?.blockedForShareholder &&
        warning(t('nom_resico_blocked')),

      state.regime === 'resico' && r.detail?.overCap &&
        warning(t('nom_resico_cap', { v: mx(TAX_MX.resicoAnnualCap) })),

      /* Разбор расчёта */
      el('div.card', {}, [
        el('div.card__title', { style: { marginBottom: '12px' }, text: t('nom_breakdown') }),
        el('div.list', {}, [
          line(t('nom_gross'), mx(r.gross), 'strong'),
          r.lines.isr > 0 && line(
            state.regime === 'dividendos' ? t('nom_isr_corp') : t('nom_isr'),
            '− ' + mx(r.lines.isr), 'neg'),
          r.lines.imssEmployee > 0 && line(t('nom_imss_employee'), '− ' + mx(r.lines.imssEmployee), 'neg'),
          line(t('nom_net'), mx(r.net), 'pos big'),
        ].filter(Boolean)),
      ]),

      el('div.card', {}, [
        el('div.card__title', { style: { marginBottom: '12px' }, text: t('nom_company_side') }),
        el('div.list', {}, [
          line(t('nom_gross'), mx(r.gross)),
          r.lines.imssEmployer > 0 && line(t('nom_imss_employer'), '+ ' + mx(r.lines.imssEmployer)),
          r.lines.isn > 0 && line(t('nom_isn', { s: state.isnState }), '+ ' + mx(r.lines.isn)),
          line(t('nom_company_cash'), mx(r.companyCash), 'strong'),
          r.taxShield > 0 && line(t('nom_shield'), '− ' + mx(r.taxShield), 'pos'),
          line(t('nom_true_cost'), mx(r.trueCost), 'strong big'),
        ].filter(Boolean)),
      ]),

      /* Накопления — не налог, а деньги Киры */
      r.toHerSavings > 0 && el('div.card', { style: { borderColor: 'var(--pos)' } }, [
        el('div.card__title', { style: { color: 'var(--pos)' }, text: t('nom_savings') }),
        el('div.amount.amount--lg.num.pos', { style: { marginTop: '4px' }, text: mx(r.toHerSavings) }),
        el('p.tiny.muted', { style: { marginTop: '6px' }, text: t('nom_savings_hint') }),
      ]),

      extras && el('div.card.card--flat', {}, [
        el('div.card__title', { text: t('nom_annual') }),
        el('div.list', { style: { marginTop: '8px' } }, [
          line(t('nom_aguinaldo'), mx(extras.aguinaldo)),
          line(t('nom_prima'), mx(extras.primaVacacional)),
        ]),
      ]),

      /* Сравнение режимов */
      el('div.card', {}, [
        el('div.card__title', { style: { marginBottom: '10px' }, text: t('nom_compare') }),
        el('div.list', {}, all.map(c => {
          const active = c.regime === state.regime;
          const blocked = c.detail?.blockedForShareholder;
          return el('button.row', {
            style: {
              ...(active ? { background: 'var(--accent-bg)', borderRadius: '10px' } : {}),
              ...(blocked ? { opacity: '.5' } : {}),
            },
            onclick: () => { state.regime = c.regime; render(); },
          }, [
            el('div.row__main', {}, [
              el('div.row__title', { text: t('nom_' + c.regime) }),
              el('div.row__sub', {
                text: c.regime === 'resico' && c.detail?.blockedForShareholder
                  ? t('nom_not_available')
                  : t('nom_per_peso', { v: c.costPerPeso.toFixed(2) }),
              }),
            ]),
            el('div.row__end', {}, [
              el('div.amount.num.small', { text: mx(c.trueCost) }),
              el('div.tiny.muted-3', { text: t('nom_per_month') }),
            ]),
          ]);
        })),
      ]),

      el('div.card.card--flat', {}, [
        el('div.card__title', { text: t('nom_isn_state') }),
        el('div', { style: { height: '8px' } }),
        select(Object.keys(TAX_MX.isn).map(k => ({ value: k, label: `${k} — ${(TAX_MX.isn[k] * 100).toFixed(0)}%` })),
          { value: state.isnState, onchange: e => { state.isnState = e.target.value; render(); } }),
      ]),

      /* Источники и оговорка */
      el('div.card.card--flat', {}, [
        el('div.card__title', { text: t('nom_sources') }),
        el('p.tiny.muted', { style: { margin: '8px 0' }, text: t('nom_disclaimer') }),
        ...TAX_MX.sources.map(([name, url]) =>
          el('div', { style: { marginTop: '5px' } }, [
            el('a.tiny', { href: url, target: '_blank', rel: 'noopener', text: name }),
          ])),
        el('div.tiny.muted-3', { style: { marginTop: '10px' },
          text: t('nom_checked', { y: TAX_MX.year, d: TAX_MX.checkedAt }) }),
      ]),

      el('button.btn.btn--primary.btn--block', {
        text: t('nom_record'),
        onclick: () => record(r),
      }),
    ];
    body.replaceChildren(...parts.filter(Boolean));
  }

  function warning(text) {
    return el('div.card', { style: { borderColor: 'var(--warn)', background: 'var(--warn-bg)' } }, [
      el('p.small', { style: { color: 'var(--warn)' }, text: '⚠️ ' + text }),
    ]);
  }

  function line(label, value, kind = '') {
    const cls = kind.includes('pos') ? 'pos' : kind.includes('neg') ? 'neg' : '';
    return el('div.row', { style: { minHeight: '38px' } }, [
      el('div.row__main', {}, [
        el('div', { class: kind.includes('strong') ? 'row__title' : 'small muted', text: label }),
      ]),
      el('div.amount.num', {
        class: cls,
        style: { fontSize: kind.includes('big') ? '18px' : '15px' },
        text: value,
      }),
    ]);
  }

  /* Записать в учёт: расход компании двумя строками + доход в личном кошельке */
  function record(r) {
    const empresaAccounts = D.accountsOf('empresa');
    const personalAccounts = D.accountsOf('personal');
    if (!empresaAccounts.length || !personalAccounts.length) {
      toast(t('no_accounts'), { error: true });
      return;
    }

    const date = toISODate();
    const salaryCat = D.categoriesOf('empresa', 'expense').find(c => /зарплат|sueldo|salar/i.test(c.name))
      || D.categoriesOf('empresa', 'expense')[0];
    const taxCat = D.categoriesOf('empresa', 'expense').find(c => /налог|impuesto|tax/i.test(c.name))
      || salaryCat;
    const incomeCat = D.categoriesOf('personal', 'income').find(c => /зарплат|sueldo|salar/i.test(c.name))
      || D.categoriesOf('personal', 'income')[0];

    D.addTx({
      book: 'empresa', kind: 'expense', date,
      amount: toCents(r.net), currency: empresaAccounts[0].currency,
      account: empresaAccounts[0].id, category: salaryCat?.id ?? null,
      party: D.bookName('personal', t), note: t('nom_tx_net'),
    });
    D.addTx({
      book: 'empresa', kind: 'expense', date,
      amount: toCents(r.companyCash - r.net), currency: empresaAccounts[0].currency,
      account: empresaAccounts[0].id, category: taxCat?.id ?? null,
      party: 'SAT / IMSS', note: t('nom_tx_taxes'),
    });
    D.addTx({
      book: 'personal', kind: 'income', date,
      amount: toCents(r.net), currency: personalAccounts[0].currency,
      account: personalAccounts[0].id, category: incomeCat?.id ?? null,
      party: D.bookName('empresa', t),
      note: t('nom_tx_income', { v: D.bookName('empresa', t) }),
    });

    haptic(20);
    s.close();
    toast(t('nom_recorded'));
    onDone?.();
  }

  render();
  s = sheet({ title: t('nom_title'), body: [body] });
}
