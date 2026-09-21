/* Автопроверка приложений в настоящем браузере:
   ошибки в консоли, горизонтальное переполнение, сценарий ввода данных. */

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = resolve(import.meta.dirname, '..', '.shots');
mkdirSync(OUT, { recursive: true });

const app = process.argv[2] || 'kapital';
const problems = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

page.on('console', m => {
  if (m.type() === 'error') problems.push('консоль: ' + m.text());
});
page.on('pageerror', e => problems.push('ошибка JS: ' + e.message));
page.on('requestfailed', r => problems.push('не загрузилось: ' + r.url()));

async function shot(name) {
  await page.screenshot({ path: resolve(OUT, `${app}-${name}.png`) });
}

async function overflow(label) {
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    const wide = [...document.querySelectorAll('body *')]
      .filter(n => n.getBoundingClientRect().right > d.clientWidth + 1)
      .slice(0, 6)
      .map(n => `${n.tagName.toLowerCase()}.${(n.className || '').toString().split(' ')[0]} → ${Math.round(n.getBoundingClientRect().right)}px`);
    return { client: d.clientWidth, scroll: d.scrollWidth, wide };
  });
  if (m.scroll > m.client + 1) {
    problems.push(`переполнение по ширине на «${label}»: ${m.scroll} > ${m.client}; виновники: ${m.wide.join('; ')}`);
  }
  return m;
}

console.log(`\n── Проверка ${app} ──`);
await page.goto(`${BASE}/apps/${app}/`, { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise(r => setTimeout(r, 600));

const m0 = await overflow('стартовый экран');
console.log(`  ширина: видимая ${m0.client}px, реальная ${m0.scroll}px`);
await shot('01-home');

/* Сценарий: записать расход через кнопку «+» */
if (app === 'kapital') {
  await page.click('.fab');
  await new Promise(r => setTimeout(r, 400));
  await overflow('форма операции');
  await shot('02-form');

  await page.type('.input--amount', '450.50');
  const chips = await page.$$('.sheet .chips .chip');
  if (chips[1]) await chips[1].click();
  await page.evaluate(() => {
    const ta = document.querySelector('.sheet textarea');
    if (ta) { ta.value = 'Обед с клиентом'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sheet__actions .btn')].at(-1);
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 600));
  await shot('03-after-save');

  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem('lifeos.kapital');
    const data = raw ? JSON.parse(raw) : null;
    return { count: data?.tx?.length ?? 0, first: data?.tx?.[0] ?? null };
  });
  console.log(`  операций в хранилище: ${saved.count}`);
  if (saved.count !== 1) problems.push('операция не сохранилась');
  else if (saved.first.amount !== 45050) problems.push(`сумма записана неверно: ${saved.first.amount} вместо 45050`);

  const shownTotal = await page.$eval('.amount--xl', n => n.textContent);
  console.log(`  остаток на экране: ${shownTotal}`);

  /* Обход вкладок */
  for (const tab of ['tx', 'reports', 'settings']) {
    await page.evaluate(id => { location.hash = '#' + id; }, tab);
    await new Promise(r => setTimeout(r, 450));
    await overflow('вкладка ' + tab);
    await shot('04-' + tab);
  }
}

if (app === 'ritmo') {
  /* Отмечаем первую привычку-галочку и проверяем, что отметка сохранилась */
  const before = await page.evaluate(() => {
    const p = document.querySelector('.amount--lg')?.textContent ?? '';
    return p;
  });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.row button[aria-pressed="false"]')]
      .find(b => b.getAttribute('aria-label') && !b.classList.contains('chip'));
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 500));
  const after = await page.evaluate(() => document.querySelector('.amount--lg')?.textContent ?? '');
  console.log(`  прогресс дня: «${before}» → «${after}»`);
  if (before === after) problems.push('отметка привычки не изменила прогресс дня');

  const logged = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lifeos.ritmo') || '{}');
    return Object.keys(d.logs || {}).length;
  });
  if (!logged) problems.push('отметка не сохранилась в хранилище');
  console.log(`  дней с отметками в хранилище: ${logged}`);

  /* Количественная привычка: прибавить и проверить */
  await page.evaluate(() => {
    const plus = [...document.querySelectorAll('.row .icon-btn[aria-label="+"]')][0];
    plus?.click(); plus?.click();
  });
  await new Promise(r => setTimeout(r, 400));
  await shot('03-checked');

  for (const tab of ['habits', 'stats', 'settings']) {
    await page.evaluate(id => { location.hash = '#' + id; }, tab);
    await new Promise(r => setTimeout(r, 500));
    await overflow('вкладка ' + tab);
    await shot('04-' + tab);
  }
}

await browser.close();

console.log('');
if (problems.length) {
  console.log(`  НАЙДЕНО ПРОБЛЕМ: ${problems.length}`);
  for (const p of problems) console.log('   • ' + p);
  process.exit(1);
} else {
  console.log('  Проблем не найдено.');
}
