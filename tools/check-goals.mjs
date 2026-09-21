/* Проверка целей накопления: арифметика и то, что отложенное
   вычитается из свободных денег, но не трогает остатки по счетам. */

import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.APP_URL || 'http://localhost:5173/apps/milpa/';
const problems = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => problems.push('ошибка JS: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('консоль: ' + m.text()); });

console.log('\n── Цели и накопления ──');
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await wait(700);

/* Счёт со 100 000, цель на 150 000, отложено 35 000 */
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('lifeos.milpa'));
  const acc = d.accounts.find(a => a.book === 'personal');
  acc.opening = 10000000;
  const now = new Date().toISOString();
  d.goals = [{ id: 'g1', book: 'personal', name: 'Подушка', icon: '🛟',
    target: 15000000, currency: 'MXN', deadline: null, accountId: null,
    archived: false, order: 0, createdDate: '2026-09-01', updatedAt: now }];
  d.savings = [
    { id: 'v1', book: 'personal', goalId: 'g1', date: '2026-09-01', amount: 2000000, note: '', updatedAt: now, createdAt: now },
    { id: 'v2', book: 'personal', goalId: 'g1', date: '2026-09-10', amount: 1500000, note: '', updatedAt: now, createdAt: now },
  ];
  localStorage.setItem('lifeos.milpa', JSON.stringify(d));
});
await page.reload({ waitUntil: 'networkidle0' });
await wait(900);

const home = await page.evaluate(() => {
  const card = document.querySelector('.screen .card');
  const nums = [...card.querySelectorAll('.num')].map(n => n.textContent.trim());
  return {
    остаток: card.querySelector('.amount--xl')?.textContent.trim(),
    строки: nums,
    текст: document.querySelector('.screen').textContent.replace(/\s+/g, ' '),
  };
});
console.log('  главная карточка:', JSON.stringify({ остаток: home.остаток, строки: home.строки }));

if (!/100,000/.test(home.остаток || '')) problems.push(`остаток «${home.остаток}», ждали 100 000`);
if (!/35,000/.test(home.текст)) problems.push('не показано отложенное (35 000)');
if (!/65,000/.test(home.текст)) problems.push('не показано свободно (65 000)');
// прогресс: 35 000 из 150 000 = 23%
if (!/23%/.test(home.текст)) problems.push('неверный процент выполнения цели');

/* Откладывание не должно менять остаток на счёте */
const balanceUnchanged = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('lifeos.milpa'));
  return d.tx.filter(t => !t.deleted).length === 0;
});
if (!balanceUnchanged) problems.push('откладывание создало операции по счёту — так быть не должно');

/* Цель со сроком: нужная сумма в месяц */
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('lifeos.milpa'));
  d.goals[0].deadline = '2027-03-21';   // ровно полгода вперёд
  d.goals[0].updatedAt = new Date().toISOString();
  localStorage.setItem('lifeos.milpa', JSON.stringify(d));
});
await page.reload({ waitUntil: 'networkidle0' });
await wait(900);
const withDeadline = await page.evaluate(() =>
  document.querySelector('.screen').textContent.replace(/\s+/g, ' '));
const perMonth = withDeadline.match(/по \$([\d,]+) в месяц/);
console.log('  при сроке через полгода:', perMonth ? perMonth[0] : '— не показано');
if (!perMonth) problems.push('не посчитана сумма в месяц при заданном сроке');
else {
  // осталось 115 000 за ~6 месяцев → около 19 000
  const v = Number(perMonth[1].replace(/,/g, ''));
  if (!(v > 18000 && v < 20500)) problems.push(`в месяц ${v}, ждали около 19 000`);
}

await page.screenshot({ path: '.shots/goals-check.png' });
await browser.close();

console.log('');
if (problems.length) {
  console.log(`  НАЙДЕНО ПРОБЛЕМ: ${problems.length}`);
  for (const p of problems) console.log('   • ' + p);
  process.exit(1);
}
console.log('  Цели и накопления считаются верно.\n');
