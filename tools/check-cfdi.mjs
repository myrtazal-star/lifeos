/* Сквозная проверка загрузки счетов-фактур из архива SAT.
   Собирается настоящий ZIP с XML, грузится через браузер, проверяется
   направление денег, отсев документов без сумм и защита от повторов. */

import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.APP_URL || 'http://localhost:5173/apps/milpa/';
const RFC = 'KOS210101AB1';
const problems = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

const comprobante = ({ total, sub, iva, tipo, emisor, emisorName, receptor, receptorName, fecha, uuid, desc }) =>
`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
 Version="4.0" Fecha="${fecha}" Total="${total}" SubTotal="${sub}" Moneda="MXN" TipoDeComprobante="${tipo}" MetodoPago="PUE">
 <cfdi:Emisor Rfc="${emisor}" Nombre="${emisorName}" RegimenFiscal="601"/>
 <cfdi:Receptor Rfc="${receptor}" Nombre="${receptorName}" UsoCFDI="G03"/>
 <cfdi:Conceptos><cfdi:Concepto Descripcion="${desc}" Importe="${sub}"/></cfdi:Conceptos>
 <cfdi:Impuestos TotalImpuestosTrasladados="${iva}"/>
 <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}"/></cfdi:Complemento>
</cfdi:Comprobante>`;

const dir = mkdtempSync(join(tmpdir(), 'cfdi-'));
writeFileSync(join(dir, 'emitida-1.xml'), comprobante({
  total: '232000.00', sub: '200000.00', iva: '32000.00', tipo: 'I',
  emisor: RFC, emisorName: 'KOSHTUR SA DE CV',
  receptor: 'MAPE800101H23', receptorName: 'MARIA PEREZ',
  fecha: '2026-09-15T12:00:00', uuid: 'AAAA0001-0000-4000-8000-000000000001',
  desc: 'Comision por venta',
}));
writeFileSync(join(dir, 'recibida-1.xml'), comprobante({
  total: '20880.00', sub: '18000.00', iva: '2880.00', tipo: 'I',
  emisor: 'ARR900101XY2', emisorName: 'ARRENDADORA POLANCO',
  receptor: RFC, receptorName: 'KOSHTUR SA DE CV',
  fecha: '2026-09-01T09:00:00', uuid: 'AAAA0001-0000-4000-8000-000000000002',
  desc: 'Renta oficina',
}));
writeFileSync(join(dir, 'pago-1.xml'), comprobante({
  total: '0', sub: '0', iva: '0', tipo: 'P',
  emisor: RFC, emisorName: 'KOSHTUR SA DE CV',
  receptor: 'MAPE800101H23', receptorName: 'MARIA PEREZ',
  fecha: '2026-09-20T10:00:00', uuid: 'AAAA0001-0000-4000-8000-000000000003',
  desc: 'Complemento de pago',
}));
execSync('zip -q facturas.zip emitida-1.xml recibida-1.xml pago-1.xml', { cwd: dir });
const ZIP = join(dir, 'facturas.zip');

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => problems.push('ошибка JS: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('консоль: ' + m.text()); });

console.log('\n── Счета-фактуры из архива SAT ──');
await page.goto(URL + '#settings', { waitUntil: 'networkidle0', timeout: 30000 });
await wait(800);

const companyLabel = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('lifeos.milpa')).books.find(b => b.id === 'empresa').name);
await page.evaluate(label => {
  [...document.querySelectorAll('.seg button')].find(b => b.textContent.trim() === label)?.click();
}, companyLabel);
await wait(500);
await page.evaluate(() => {
  [...document.querySelectorAll('.row')].find(r => /Загрузить выписку/.test(r.textContent))?.click();
});
await wait(600);

const [chooser] = await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(() => {
    [...document.querySelectorAll('.sheet button')]
      .find(b => /Выбрать файл|Другой файл/.test(b.textContent))?.click();
  }),
]);
await chooser.accept([ZIP]);
await wait(2000);

