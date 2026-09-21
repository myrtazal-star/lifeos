/* Проверка чтения выписки в PDF.
   Обращение к Claude подменяется (ключа для настоящего вызова нет),
   но всё остальное настоящее: состав запроса, список для проверки,
   отметки повторов, запись только отмеченного. */

import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.APP_URL || 'http://localhost:5173/apps/milpa/';
const problems = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

/* Минимальный настоящий PDF: содержимое не важно — ответ подменён,
   но файл должен опознаваться как PDF. */
const PDF_PATH = join(tmpdir(), 'estado-cuenta.pdf');
writeFileSync(PDF_PATH,
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

const STATEMENT = {
  readable: true, problem: '', currency: 'MXN',
  account: '**** 6789', period: '01/09/2026 al 21/09/2026',
  transactions: [
    { date: '2026-09-15', kind: 'expense', amount: 450.5, merchant: 'OXXO POLANCO',
      note: 'Продукты', category: 'Транспорт', confidence: 'high' },
    { date: '2026-09-16', kind: 'income', amount: 125000, merchant: 'CLIENTE PEREZ',
      note: 'Комиссия со сделки', category: '', confidence: 'high' },
    { date: '2026-09-17', kind: 'expense', amount: 18000, merchant: 'ARRENDADORA',
      note: 'Аренда офиса', category: '', confidence: 'low' },
    { date: '2026-09-18', kind: 'expense', amount: 999.99, merchant: 'CFE',
      note: 'Электричество', category: '', confidence: 'high' },
  ],
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => problems.push('ошибка JS: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('консоль: ' + m.text()); });

await page.evaluateOnNewDocument((reply) => {
  window.__sent = null;
  const real = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).includes('api.anthropic.com')) {
      window.__sent = { body: JSON.parse(opts.body) };
      return new Response(JSON.stringify({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(reply) }],
      }), { status: 200 });
    }
    return real(url, opts);
  };
  try { localStorage.setItem('lifeos.milpa.aikey', 'sk-ant-test'); } catch {}
}, STATEMENT);

console.log('\n── Чтение выписки в PDF ──');
await page.goto(URL + '#settings', { waitUntil: 'networkidle0', timeout: 30000 });
await wait(800);

const companyLabel = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('lifeos.milpa')).books.find(b => b.id === 'empresa').name);
await page.evaluate(label => {
  [...document.querySelectorAll('.seg button')].find(b => b.textContent.trim() === label)?.click();
}, companyLabel);
await wait(500);

/* Заранее кладём одну из операций — она должна опознаться как повтор */
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('lifeos.milpa'));
  const acc = d.accounts.find(a => a.book === 'empresa');
  d.tx.push({ id: 'seed1', book: 'empresa', kind: 'expense', date: '2026-09-17',
    amount: 1800000, currency: acc.currency, account: acc.id, category: null,
    party: '', note: 'Аренда офиса', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString() });
  localStorage.setItem('lifeos.milpa', JSON.stringify(d));
});
await page.reload({ waitUntil: 'networkidle0' });
await wait(700);
await page.evaluate(label => {
  [...document.querySelectorAll('.seg button')].find(b => b.textContent.trim() === label)?.click();
}, companyLabel);
await wait(400);
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
await chooser.accept([PDF_PATH]);
await wait(2500);

const sent = await page.evaluate(() => {
  const b = window.__sent?.body;
  if (!b) return null;
  const c = b.messages[0].content;
  return {
    модель: b.model,
    документПервым: c[0].type === 'document',
    тип: c[0].source?.media_type,
    кодировка: c[0].source?.type,
    схемаСписка: b.output_config?.format?.schema?.properties?.transactions?.type,
    запасТокенов: b.max_tokens,
  };
});
console.log('  запрос:', JSON.stringify(sent));
if (!sent) problems.push('запрос к Claude не ушёл');
else {
  if (!sent.документПервым) problems.push('документ должен идти перед текстом');
  if (sent.тип !== 'application/pdf') problems.push(`тип документа ${sent.тип}`);
  if (sent.кодировка !== 'base64') problems.push('документ не закодирован');
  if (sent.схемаСписка !== 'array') problems.push('в схеме нет списка операций');
  if (sent.модель !== 'claude-opus-5') problems.push(`модель ${sent.модель}`);
}

const review = await page.evaluate(() => {
  const sheet = document.querySelector('.sheet');
  const tiles = [...sheet.querySelectorAll('.card--flat .amount')].map(n => Number(n.textContent));
  const rows = [...sheet.querySelectorAll('.card .row')].map(r => r.textContent);
  return {
    найдено: tiles[0], отмечено: tiles[1], повторов: tiles[2],
    строк: rows.length,
    естьПометкаПовтора: rows.some(r => /уже есть/.test(r)),
    естьПометкаНеуверенности: rows.some(r => r.includes('\u26a0')),
    периодВиден: /01\/09\/2026/.test(sheet.textContent),
    кнопка: [...sheet.querySelectorAll('button')].map(b => b.textContent).find(x => /Записать/.test(x)),
  };
});
console.log('  список:', JSON.stringify(review));

if (review.найдено !== 4) problems.push(`найдено ${review.найдено}, ждали 4`);
if (review.повторов !== 1) problems.push(`повторов ${review.повторов}, ждали 1`);
if (review.отмечено !== 3) problems.push(`отмечено ${review.отмечено}, ждали 3 (повтор снят)`);
if (!review.естьПометкаПовтора) problems.push('повтор не помечен');
if (!review.естьПометкаНеуверенности) problems.push('плохо прочитанная строка не помечена');
if (!review.периодВиден) problems.push('период выписки не показан');

await page.screenshot({ path: '.shots/pdf-review.png' });

await page.evaluate(() => {
  [...document.querySelectorAll('.sheet button')].find(b => /Записать операций/.test(b.textContent))?.click();
});
await wait(1500);

const saved = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('lifeos.milpa'));
  const emp = d.tx.filter(t => t.book === 'empresa' && !t.deleted);
  return {
    всего: emp.length,
    поЗаметкам: emp.map(t => t.note).sort(),
    комиссия: emp.find(t => /Комиссия/.test(t.note)) && {
      вид: emp.find(t => /Комиссия/.test(t.note)).kind,
      сумма: emp.find(t => /Комиссия/.test(t.note)).amount,
    },
  };
});
console.log('  записано:', JSON.stringify(saved));

if (saved.всего !== 4) problems.push(`в кошельке ${saved.всего} операций, ждали 4 (1 была + 3 новых)`);
if (saved.комиссия?.вид !== 'income') problems.push('поступление записано не как доход');
if (saved.комиссия?.сумма !== 12500000) problems.push(`сумма ${saved.комиссия?.сумма}, ждали 12500000`);
const arenda = saved.поЗаметкам.filter(n => n === 'Аренда офиса').length;
if (arenda !== 1) problems.push(`«Аренда офиса» записана ${arenda} раз — повтор не отсеян`);

await browser.close();

console.log('');
if (problems.length) {
  console.log(`  НАЙДЕНО ПРОБЛЕМ: ${problems.length}`);
  for (const p of problems) console.log('   • ' + p);
  process.exit(1);
}
console.log('  Чтение выписки в PDF работает (вызов подменён).\n');
