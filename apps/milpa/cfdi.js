/* Разбор счетов-фактур CFDI 4.0 из архива портала SAT.

   В отличие от чтения PDF, здесь ничего не угадывается: данные размечены
   самим выпускающим, а UUID делает повторную загрузку безошибочной.

   Разбор сделан на выборке атрибутов, а не на DOMParser: так модуль
   проверяется обычными тестами и одинаково работает в браузере и вне его.
   CFDI выпускает машина, структура строгая, поэтому выборка надёжна. */

/** Все атрибуты первого вхождения элемента с таким именем. */
export function attrsOf(xml, tag) {
  // имя может идти с любым префиксом пространства имён: cfdi:Emisor, Emisor
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\b([^>]*)>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  return parseAttrs(m[1]);
}

/** Атрибуты всех вхождений элемента. */
export function allAttrsOf(xml, tag) {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\b([^>]*)>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(parseAttrs(m[1]));
  return out;
}

function parseAttrs(raw) {
  const out = {};
  const re = /([A-Za-z0-9_:.-]+)\s*=\s*"([^"]*)"|([A-Za-z0-9_:.-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = m[1] ?? m[3];
    const value = m[2] ?? m[4];
    out[key.replace(/^.*:/, '')] = unescapeXml(value);
  }
  return out;
}

const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, '&');

export const looksLikeCfdi = (xml) =>
  /<(?:[A-Za-z0-9_.-]+:)?Comprobante\b/i.test(String(xml).slice(0, 4000));

/* Типы документа по справочнику SAT */
export const DOC_TYPES = {
  I: 'ingreso',      // счёт за проданное — доход у выпустившего
  E: 'egreso',       // возврат, скидка, кредит-нота
  T: 'traslado',     // перемещение, денег не касается
  N: 'nomina',       // зарплатная ведомость
  P: 'pago',         // подтверждение оплаты, сумма нулевая
};

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const cents = (v) => Math.round(num(v) * 100);

/**
 * Один XML → запись. myRfc определяет направление денег:
 * если счёт выпустили вы — это доход, если выпустили вам — расход.
 */
export function parseCfdi(xml, myRfc = '') {
  if (!looksLikeCfdi(xml)) return null;

  const c = attrsOf(xml, 'Comprobante');
  if (!c) return null;

  const emisor = attrsOf(xml, 'Emisor') || {};
  const receptor = attrsOf(xml, 'Receptor') || {};
  const timbre = attrsOf(xml, 'TimbreFiscalDigital') || {};

  const type = String(c.TipoDeComprobante || 'I').toUpperCase();
  const mine = String(myRfc || '').trim().toUpperCase();
  const issuedByMe = mine && String(emisor.Rfc || '').toUpperCase() === mine;

  /* Направление. Счёт-доход, выпущенный мной, — мой доход; выпущенный мне —
     мой расход. У возвратов (E) знак обратный. */
  let kind = null;
  if (type === 'I') kind = issuedByMe ? 'income' : 'expense';
  else if (type === 'E') kind = issuedByMe ? 'expense' : 'income';
  else if (type === 'N') kind = issuedByMe ? 'expense' : 'income';

  // IVA: сумма перенесённых налогов
  const impuestos = attrsOf(xml, 'Impuestos') || {};
  let iva = cents(impuestos.TotalImpuestosTrasladados);
  if (!iva) {
    // у части выпускающих итог не проставлен — складываем по строкам
    iva = allAttrsOf(xml, 'Traslado')
      .filter(t => String(t.Impuesto) === '002')
      .reduce((s, t) => s + cents(t.Importe), 0);
  }
  const retenido = cents(impuestos.TotalImpuestosRetenidos);

  const counterparty = issuedByMe
    ? { rfc: receptor.Rfc || '', name: receptor.Nombre || '' }
    : { rfc: emisor.Rfc || '', name: emisor.Nombre || '' };

  const concepts = allAttrsOf(xml, 'Concepto');

  return {
    uuid: (timbre.UUID || '').toUpperCase(),
    date: String(c.Fecha || '').slice(0, 10),
    total: cents(c.Total),
    subtotal: cents(c.SubTotal),
    iva, retenido,
    currency: normaliseCurrency(c.Moneda),
    fxRate: c.TipoCambio ? num(c.TipoCambio) : null,
    type, typeName: DOC_TYPES[type] || 'otro',
    kind,                                   // null — деньгами не считается
    issuedByMe: !!issuedByMe,
    counterparty,
    paymentMethod: c.MetodoPago || '',      // PUE — оплачено сразу, PPD — в рассрочку
    paymentForm: c.FormaPago || '',
    note: (concepts[0]?.Descripcion || '').slice(0, 80),
    concepts: concepts.length,
    folio: [c.Serie, c.Folio].filter(Boolean).join('-'),
  };
}

function normaliseCurrency(v) {
  const s = String(v || 'MXN').toUpperCase();
  if (s === 'MXN' || s === 'USD' || s === 'EUR') return s;
  return 'MXN';
}

/**
 * Пачка XML → то, что можно записать, и то, что пропущено с причиной.
 * Счета без денежного смысла (T, P) и нулевые суммы отбрасываются.
 */
export function collectCfdi(files, myRfc) {
  const rows = [];
  const skipped = [];
  const seen = new Set();

  for (const { name, xml } of files) {
    const doc = parseCfdi(xml, myRfc);
    if (!doc) { skipped.push({ name, reason: 'not-cfdi' }); continue; }
    if (!doc.kind) { skipped.push({ name, reason: 'no-money', type: doc.type }); continue; }
    if (!doc.total) { skipped.push({ name, reason: 'zero' }); continue; }
    if (!doc.date) { skipped.push({ name, reason: 'no-date' }); continue; }
    if (doc.uuid && seen.has(doc.uuid)) { skipped.push({ name, reason: 'duplicate' }); continue; }
    if (doc.uuid) seen.add(doc.uuid);
    rows.push(doc);
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, skipped };
}

/** Какие RFC встречаются как выпускающие — чтобы подсказать пользователю его собственный. */
export function guessOwnRfc(files) {
  const count = new Map();
  for (const { xml } of files) {
    for (const who of ['Emisor', 'Receptor']) {
      const a = attrsOf(xml, who);
      const rfc = a?.Rfc?.toUpperCase();
      if (!rfc || rfc === 'XAXX010101000' || rfc === 'XEXX010101000') continue;
      count.set(rfc, (count.get(rfc) || 0) + 1);
    }
  }
  // собственный RFC встречается в каждом документе, чужие — по одному разу
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([rfc, n]) => ({ rfc, n }));
}
