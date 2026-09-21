/* Сквозная проверка загрузки банковской выписки:
   файл в кодировке Windows-1252 → разбор → запись → защита от повторов. */

import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.APP_URL || 'http://localhost:5173/apps/milpa/';
const SAMPLE = '/tmp/bbva-ejemplo.csv';

const problems = [];

/* Выписка в духе BBVA: шапка с реквизитами, колонки CARGO/ABONO,
   итоговая строка без даты, не-UTF-8 кодировка. */
const CSV = `BBVA MEXICO
CUENTA;0123456789
PERIODO;01/09/2026 AL 21/09/2026

FECHA;DESCRIPCIÓN;CARGO;ABONO;SALDO
15/09/2026;PAGO OXXO SUC 2213 POLANCO;450.50;;120,345.67
16/09/2026;TRASPASO RECIBIDO COMISIÓN VENTA;;125,000.00;245,345.67
17/09/2026;RENTA OFICINA POLANCO SEPT;18,000.00;;227,345.67
18/09/2026;PAGO NÓMINA EMPLEADOS;42,300.00;;185,045.67
19/09/2026;DEPÓSITO CLIENTE MARTÍNEZ;;35,000.00;220,045.67
TOTALES;;60,750.50;160,000.00;
`;
writeFileSync(SAMPLE, Buffer.from(CSV, 'latin1'));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => problems.push('ошибка JS: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('консоль: ' + m.text()); });

const wait = ms => new Promise(r => setTimeout(r, ms));

await page.goto(URL + '#settings', { waitUntil: 'networkidle0', timeout: 30000 });
await wait(700);

/* Переключаемся на кошелёк компании. Подпись берём из самих данных,
   чтобы проверка не ломалась при переименовании кошельков. */
const companyLabel = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('lifeos.milpa'));
  return d.books.find(b => b.id === 'empresa')?.name;
});
console.log('\n── Загрузка выписки ──');
console.log('  кошелёк компании:', companyLabel);

const switched = await page.evaluate(label => {
  const btn = [...document.querySelectorAll('.seg button')].find(b => b.textContent.trim() === label);
  if (!btn) return false;
  btn.click();
  return true;
}, companyLabel);
if (!switched) problems.push('не нашёлся переключатель кошелька компании');
await wait(500);

const opened = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.row')].find(r => /Загрузить выписку/.test(r.textContent));
  if (!row) return false;
  row.click();
  return true;
});
if (!opened) problems.push('пункт «Загрузить выписку» не найден');
await wait(600);

async function upload() {
  const [chooser] = await Promise.all([
    page.waitForFileChooser(),
    page.evaluate(() => {
      [...document.querySelectorAll('.sheet button')]
        .find(b => /Выбрать файл|Другой файл/.test(b.textContent))?.click();
    }),
  ]);
  await chooser.accept([SAMPLE]);
  await wait(1200);
}

await upload();

const parsed = await page.evaluate(() => {
  const sheet = document.querySelector('.sheet');
  const tiles = [...sheet.querySelectorAll('.card--flat .amount')].map(n => Number(n.textContent));
  return {
    кодировка: /DESCRIPCIÓN|NÓMINA|MARTÍNEZ/.test(sheet.textContent),
    новых: tiles[0], повторов: tiles[1], пропущено: tiles[2],
  };
});
console.log('  разобрано:', JSON.stringify(parsed));
if (!parsed.кодировка) problems.push('кодировка Windows-1252 испорчена');
if (parsed.новых !== 5) problems.push(`новых операций ${parsed.новых}, ждали 5`);
if (parsed.пропущено !== 1) problems.push(`пропущено ${parsed.пропущено}, ждали 1 (строка ИТОГО)`);

await page.screenshot({ path: '.shots/import-preview.png' });

await page.evaluate(() => {
  [...document.querySelectorAll('.sheet button')].find(b => /Записать операций/.test(b.textContent))?.click();
});
await wait(1200);

const saved = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('lifeos.milpa'));
  const emp = d.tx.filter(t => t.book === 'empresa');
  const byNote = n => emp.find(t => t.note.includes(n));
  return {
    записано: emp.length,
    расходOXXO: byNote('OXXO') && { вид: byNote('OXXO').kind, сумма: byNote('OXXO').amount, дата: byNote('OXXO').date },
    доходКомиссия: byNote('COMISIÓN') && { вид: byNote('COMISIÓN').kind, сумма: byNote('COMISIÓN').amount },
    разметкаСохранена: !!d.settings.importProfiles,
  };
});
console.log('  записано:', JSON.stringify(saved));

if (saved.записано !== 5) problems.push(`записано ${saved.записано} операций, ждали 5`);
if (saved.расходOXXO?.вид !== 'expense') problems.push('списание записано не как расход');
if (saved.расходOXXO?.сумма !== 45050) problems.push(`сумма ${saved.расходOXXO?.сумма}, ждали 45050`);
if (saved.расходOXXO?.дата !== '2026-09-15') problems.push(`дата ${saved.расходOXXO?.дата}, ждали 2026-09-15`);
if (saved.доходКомиссия?.вид !== 'income') problems.push('поступление записано не как доход');
if (saved.доходКомиссия?.сумма !== 12500000) problems.push(`сумма дохода ${saved.доходКомиссия?.сумма}, ждали 12500000`);
if (!saved.разметкаСохранена) problems.push('разметка колонок не запомнилась');

/* Повторная загрузка того же файла не должна ничего добавить */
console.log('\n── Повторная загрузка того же файла ──');
await page.evaluate(() => {
  [...document.querySelectorAll('.row')].find(r => /Загрузить выписку/.test(r.textContent))?.click();
});
await wait(600);
await upload();

const second = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.sheet .card--flat .amount')].map(n => Number(n.textContent));
  return { новых: tiles[0], повторов: tiles[1] };
});
console.log('  ', JSON.stringify(second));
if (second.новых !== 0) problems.push(`при повторе предложено ${second.новых} новых — защита не сработала`);
if (second.повторов !== 5) problems.push(`повторов найдено ${second.повторов}, ждали 5`);

await browser.close();

console.log('');
if (problems.length) {
  console.log(`  НАЙДЕНО ПРОБЛЕМ: ${problems.length}`);
  for (const p of problems) console.log('   • ' + p);
  process.exit(1);
}
console.log('  Загрузка выписок работает.\n');
