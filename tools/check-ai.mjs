/* Проверка распознавания чеков.
   Обращение к Anthropic подменяется: ключа для настоящего вызова нет,
   а всё остальное — сжатие снимка, разбор ответа, заполнение формы,
   подбор счёта и категории, обработка ошибок — проверяется по-настоящему. */

import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.APP_URL || 'http://localhost:5173/apps/milpa/';
const PHOTO = 'apps/milpa/icons/icon-512.png';   // сгодится как «снимок чека»

const problems = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => problems.push('ошибка JS: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('консоль: ' + m.text()); });

/* Подменяем сеть до загрузки приложения и запоминаем, что оно отправило. */
await page.evaluateOnNewDocument(() => {
  window.__sent = null;
  window.__reply = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({
      readable: true, kind: 'expense', amount: 1450.5, currency: 'MXN',
      date: '2026-09-18', merchant: 'RESTAURANTE PUJOL',
      category: 'Представительские', note: 'Обед с клиентом',
      confidence: 'high', problem: '',
    }) }],
  };
  const real = window.fetch;
  window.fetch = async (url, opts) => {
    if (String(url).includes('api.anthropic.com')) {
      window.__sent = { headers: opts.headers, body: JSON.parse(opts.body) };
      if (window.__status && window.__status !== 200) {
        return new Response(JSON.stringify({ error: { message: 'nope' } }),
          { status: window.__status });
      }
      return new Response(JSON.stringify(window.__reply), { status: 200 });
    }
    return real(url, opts);
  };
  try { localStorage.setItem('lifeos.milpa.aikey', 'sk-ant-test'); } catch {}
});

console.log('\n── Распознавание чека ──');
await page.goto(URL + '#home', { waitUntil: 'networkidle0', timeout: 30000 });
await wait(700);

/* Переключаемся на кошелёк компании — там есть категория «Представительские» */
const companyLabel = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('lifeos.milpa')).books.find(b => b.id === 'empresa').name);
await page.evaluate(label => {
  [...document.querySelectorAll('.seg button')].find(b => b.textContent.trim() === label)?.click();
}, companyLabel);
await wait(500);

await page.click('.fab');
await wait(500);

const hasButton = await page.evaluate(() =>
  !!([...document.querySelectorAll('.sheet button')].find(b => /Заполнить по фото/.test(b.textContent))));
if (!hasButton) problems.push('кнопка «Заполнить по фото» не появилась');

const [chooser] = await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(() => {
    [...document.querySelectorAll('.sheet button')].find(b => /Заполнить по фото/.test(b.textContent))?.click();
  }),
]);
await chooser.accept([PHOTO]);
await wait(2500);

/* Что ушло в запрос */
const sent = await page.evaluate(() => {
  const s = window.__sent;
  if (!s) return null;
  const img = s.body.messages[0].content.find(c => c.type === 'image');
  const txt = s.body.messages[0].content.find(c => c.type === 'text');
  return {
    модель: s.body.model,
    браузерныйЗаголовок: s.headers['anthropic-dangerous-direct-browser-access'],
    версия: s.headers['anthropic-version'],
    ключПередан: !!s.headers['x-api-key'],
    снимокПервым: s.body.messages[0].content[0].type === 'image',
    типСнимка: img?.source?.media_type,
    размерBase64: img?.source?.data?.length,
    схемаЕсть: s.body.output_config?.format?.type,
    категорииВПодсказке: /Представительские/.test(txt?.text || ''),
  };
});
console.log('  запрос:', JSON.stringify(sent));

if (!sent) problems.push('запрос к Anthropic не ушёл');
else {
  if (sent.модель !== 'claude-opus-5') problems.push(`модель ${sent.модель}`);
  if (sent.браузерныйЗаголовок !== 'true') problems.push('нет заголовка прямого доступа из браузера');
  if (sent.версия !== '2023-06-01') problems.push('нет версии API');
  if (!sent.ключПередан) problems.push('ключ не передан');
  if (!sent.снимокПервым) problems.push('снимок должен идти перед текстом');
  if (sent.типСнимка !== 'image/jpeg') problems.push(`тип снимка ${sent.типСнимка}`);
  if (!(sent.размерBase64 > 1000)) problems.push('снимок не закодирован');
  if (sent.схемаЕсть !== 'json_schema') problems.push('не задан разбор ответа по схеме');
  if (!sent.категорииВПодсказке) problems.push('категории не переданы модели');
}

/* Что попало в форму */
const filled = await page.evaluate(() => {
  const sheet = document.querySelector('.sheet');
  const val = sel => sheet.querySelector(sel)?.value;
  const chip = [...sheet.querySelectorAll('.chip[aria-pressed="true"]')].map(c => c.textContent.trim());
  return {
    сумма: val('.input--amount'),
    дата: val('input[type="date"]'),
    контрагент: [...sheet.querySelectorAll('input')].map(i => i.value).find(v => /PUJOL/.test(v)),
    заметка: sheet.querySelector('textarea')?.value,
    категория: chip[0],
    вид: [...sheet.querySelectorAll('.seg button')].find(b => b.getAttribute('aria-pressed') === 'true')?.textContent,
  };
});
console.log('  форма:', JSON.stringify(filled));

if (filled.сумма !== '1450.5') problems.push(`сумма «${filled.сумма}», ждали 1450.5`);
if (filled.дата !== '2026-09-18') problems.push(`дата «${filled.дата}»`);
if (!/PUJOL/.test(filled.контрагент || '')) problems.push('контрагент не подставлен');
if (filled.заметка !== 'Обед с клиентом') problems.push(`заметка «${filled.заметка}»`);
if (!/Представительские/.test(filled.категория || '')) problems.push(`категория «${filled.категория}»`);
if (!/Расход/.test(filled.вид || '')) problems.push(`вид операции «${filled.вид}»`);

await page.screenshot({ path: '.shots/ai-filled.png' });

/* Ошибка ключа должна объясняться по-человечески, а не кодом */
console.log('\n── Неверный ключ ──');
await page.evaluate(() => { window.__status = 401; });
const [chooser2] = await Promise.all([
  page.waitForFileChooser(),
  page.evaluate(() => {
    [...document.querySelectorAll('.sheet button')].find(b => /Заполнить по фото/.test(b.textContent))?.click();
  }),
]);
await chooser2.accept([PHOTO]);
await wait(2500);
const toastText = await page.evaluate(() =>
  document.querySelector('.toast')?.textContent || '');
console.log('  сообщение:', toastText);
if (!/ключ/i.test(toastText)) problems.push(`при неверном ключе показано: «${toastText}»`);

await browser.close();

console.log('');
if (problems.length) {
  console.log(`  НАЙДЕНО ПРОБЛЕМ: ${problems.length}`);
  for (const p of problems) console.log('   • ' + p);
  process.exit(1);
}
console.log('  Распознавание чеков работает (сетевой вызов подменён).\n');
