/* Проверка разбора счетов-фактур CFDI 4.0.
   Образцы составлены по структуре, которую выпускает SAT: важны
   направление денег, IVA, валюта и отсев документов без денежного смысла. */

import { parseCfdi, collectCfdi, attrsOf, allAttrsOf, looksLikeCfdi, guessOwnRfc }
  from '../apps/milpa/cfdi.js';

let failed = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'ОШИБКА'} ${label}${cond ? '' : '  ' + extra}`);
};
const eq = (label, a, b) =>
  ok(label, JSON.stringify(a) === JSON.stringify(b),
     `получили ${JSON.stringify(a)}, ждали ${JSON.stringify(b)}`);

const MY_RFC = 'KOS210101AB1';

/* Счёт, выпущенный мной клиенту: моя комиссия с продажи */
const INGRESO = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Serie="A" Folio="128" Fecha="2026-09-15T12:30:00" Total="232000.00"
  SubTotal="200000.00" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="03"
  LugarExpedicion="06600">
  <cfdi:Emisor Rfc="${MY_RFC}" Nombre="KOSHTUR SA DE CV" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="MAPE800101H23" Nombre="MARIA PEREZ" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="80131500" Cantidad="1" Descripcion="Comisi&#243;n por venta Polanco" Importe="200000.00"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="32000.00">
    <cfdi:Traslados>
      <cfdi:Traslado Base="200000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="32000.00"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="a1b2c3d4-0000-4000-8000-000000000001" FechaTimbrado="2026-09-15T12:31:00"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

/* Счёт, выпущенный мне: аренда офиса. Итог налогов не проставлен — считаем по строкам */
const GASTO = `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Fecha="2026-09-01T09:00:00" Total="20880.00" SubTotal="18000.00" Moneda="MXN"
  TipoDeComprobante="I" MetodoPago="PUE">
  <cfdi:Emisor Rfc="ARR900101XY2" Nombre="ARRENDADORA POLANCO" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${MY_RFC}" Nombre="KOSHTUR SA DE CV" UsoCFDI="G03"/>
  <cfdi:Conceptos><cfdi:Concepto Descripcion="Renta oficina septiembre" Importe="18000.00"/></cfdi:Conceptos>
  <cfdi:Impuestos>
    <cfdi:Traslados>
      <cfdi:Traslado Base="18000.00" Impuesto="002" Importe="2880.00"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="a1b2c3d4-0000-4000-8000-000000000002"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

/* Подтверждение оплаты — денег не несёт, сумма нулевая */
const PAGO = `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Fecha="2026-09-20T10:00:00" Total="0" SubTotal="0" Moneda="XXX" TipoDeComprobante="P">
  <cfdi:Emisor Rfc="${MY_RFC}" Nombre="KOSHTUR SA DE CV"/>
  <cfdi:Receptor Rfc="MAPE800101H23" Nombre="MARIA PEREZ"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="a1b2c3d4-0000-4000-8000-000000000003"/></cfdi:Complemento>
</cfdi:Comprobante>`;

/* Счёт в долларах с курсом */
const DOLARES = `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Fecha="2026-08-10T15:00:00" Total="5800.00" SubTotal="5000.00" Moneda="USD" TipoCambio="17.2300"
  TipoDeComprobante="I">
  <cfdi:Emisor Rfc="${MY_RFC}" Nombre="KOSHTUR SA DE CV"/>
  <cfdi:Receptor Rfc="XEXX010101000" Nombre="CLIENTE EXTRANJERO"/>
  <cfdi:Impuestos TotalImpuestosTrasladados="800.00"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="a1b2c3d4-0000-4000-8000-000000000004"/></cfdi:Complemento>
</cfdi:Comprobante>`;

/* Возврат, выпущенный мной: уменьшает мой доход */
const EGRESO = `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Fecha="2026-09-18T11:00:00" Total="5800.00" SubTotal="5000.00" Moneda="MXN" TipoDeComprobante="E">
  <cfdi:Emisor Rfc="${MY_RFC}" Nombre="KOSHTUR SA DE CV"/>
  <cfdi:Receptor Rfc="MAPE800101H23" Nombre="MARIA PEREZ"/>
  <cfdi:Impuestos TotalImpuestosTrasladados="800.00"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="a1b2c3d4-0000-4000-8000-000000000005"/></cfdi:Complemento>
</cfdi:Comprobante>`;