const review = await page.evaluate(() => {
  const sheet = document.querySelector('.sheet');
  const tiles = [...sheet.querySelectorAll('.card--flat .amount')].map(n => Number(n.textContent));
  return {
    найдено: tiles[0], отмечено: tiles[1],
    текст: sheet.textContent.replace(/\s+/g, ' '),
    строк: sheet.querySelectorAll('.card .row').length,
  };
});
console.log('  найдено:', review.найдено, '· отмечено:', review.отмечено, '· строк:', review.строк);

if (review.найдено !== 2) problems.push(`найдено ${review.найдено}, ждали 2 (подтверждение оплаты отсеивается)`);
if (!/KOS210101AB1/.test(review.текст)) problems.push('налоговый номер не определён из пачки');
if (!/Пропущено документов/.test(review.текст)) problems.push('не сказано, сколько документов отброшено');
if (!/MARIA PEREZ/.test(review.текст)) problems.push('контрагент по выставленному счёту не показан');
if (!/ARRENDADORA/.test(review.текст)) problems.push('контрагент по полученному счёту не показан');

await page.screenshot({ path: '.shots/cfdi-review.png' });

await page.evaluate(() => {
  [...document.querySelectorAll('.sheet button')].find(b => /Записать операций/.test(b.textContent))?.click();
});
await wait(1500);

const saved = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('lifeos.milpa'));
  const emp = d.tx.filter(t => t.book === 'empresa' && !t.deleted);
  const byNote = n => emp.find(t => (t.note || '').includes(n));
  return {
    записано: emp.length,
    комиссия: byNote('Comision') && {
      вид: byNote('Comision').kind, сумма: byNote('Comision').amount,
      iva: byNote('Comision').iva, uuid: !!byNote('Comision').uuid,
      rfc: byNote('Comision').rfc,
    },
    аренда: byNote('Renta') && { вид: byNote('Renta').kind, сумма: byNote('Renta').amount },
    rfcКошелька: d.books.find(b => b.id === 'empresa').rfc,
  };
});
console.log('  записано:', JSON.stringify(saved));

if (saved.записано !== 2) problems.push(`записано ${saved.записано}, ждали 2`);
if (saved.комиссия?.вид !== 'income') problems.push('выставленный мной счёт должен быть доходом');
if (saved.комиссия?.сумма !== 23200000) problems.push(`сумма ${saved.комиссия?.сумма}, ждали 23200000`);
if (saved.комиссия?.iva !== 3200000) problems.push(`IVA ${saved.комиссия?.iva}, ждали 3200000`);
if (!saved.комиссия?.uuid) problems.push('номер счёта-фактуры не сохранён');
if (saved.комиссия?.rfc !== 'MAPE800101H23') problems.push('налоговый номер контрагента не сохранён');
if (saved.аренда?.вид !== 'expense') problems.push('выставленный мне счёт должен быть расходом');
if (saved.rfcКошелька !== 'KOS210101AB1') problems.push('налоговый номер кошелька не запомнен');

/* Повторная загрузка того же архива ничего не добавляет */
console.log('\n── Повторная загрузка ──');
await page.evaluate(() => {
  [...document.querySelectorAll('.row')].find(r => /Загрузить выписку/.test(r.textContent))?.click();
});
await wait(600);
const [c2] = await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(() => {
    [...document.querySelectorAll('.sheet button')]
      .find(b => /Выбрать файл|Другой файл/.test(b.textContent))?.click();
  }),
]);
await c2.accept([ZIP]);
await wait(2000);
const second = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.sheet .card--flat .amount')].map(n => Number(n.textContent));
  return { найдено: tiles[0], отмечено: tiles[1], повторов: tiles[2] };
});
console.log('  ', JSON.stringify(second));
if (second.отмечено !== 0) problems.push(`при повторе отмечено ${second.отмечено} — защита не сработала`);
if (second.повторов !== 2) problems.push(`повторов найдено ${second.повторов}, ждали 2`);

await browser.close();

console.log('');
if (problems.length) {
  console.log(`  НАЙДЕНО ПРОБЛЕМ: ${problems.length}`);
  for (const p of problems) console.log('   • ' + p);
  process.exit(1);
}
console.log('  Загрузка счетов-фактур из SAT работает.\n');
