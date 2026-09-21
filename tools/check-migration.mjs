/* Проверка миграции хранилища.
   Самое опасное в переименовании — потерять или не обновить данные,
   которые уже заведены на телефоне и на компьютере. Поэтому здесь
   подкладывается состояние старой версии и проверяется, что после
   загрузки названия появились, а операции остались на месте. */

import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.APP_URL || 'http://localhost:5173/apps/milpa/';

const problems = [];

/* Состояние в том виде, в каком оно лежит у пользователя с версии 1:
   у кошельков нет поля name. */
const V1_STATE = {
  v: 1,
  settings: {
    lang: 'ru', theme: 'dark', base: 'MXN',
    fx: { USD: 18.5 }, fxUpdated: null, book: 'personal',
  },
  books: [
    { id: 'personal', icon: '🏠' },
    { id: 'empresa', icon: '🏢' },
  ],
  accounts: [
    { id: 'a1', book: 'personal', name: 'Наличные', type: 'cash', currency: 'MXN', opening: 100000, color: '--c1', archived: false },
    { id: 'a2', book: 'empresa', name: 'Счёт компании', type: 'bank', currency: 'MXN', opening: 500000, color: '--c3', archived: false },
  ],
  categories: [
    { id: 'c1', book: 'personal', kind: 'expense', icon: '🛒', name: 'Продукты', color: '--c1' },
    { id: 'c2', book: 'empresa', kind: 'income', icon: '🏘️', name: 'Комиссия с продажи', color: '--c1' },
  ],
  tx: [
    { id: 't1', book: 'personal', kind: 'expense', date: '2026-09-15', amount: 45050,
      currency: 'MXN', account: 'a1', category: 'c1', party: 'OXXO', note: 'Тестовая запись',
      createdAt: '2026-09-15T10:00:00.000Z' },
  ],
  recurring: [],
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => problems.push('ошибка JS: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('консоль: ' + m.text()); });

console.log('\n── Миграция данных версии 1 ──');

// сначала открываем страницу, чтобы получить доступ к localStorage этого адреса
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await page.evaluate(state => {
  localStorage.setItem('lifeos.milpa', JSON.stringify(state));
}, V1_STATE);

// перезагружаем — на этом шаге должна сработать миграция
await page.reload({ waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 900));

const after = await page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('lifeos.milpa'));
  const tabs = [...document.querySelectorAll('.seg button')].map(b => b.textContent.trim());
  return {
    version: saved.v,
    names: saved.books.map(b => b.name),
    txCount: saved.tx.length,
    txNote: saved.tx[0]?.note,
    accountCount: saved.accounts.length,
    switcher: tabs.slice(0, 2),
    balance: document.querySelector('.amount--xl')?.textContent?.trim(),
  };
});

console.log('  версия после загрузки:', after.version);
console.log('  названия кошельков:   ', JSON.stringify(after.names));
console.log('  в переключателе:      ', JSON.stringify(after.switcher));
console.log('  операций сохранилось: ', after.txCount, `(«${after.txNote}»)`);
console.log('  остаток на экране:    ', after.balance);

if (after.version !== 2) problems.push(`версия не обновилась: ${after.version}`);
if (after.names[0] !== 'Kira Kellar') problems.push(`личный кошелёк назван «${after.names[0]}»`);
if (after.names[1] !== 'KOSHTUR') problems.push(`кошелёк компании назван «${after.names[1]}»`);
if (!after.switcher.includes('Kira Kellar')) problems.push('переключатель не показывает новое название');
if (after.txCount !== 1) problems.push('операции потерялись при миграции');
if (after.accountCount !== 2) problems.push('счета потерялись при миграции');

/* Переименование пользователем должно переживать перезагрузку */
console.log('\n── Переименование пользователем ──');
await page.evaluate(() => { location.hash = '#settings'; });
await new Promise(r => setTimeout(r, 500));
await page.evaluate(() => {
  [...document.querySelectorAll('.row')].find(r => /Кошельки/.test(r.textContent))?.click();
});
await new Promise(r => setTimeout(r, 600));

const hasSheet = await page.evaluate(() => !!document.querySelector('.sheet'));
if (!hasSheet) problems.push('лист переименования не открылся');

await page.evaluate(() => {
  const field = document.querySelector('.sheet input');
  field.value = 'Личные деньги';
  field.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));
await page.reload({ waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 700));

const renamed = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('lifeos.milpa')).books[0].name);
console.log('  после переименования: ', renamed);
if (renamed !== 'Личные деньги') problems.push(`переименование не сохранилось: «${renamed}»`);

/* Пустое поле должно возвращать значение по умолчанию, а не оставлять пустоту */
await page.evaluate(() => { location.hash = '#settings'; });
await new Promise(r => setTimeout(r, 500));
await page.evaluate(() => {
  [...document.querySelectorAll('.row')].find(r => /Кошельки/.test(r.textContent))?.click();
});
await new Promise(r => setTimeout(r, 500));
await page.evaluate(() => {
  const field = document.querySelector('.sheet input');
  field.value = '   ';
  field.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));
const restored = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('lifeos.milpa')).books[0].name);
console.log('  пустое поле вернуло:  ', restored);
if (restored !== 'Kira Kellar') problems.push(`пустое название не восстановилось: «${restored}»`);

await page.evaluate(() => { location.hash = '#home'; });
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: '.shots/books-renamed.png' });

/* Приложение переименовано из Kapital в Milpa: данные, заведённые под
   прежним ключом, должны подхватиться, а не пропасть. */
console.log('\n── Данные из-под прежнего имени (Kapital → Milpa) ──');
await page.evaluate(state => {
  localStorage.clear();
  localStorage.setItem('lifeos.kapital', JSON.stringify(state));
}, V1_STATE);
await page.reload({ waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 900));

const carried = await page.evaluate(() => {
  const now = JSON.parse(localStorage.getItem('lifeos.milpa') || 'null');
  const old = JSON.parse(localStorage.getItem('lifeos.kapital') || 'null');
  return {
    подхвачено: !!now,
    операций: now?.tx?.length ?? 0,
    заметка: now?.tx?.[0]?.note,
    счетов: now?.accounts?.length ?? 0,
    версия: now?.v,
    староеНаМесте: !!old,
    остаток: document.querySelector('.amount--xl')?.textContent?.trim(),
  };
});
console.log('  ', JSON.stringify(carried, null, 0));

if (!carried.подхвачено) problems.push('данные из-под прежнего имени не подхватились');
if (carried.операций !== 1) problems.push('операции потерялись при переименовании приложения');
if (carried.счетов !== 2) problems.push('счета потерялись при переименовании приложения');
if (carried.версия !== 2) problems.push('версия не обновилась при переносе');
if (!carried.староеНаМесте) problems.push('прежняя запись удалена — нет запасной копии');

await browser.close();

console.log('');
if (problems.length) {
  console.log(`  НАЙДЕНО ПРОБЛЕМ: ${problems.length}`);
  for (const p of problems) console.log('   • ' + p);
  process.exit(1);
}
console.log('  Миграция и переименование работают.\n');