console.log('\n── Выборка атрибутов ──');
{
  const c = attrsOf(INGRESO, 'Comprobante');
  eq('префикс пространства имён не мешает', c.Total, '232000.00');
  eq('серия и номер читаются', [c.Serie, c.Folio], ['A', '128']);
  const emisor = attrsOf(INGRESO, 'Emisor');
  eq('выпускающий', emisor.Rfc, MY_RFC);
  eq('все строки товаров', allAttrsOf(INGRESO, 'Traslado').length, 1);
  ok('чужой текст не опознаётся как счёт', !looksLikeCfdi('<html><body>привет</body></html>'));
  ok('счёт опознаётся', looksLikeCfdi(INGRESO));
}

console.log('\n── Направление денег ──');
{
  const mine = parseCfdi(INGRESO, MY_RFC);
  eq('счёт, выпущенный мной, — доход', mine.kind, 'income');
  eq('контрагент — получатель счёта', mine.counterparty.name, 'MARIA PEREZ');
  ok('помечено как выпущенное мной', mine.issuedByMe === true);

  const theirs = parseCfdi(GASTO, MY_RFC);
  eq('счёт, выпущенный мне, — расход', theirs.kind, 'expense');
  eq('контрагент — выпускающий', theirs.counterparty.name, 'ARRENDADORA POLANCO');

  const refund = parseCfdi(EGRESO, MY_RFC);
  eq('мой возврат — расход', refund.kind, 'expense');
}

console.log('\n── Суммы, IVA и валюта ──');
{
  const a = parseCfdi(INGRESO, MY_RFC);
  eq('итог в центах', a.total, 23200000);
  eq('без налога', a.subtotal, 20000000);
  eq('IVA из итоговой строки', a.iva, 3200000);
  eq('дата без времени', a.date, '2026-09-15');
  eq('описание из первой строки', a.note, 'Comisión por venta Polanco');

  const b = parseCfdi(GASTO, MY_RFC);
  eq('IVA посчитан по строкам, когда итога нет', b.iva, 288000);

  const usd = parseCfdi(DOLARES, MY_RFC);
  eq('валюта', usd.currency, 'USD');
  eq('курс из документа', usd.fxRate, 17.23);
}

console.log('\n── Отсев документов без денег ──');
{
  const files = [
    { name: '1.xml', xml: INGRESO },
    { name: '2.xml', xml: GASTO },
    { name: '3.xml', xml: PAGO },
    { name: '4.xml', xml: DOLARES },
    { name: '5.xml', xml: INGRESO },          // тот же UUID — повтор
    { name: 'readme.txt', xml: 'не счёт' },
  ];
  const { rows, skipped } = collectCfdi(files, MY_RFC);
  eq('принято документов', rows.length, 3);
  eq('первым идёт самый ранний', rows[0].date, '2026-08-10');
  ok('подтверждение оплаты отброшено', skipped.some(s => s.reason === 'no-money'));
  ok('повтор по UUID отброшен', skipped.some(s => s.reason === 'duplicate'));
  ok('посторонний файл отброшен', skipped.some(s => s.reason === 'not-cfdi'));
}

console.log('\n── Подсказка собственного RFC ──');
{
  const files = [
    { name: '1', xml: INGRESO }, { name: '2', xml: GASTO },
    { name: '3', xml: DOLARES }, { name: '4', xml: EGRESO },
  ];
  const guess = guessOwnRfc(files);
  eq('самый частый RFC — собственный', guess[0].rfc, MY_RFC);
  ok('обобщённый RFC для иностранцев не предлагается',
     !guess.some(g => g.rfc === 'XEXX010101000'));
}

console.log('\n── Без указания своего RFC ──');
{
  const unknown = parseCfdi(INGRESO, '');
  eq('направление не угадывается вслепую', unknown.kind, 'expense');
  ok('но помечено, что счёт не мой', unknown.issuedByMe === false);
}

console.log(failed ? `\n  ПРОВАЛЕНО: ${failed}\n` : '\n  Все проверки пройдены.\n');
process.exit(failed ? 1 : 0);
